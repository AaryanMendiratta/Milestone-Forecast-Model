"""
monte_carlo_db.py — Database-backed Monte Carlo simulation.

For each iteration the function:
  1. Samples a temp_<key> value for every ACE variable (metric × segment × period)
     using the per-metric distribution parameters supplied by the frontend.
  2. Runs the full formula engine with the sampled data.
  3. Stores a row in Supabase:
       temp_vars    — all sampled values  { "temp_population-Oncology--|SINGLE": 52341, ... }
       outputs      — per-segment-year result { "Oncology--2024": 125000, ... }
       total_output — sum of all segment-year values (used for histogram/stats)

The database is cleared at the start of every run.
Rows are inserted in batches of BATCH_SIZE for performance.
"""

import math
import os
import random
import uuid as uuid_mod
from statistics import mean as _mean
from typing import Any

from .calculator import run_calculations, get_attribute_combinations, generate_timeline, _to_float
from .db import get_client

BATCH_SIZE = max(50, int(os.environ.get("MC_DB_BATCH_SIZE", "250")))
PERSIST_TEMP_VARS = os.environ.get("MC_PERSIST_TEMP_VARS", "false").strip().lower() in ("1", "true", "yes", "on")


# ─── Sampling helpers ─────────────────────────────────────────────────────────

def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _random_normal(mu: float = 0.0, sigma: float = 1.0) -> float:
    """Box-Muller normal sample."""
    u1 = random.random() or 1e-12
    u2 = random.random() or 1e-12
    z0 = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
    return mu + sigma * z0


def _probit(p: float) -> float:
    """
    Rational approximation of the inverse normal CDF (Φ⁻¹).
    Abramowitz & Stegun formula 26.2.17, accurate to ~4.5e-4.
    """
    p = max(1e-12, min(1.0 - 1e-12, p))
    t = math.sqrt(-2.0 * math.log(p if p < 0.5 else 1.0 - p))
    c = (2.515517, 0.802853, 0.010328)
    d = (1.432788, 0.189269, 0.001308)
    x = t - (c[0] + c[1] * t + c[2] * t * t) / (1.0 + d[0] * t + d[1] * t * t + d[2] * t * t * t)
    return x if p >= 0.5 else -x


def _sample_change_pct(dist: dict) -> float:
    """
    Return a random % change based on the distribution config.

    For Normal distributions the σ is derived from confidenceLevel so that
    `confidenceLevel`% of draws actually span the full [minChange, maxChange]
    range before clamping:

        σ = halfRange / Φ⁻¹((1 + CL/100) / 2)

    Example: CL=90%, range=[-50, 50]
        σ = 50 / Φ⁻¹(0.95) = 50 / 1.645 ≈ 30.4
    This means 90% of draws land in [-50, 50] and only 10% are clamped,
    making the output bands reflect the full declared range.
    """
    lo = float(dist.get("minChange", -20))
    hi = float(dist.get("maxChange", 20))
    dist_type = (dist.get("distType") or dist.get("distributionType") or "uniform").lower()

    if dist_type == "normal":
        confidence = float(dist.get("confidenceLevel", 90))
        half_range = max(abs(lo), abs(hi))
        z = _probit((1.0 + confidence / 100.0) / 2.0)
        sd = half_range / z if z > 0.0001 else max(0.0001, float(dist.get("sd") or dist.get("stdDev", 10)))
        return _clamp(_random_normal(0.0, sd), lo, hi)

    return lo + random.random() * (hi - lo)


def _apply_change(base: float, pct: float, change_type: str) -> float:
    """
    Apply a sampled % change to a base value according to changeType.

    Multiplicative: base + (base × pct/100)  →  base * (1 + pct/100)
      e.g. base=50, pct=10  →  50 + (50×0.10) = 55
    Additive:       base + pct
      e.g. base=50, pct=10  →  50 + 10 = 60
    """
    if change_type == "additive":
        return base + pct
    # default: multiplicative
    return base * (1.0 + pct / 100.0)


def _get_uptake_curve_value(
    metric_config: dict,
    primary_tag: str,
    secondary_tag: str,
    period: dict,
    timeline: dict,
) -> float | None:
    """Derive an uptake-curve value from metric_config maps when metric_data is empty."""
    mtp_map = metric_config.get("segmentMonthsToPeak") or {}
    dc_map = metric_config.get("segmentDiffusionConstant") or {}
    pv_map = metric_config.get("segmentPeakValues") or {}

    def _pick(map_obj: dict):
        exact = f"{primary_tag}|{secondary_tag}" if primary_tag or secondary_tag else "|"
        exact_val = map_obj.get(exact)
        if exact_val not in (None, ""):
            return exact_val
        primary_val = map_obj.get(f"{primary_tag}|") if primary_tag else None
        if primary_val not in (None, ""):
            return primary_val
        secondary_val = map_obj.get(f"|{secondary_tag}") if secondary_tag else None
        return secondary_val

    mtp_raw = _pick(mtp_map)
    pv_raw = _pick(pv_map)
    if mtp_raw in (None, "") or pv_raw in (None, ""):
        return None

    mtp = _to_float(mtp_raw)
    pv = _to_float(pv_raw)
    if mtp <= 0:
        return None

    dc_raw = _pick(dc_map)
    dc = _to_float(dc_raw, 1.5) if dc_raw not in (None, "") else 1.5
    if abs(dc - 0.5) < 1e-6:
        dc = 1.5

    years_to_peak = max(1, round(mtp / 12))
    exponent = 1.0 / (dc - 0.5)
    from_year = int(timeline.get("fromYear", period.get("year", 0)))
    idx = int(period.get("year", from_year)) - from_year + 1
    value = pv if idx >= years_to_peak else pv * (idx / years_to_peak) ** exponent
    return round(float(value), 4)


def _sample_metric_data(
    metric_data: dict,
    metrics_to_vary: list[dict],
    metric_dists: dict,
    metric_configs: dict | None = None,
    configured_metrics: list | None = None,
    segments: list | None = None,
    timeline: dict | None = None,
    collect_temp_vars: bool = True,
) -> tuple[dict, dict]:
    """
    For every enabled metric, draw ONE random % change and apply it to every
    CURRENTLY-CONFIGURED key for that metric (stale/removed segment combos are
    skipped automatically via get_attribute_combinations).

    This matches the VBA Excel model: one change factor per metric per iteration,
    applied uniformly to all time-period cells for that metric:
      Multiplicative: base * (1 + pct/100)   e.g. base=50, pct=10  → 55
      Additive:       base + pct              e.g. base=50, pct=10  → 60

    Sampled values are clamped at 0 to prevent negative populations/percentages.

    Returns
    -------
    sampled_data : dict  — metric_data copy with sampled values substituted
    temp_vars    : dict  — { "temp_{MetricName} ({id})-{suffix}": value }
    """
    if metric_configs is None:
        metric_configs = {}
    if configured_metrics is None:
        configured_metrics = []
    if segments is None:
        segments = []

    # Build period labels from timeline for table/uptake metrics
    periods: list[dict] = []
    if timeline:
        periods = generate_timeline(timeline)
    period_labels = [p["label"] for p in periods]

    sampled = dict(metric_data)
    temp_vars: dict = {}
    default_dist = {"distType": "normal", "minChange": -20, "maxChange": 20, "sd": 10}

    for metric in metrics_to_vary:
        metric_id: str = metric.get("id", "")
        metric_name: str = metric.get("name", metric_id) if collect_temp_vars else ""
        dist = metric_dists.get(metric_id) or default_dist
        metric_config = metric_configs.get(metric_id) or {}
        input_type = metric_config.get("inputType", "table")
        change_type = dist.get("changeType", "multiplicative")

        # Draw ONE random sample per metric per simulation run
        pct = _sample_change_pct(dist)

        # Get ONLY the currently-configured segment combinations for this metric.
        # This prevents sampling stale keys from old configurations.
        valid_combos = get_attribute_combinations(
            metric_id, configured_metrics, segments, metric_configs
        )

        for combo in valid_combos:
            primary_tag, secondary_tag = combo.split("|", 1)

            if input_type == "single-input":
                # Try full combo key first, then primary-only fallback
                candidate_keys = [
                    f"{metric_id}-{primary_tag}-{secondary_tag}-SINGLE",
                    f"{metric_id}-{primary_tag}--SINGLE",
                    f"{metric_id}--{secondary_tag}-SINGLE",
                ]
                raw_val = None
                key = None
                for candidate in candidate_keys:
                    val = metric_data.get(candidate)
                    if val is None or val == "":
                        continue
                    raw_val = val
                    key = candidate
                    break
                if raw_val is None and metric_config.get("inputValue") not in (None, ""):
                    raw_val = metric_config.get("inputValue")
                    key = f"{metric_id}-{primary_tag}-{secondary_tag}-SINGLE"
                if raw_val is None:
                    continue
                base = _to_float(raw_val)
                if base == 0:
                    continue
                sampled_val = max(0.0, _apply_change(base, pct, change_type))
                sampled[key] = sampled_val
                if collect_temp_vars:
                    suffix = key[len(f"{metric_id}-"):]
                    temp_vars[f"temp_{metric_name} ({metric_id})-{suffix}"] = round(sampled_val, 6)

            else:
                # table / uptake-curve — vary each period independently using same pct
                for period in periods:
                    period_label = period["label"]
                    candidate_keys = [
                        f"{metric_id}-{primary_tag}-{secondary_tag}-{period_label}",
                        f"{metric_id}-{primary_tag}--{period_label}",
                        f"{metric_id}--{secondary_tag}-{period_label}",
                    ]
                    raw_val = None
                    key = None
                    for candidate in candidate_keys:
                        val = metric_data.get(candidate)
                        if val is None or val == "":
                            continue
                        raw_val = val
                        key = candidate
                        break
                    if raw_val is None and input_type == "uptake-curve":
                        raw_val = _get_uptake_curve_value(metric_config, primary_tag, secondary_tag, period, timeline)
                        key = f"{metric_id}-{primary_tag}-{secondary_tag}-{period_label}"
                    if raw_val is None:
                        continue
                    base = _to_float(raw_val)
                    if base == 0:
                        continue
                    sampled_val = max(0.0, _apply_change(base, pct, change_type))
                    sampled[key] = sampled_val
                    if collect_temp_vars:
                        suffix = key[len(f"{metric_id}-"):]
                        temp_vars[f"temp_{metric_name} ({metric_id})-{suffix}"] = round(sampled_val, 6)

    return sampled, temp_vars


# ─── Main DB-backed simulation ────────────────────────────────────────────────

def run_monte_carlo_db(
    simulations: int,
    metric_data: dict,
    formula_rows: list,
    segments: list,
    timeline: dict,
    metric_configs: dict,
    configured_metrics: list,
    metric_dists: dict,
    output_name: str,
) -> dict:
    """
    Run the Monte Carlo simulation and persist every iteration to Supabase.

    Parameters
    ----------
    simulations       : number of iterations to run
    metric_data       : flat dict of all ACE-entered values
    formula_rows      : formula definitions from the model setup
    segments          : segment objects with id/name/type/tags
    timeline          : { fromMonth, fromYear, toMonth, toYear, granularity }
    metric_configs    : per-metric config (inputType, inputValue, etc.)
    configured_metrics: list of configured metric objects
    metric_dists      : per-metric distribution params  { metricId: { distType, minChange, maxChange, sd } }
    output_name       : name of the formula output to simulate

    Returns
    -------
    dict with keys: run_id, simulations_count
    """
    sb = get_client()

    # ── Build the list of metrics to vary ────────────────────────────────────
    # Use ALL metrics the user has enabled on the Monte Carlo page (metric_dists
    # already contains only those with "Include = Yes", filtered by the frontend).
    # This ensures every enabled metric — whether it feeds the target formula
    # directly or through intermediate outputs — gets varied in each iteration.
    enabled_metric_ids: set = set(metric_dists.keys())
    metrics_to_vary: list[dict] = [
        m for m in configured_metrics if m.get("id") in enabled_metric_ids
    ]
    # Add any ids present in metric_dists but not in configured_metrics
    known_ids = {m.get("id") for m in metrics_to_vary}
    for mid in enabled_metric_ids:
        if mid not in known_ids:
            metrics_to_vary.append({"id": mid, "name": mid})

    sb.table("monte_carlo_runs").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()

    # ── Create a new run record ───────────────────────────────────────────────
    run_id = str(uuid_mod.uuid4())
    sb.table("monte_carlo_runs").insert(
        {
            "id": run_id,
            "simulation_count": simulations,
            "output_name": output_name,
            "metric_configs": {m.get("id"): metric_dists.get(m.get("id"), {}) for m in metrics_to_vary},
        }
    ).execute()

    # ── Simulation loop ───────────────────────────────────────────────────────
    # Each iteration mirrors one row of the VBA Data Table:
    #
    #  Step 1 — VARY INPUTS
    #    For each enabled metric (Lives Reached, Adoption, Payer, etc.):
    #      • Draw ONE random % change from its configured distribution (uniform or normal,
    #        clamped to [minChange, maxChange]).
    #      • Apply that change to EVERY period key for that metric using its changeType:
    #          Multiplicative: sampled = base * (1 + pct/100)
    #                          e.g. base=50, pct=+10  →  55
    #          Additive:       sampled = base + pct
    #                          e.g. base=50, pct=+10  →  60
    #
    #  Step 2 — RUN FORMULA ENGINE
    #    Pass the sampled inputs into run_calculations(), which evaluates every formula
    #    row from the Model Setup page (formula builder) in dependency order.
    #    TRx = f(sampled Lives Reached, sampled Adoption, sampled Payer, ...)
    #    Intermediate outputs (e.g. NBRx) feed into downstream outputs (e.g. TRx)
    #    exactly as defined in the formula builder.
    #
    #  Step 3 — CAPTURE OUTPUT
    #    Store the per-segment-year values and the grand total for this iteration.
    #    After all N iterations, the frontend buckets values by year and computes
    #    p10/p25/p50/p75/p90 across iterations to draw the forecast cone.
    batch: list[dict] = []
    n = max(100, int(simulations))
    # Monte Carlo operates on yearly cones/tables; force annual periods so
    # metrics keyed like "...-2024" are sampled and evaluated consistently.
    annual_timeline = {**timeline, "granularity": "annual"} if timeline else {"granularity": "annual"}

    for i in range(1, n + 1):
        sampled_data, temp_vars = _sample_metric_data(
            metric_data, metrics_to_vary, metric_dists, metric_configs,
            configured_metrics=configured_metrics,
            segments=segments,
            timeline=annual_timeline,
            collect_temp_vars=PERSIST_TEMP_VARS,
        )

        formula_outputs = run_calculations(
            formula_rows=formula_rows,
            metric_data=sampled_data,
            segments=segments,
            timeline=annual_timeline,
            metric_configs=metric_configs,
            configured_metrics=configured_metrics,
        )

        # Find the selected output
        selected = next(
            (o for o in formula_outputs if o.get("outputName") == output_name),
            formula_outputs[0] if formula_outputs else None,
        )

        if selected:
            output_data: dict = selected.get("outputData", {})
            total_output: float = 0.0
            for v in output_data.values():
                if v is None or v == "":
                    continue
                try:
                    total_output += float(v)
                except (TypeError, ValueError):
                    pass
        else:
            output_data = {}
            total_output = 0.0

        row = {
            "run_id": run_id,
            "iteration": i,
            "outputs": output_data,
            "total_output": round(total_output, 4),
        }
        if PERSIST_TEMP_VARS:
            row["temp_vars"] = temp_vars
        batch.append(row)

        if len(batch) >= BATCH_SIZE:
            sb.table("monte_carlo_iterations").insert(batch).execute()
            batch = []

    # Insert remaining rows
    if batch:
        sb.table("monte_carlo_iterations").insert(batch).execute()

    return {"run_id": run_id, "simulations_count": n}
