"""
monte_carlo.py — DEPRECATED: Legacy in-memory Monte Carlo simulation.

⚠️  This module is no longer used by the frontend. All Monte Carlo simulations
now use monte_carlo_db.py which:
  • Samples inputs defined in your Model Setup page (not hardcoded)
  • Evaluates dynamic formulas from your formula builder (not value = a*b*c*d)
  • Supports multiple outputs (TRx, NBRx, etc.) via dropdown selection
  • Persists all iterations to Supabase for analysis

If you are seeing hardcoded formulas in your Monte Carlo output, you are
using the wrong endpoint. Switch to /api/monte-carlo/run (DB-backed) instead
of /api/monte-carlo (legacy).

This file is kept for reference only. Do not modify.
"""

import math
import random
from statistics import mean


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _random_normal(mu: float = 0.0, sigma: float = 1.0) -> float:
    u1 = random.random() or 1e-12
    u2 = random.random() or 1e-12
    z0 = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
    return mu + sigma * z0


def _sample_change_pct(dist: dict) -> float:

    lo = float(dist.get("minChange", -20))
    hi = float(dist.get("maxChange", 20))
    dist_type = (dist.get("distributionType") or "uniform").lower()

    if dist_type == "normal":

        sd = max(0.0001, float(dist.get("stdDev", 10)))

        while True:
            sampled = _random_normal(0.0, sd)
            if lo <= sampled <= hi:
                return sampled

    return lo + random.random() * (hi - lo)


def _quantile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0

    idx = int(round((len(sorted_values) - 1) * p))
    idx = max(0, min(len(sorted_values) - 1, idx))

    return sorted_values[idx]


def _summary(values: list[float]) -> dict:

    if not values:
        return {
            "min": 0,
            "p10": 0,
            "p25": 0,
            "p50": 0,
            "p75": 0,
            "p90": 0,
            "max": 0,
            "mean": 0,
            "std": 0,
        }

    s = sorted(values)
    mu = mean(s)
    var = mean([(v - mu) ** 2 for v in s])

    return {
        "min": s[0],
        "p10": _quantile(s, 0.10),
        "p25": _quantile(s, 0.25),
        "p50": _quantile(s, 0.50),
        "p75": _quantile(s, 0.75),
        "p90": _quantile(s, 0.90),
        "max": s[-1],
        "mean": mu,
        "std": math.sqrt(var),
    }


def _build_histogram(values: list[float], bins: int = 45):

    if not values:
        return []

    vmin = min(values)
    vmax = max(values)

    if vmin == vmax:
        return [{"value": vmin, "prob": 1.0}]

    width = (vmax - vmin) / bins
    counts = [0] * bins

    for val in values:
        i = int((val - vmin) / width)
        i = max(0, min(bins - 1, i))
        counts[i] += 1

    total = float(len(values))
    result = []

    for i, c in enumerate(counts):

        lo = vmin + i * width
        hi = lo + width

        result.append({
            "value": (lo + hi) / 2.0,
            "prob": c / total,
        })

    return result


def _apply_change(base_value: float, change_pct: float, change_type: str):

    change_type = (change_type or "multiplicative").lower()

    if change_type == "multiplicative":

        return base_value * (1.0 + change_pct / 100.0)

    else:

        return base_value + change_pct


def run_monte_carlo(
        simulations: int,
        base_components_by_year: list[dict],
        input_distributions: list[dict]) -> dict:


    years = [int(row["year"]) for row in base_components_by_year]

    base_map = {int(row["year"]): row for row in base_components_by_year}

    enabled = [d for d in input_distributions if d.get("enabled", True)]

    per_year_samples = {y: [] for y in years}

    total_samples = []


    for _ in range(max(100, int(simulations))):

        sim_total = 0.0

        for y in years:

            base = base_map[y]

            population = base["population"]
            lives = base["lives_reached"]
            adoption = base["hcp_adoption"]
            payer = base["payer_access"]


            for d in enabled:

                change_pct = _sample_change_pct(d)

                metric = (d.get("metric") or "").lower()

                if "population" in metric:

                    population = _apply_change(population, change_pct, d.get("changeType"))

                elif "lives" in metric:

                    lives = _apply_change(lives, change_pct, d.get("changeType"))

                elif "adoption" in metric:

                    adoption = _apply_change(adoption, change_pct, d.get("changeType"))

                elif "payer" in metric:

                    payer = _apply_change(payer, change_pct, d.get("changeType"))


            # ⚠️  HARDCODED FORMULA — This is why the system doesn't work!
            # Use monte_carlo_db.py instead which evaluates your formula builder.
            value = population * lives * adoption * payer

            per_year_samples[y].append(value)

            sim_total += value


        total_samples.append(sim_total)


    yearly_stats = {

        str(y): _summary(per_year_samples[y])

        for y in years

    }


    cone = []

    for y in years:

        s = sorted(per_year_samples[y])

        cone.append({
            "year": y,
            "p05": _quantile(s, 0.05),
            "p10": _quantile(s, 0.10),
            "p25": _quantile(s, 0.25),
            "p50": _quantile(s, 0.50),
            "p75": _quantile(s, 0.75),
            "p90": _quantile(s, 0.90),
            "p95": _quantile(s, 0.95),
        })


    hist = _build_histogram(total_samples, bins=45)


    ccdf = []

    if hist:

        cum = sum(d["prob"] for d in hist)

        for d in hist:

            ccdf.append({
                "value": d["value"],
                "pAchieve": max(0.0, min(1.0, cum)),
            })

            cum -= d["prob"]


    return {
        "years": years,
        "cone": cone,
        "histogram": hist,
        "ccdf": ccdf,
        "yearlyStats": yearly_stats,
        "totalSummary": _summary(total_samples),
        "samplesCount": len(total_samples),
    }