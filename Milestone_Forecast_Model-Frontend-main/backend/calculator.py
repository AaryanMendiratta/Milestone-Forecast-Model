"""
calculator.py — Python port of the formula evaluation engine from Calculations.jsx.

Supports:
  - All 4 operators: multiply, divide, add, subtract
  - Chaining: a formula's output (prefixed 'output-{rowId}') can be an input to another formula
  - single-input metrics: value from metricConfigs[id].inputValue, not metricData
  - uptake-curve metrics: S-curve ramp controlled by monthsToPeak, diffusionConstant, peakValue
  - primary-only metrics: fall back to key without secondary tag if exact key not found
  - percentage valueType: auto-divide by 100
  - Attribute combinations built from configuredMetrics + current segments (no stale metricData)
"""

from typing import Any
import math
import re


def _to_float(value, default: float = 0.0) -> float:
    """Safely convert a value to float, stripping any non-numeric characters (typos like backticks)."""
    if value is None or value == '':
        return default
    if isinstance(value, (int, float)):
        return float(value)
    # Strip anything that isn't a digit, dot, minus, or plus
    cleaned = re.sub(r"[^\d.\-+eE]", "", str(value))
    try:
        return float(cleaned) if cleaned else default
    except ValueError:
        return default


# ─── Timeline ─────────────────────────────────────────────────────────────────

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def generate_timeline(timeline: dict) -> list[dict]:
    from_idx = MONTHS.index(timeline['fromMonth'])
    to_idx = MONTHS.index(timeline['toMonth'])
    from_year = int(timeline['fromYear'])
    to_year = int(timeline['toYear'])

    if timeline.get('granularity') == 'annual':
        return [{'label': str(y), 'year': y, 'month': None} for y in range(from_year, to_year + 1)]

    periods = []
    year, month = from_year, from_idx
    while year < to_year or (year == to_year and month <= to_idx):
        periods.append({'label': f'{MONTHS[month]} {year}', 'year': year, 'month': month + 1})
        month += 1
        if month >= 12:
            month = 0
            year += 1
    return periods


# ─── Uptake Curve ─────────────────────────────────────────────────────────────

def generate_uptake_curve(
    months_to_peak: float,
    diffusion_constant: float,
    peak_value: float,
    from_year: int,
    to_year: int,
) -> dict[int, float]:
    """
    Generate an annual uptake curve for a metric.

    Parameters
    ----------
    months_to_peak : float
        How many months until the peak is reached. Rounded to the nearest
        whole number of years (minimum 1 year).

    diffusion_constant : float
        Speed of the ramp-up. Must be in [1.0, 2.0].
        • 1.5 → linear ramp
        • 1.0 → slow ramp  (concave up — starts sluggish, accelerates toward peak)
        • 2.0 → fast ramp  (concave down — surges early, levels off near peak)

        Implemented as a power curve:
            exponent = 1 / (diffusion_constant - 0.5)
        This maps  dc=1.0 → exp=2.0 (quadratic slow),
                   dc=1.5 → exp=1.0 (linear),
                   dc=2.0 → exp=0.667 (sub-linear fast).

    peak_value : float
        The sustained value after the ramp-up completes.

    from_year : int
        First year of the model timeline.

    to_year : int
        Last year of the model timeline.

    Returns
    -------
    dict[int, float]
        Mapping of {year: value} for every year in [from_year, to_year].
        Values are rounded to 4 decimal places.

    Examples
    --------
    >>> generate_uptake_curve(18, 1.5, 100, 2024, 2028)
    {2024: 50.0, 2025: 100.0, 2026: 100.0, 2027: 100.0, 2028: 100.0}

    >>> generate_uptake_curve(24, 1.0, 80, 2024, 2028)
    {2024: 20.0, 2025: 80.0, 2026: 80.0, 2027: 80.0, 2028: 80.0}
    """
    if not (1.0 <= diffusion_constant <= 2.0):
        raise ValueError(f"diffusion_constant must be between 1.0 and 2.0, got {diffusion_constant}")

    years_to_peak = max(1, round(months_to_peak / 12))
    # Map diffusion_constant → power exponent
    # dc=1.0 → exp=2.0 (slow), dc=1.5 → exp=1.0 (linear), dc=2.0 → exp=0.667 (fast)
    exponent = 1.0 / (diffusion_constant - 0.5)

    curve: dict[int, float] = {}
    for year in range(from_year, to_year + 1):
        year_index = year - from_year + 1  # 1-indexed distance from model start

        if year_index >= years_to_peak:
            # At or past peak — hold at peak_value
            curve[year] = round(float(peak_value), 0)
        else:
            # Ramp phase: power curve from 0 → peak_value
            fraction = year_index / years_to_peak
            curve[year] = round(float(peak_value) * (fraction ** exponent), 0)

    return curve



def _apply_operator(operator: str, a: float, b: float) -> float:
    if operator == 'multiply':  return a * b
    if operator == 'divide':    return a / b if b != 0 else 0.0
    if operator == 'add':       return a + b
    if operator == 'subtract':  return a - b
    return a


def _get_item_value_for_period(
    item: dict,
    primary_tag: str,
    secondary_tag: str,
    period: dict,
    metric_data: dict,
    metric_configs: dict,
    calculated_outputs: dict,
    formula_rows: list,
    precomputed_uptake: dict,
) -> float:
    """
    Resolve the numeric value of a single formula item at one period.
    Mirrors _getItemValueForPeriod() in calculationUtils.js.
    Extracted so the reverse-array operator can call it for every period up-front.
    """
    metric_id: str | None = item.get('metricId')
    if not metric_id:
        return 0.0

    data_key = f"{primary_tag}-{secondary_tag}-{period['label']}"

    # ── Chained formula output reference ─────────────────────────────────────
    if metric_id.startswith('output-'):
        ref_formula_id = metric_id[len('output-'):]
        ref_formula = next((fr for fr in formula_rows if fr['id'] == ref_formula_id), None)
        output_name = (ref_formula['items'][-1].get('outputName')
                      if ref_formula and ref_formula.get('items') else None)
        if (output_name and output_name in calculated_outputs
                and data_key in calculated_outputs[output_name]['outputData']):
            raw = calculated_outputs[output_name]['outputData'][data_key]
            return float(raw) if raw != '' else 0.0
        return 0.0

    # ── Regular metric ────────────────────────────────────────────────────────
    metric_config = metric_configs.get(metric_id, {})
    input_type = metric_config.get('inputType', '')

    if input_type == 'single-input':
        single_key         = f"{metric_id}-{primary_tag}-{secondary_tag}-SINGLE"
        primary_single_key = f"{metric_id}-{primary_tag}--SINGLE"
        single_val = metric_data.get(single_key)
        if single_val is None:
            single_val = metric_data.get(primary_single_key)
        if single_val is not None and single_val != '':
            current_value = _to_float(single_val)
        elif metric_config.get('inputValue') not in (None, ''):
            current_value = _to_float(metric_config['inputValue'])
        else:
            current_value = 0.0

    elif input_type == 'uptake-curve':
        exact_key          = f"{metric_id}-{primary_tag}-{secondary_tag}-{period['label']}"
        primary_only_key   = f"{metric_id}-{primary_tag}--{period['label']}"
        secondary_only_key = f"{metric_id}--{secondary_tag}-{period['label']}"
        stored = metric_data.get(exact_key)
        if stored is None:
            stored = metric_data.get(primary_only_key)
        if stored is None:
            stored = metric_data.get(secondary_only_key)
        if stored is not None and stored != '':
            current_value = _to_float(stored)
        else:
            year = period.get('year')
            series_map = precomputed_uptake.get(metric_id, {})
            combo_keys = [
                f"{primary_tag}|{secondary_tag}",
                f"{primary_tag}|",
                f"|{secondary_tag}",
                "|",
            ]
            current_value = 0.0
            for combo_key in combo_keys:
                uptake = series_map.get(combo_key)
                if not uptake:
                    continue
                if year in uptake:
                    current_value = uptake[year]
                else:
                    years = sorted(uptake.keys())
                    if years:
                        current_value = uptake[years[0]] if year < years[0] else uptake[years[-1]]
                break

    else:
        exact_key          = f"{metric_id}-{primary_tag}-{secondary_tag}-{period['label']}"
        primary_only_key   = f"{metric_id}-{primary_tag}--{period['label']}"
        secondary_only_key = f"{metric_id}--{secondary_tag}-{period['label']}"
        stored = metric_data.get(exact_key)
        if stored is None:
            stored = metric_data.get(primary_only_key)
        if stored is None:
            stored = metric_data.get(secondary_only_key)
        current_value = _to_float(stored) if (stored is not None and stored != '') else 0.0

    is_uptake = metric_config.get('inputType') == 'uptake-curve' or (
        not metric_config.get('inputType') and
        metric_data.get(f"{metric_id}--is-uptake-curve") is True
    )
    if is_uptake:
        current_value /= 100.0
    elif metric_config.get('valueType') == 'percentage':
        current_value /= 100.0

    return current_value


# ─── Attribute combinations ───────────────────────────────────────────────────

def get_attribute_combinations(
    metric_id: str,
    configured_metrics: list,
    segments: list,
    metric_configs: dict | None = None,
) -> set[str]:
    """
    Build the set of 'primaryTag|secondaryTag' combos for a metric
    using its selectedSegments and current segment tag lists.
    Never scans metricData (avoids returning stale/removed segment data).
    """
    if metric_configs is None:
        metric_configs = {}

    configured_metric = next((m for m in configured_metrics if m.get('id') == metric_id), None)
    selected_ids: list = (
        metric_configs.get(metric_id, {}).get('selectedSegments')
        if metric_id in metric_configs and 'selectedSegments' in metric_configs.get(metric_id, {})
        else (configured_metric.get('selectedSegments', []) if configured_metric else [])
    )
    selected_segs = [s for s in segments if s.get('id') in selected_ids]

    primary_segs  = [s for s in selected_segs if s.get('type') == 'Primary Attribute']
    secondary_segs = [s for s in selected_segs if s.get('type') == 'Secondary Attribute']

    primary_tags  = [tag for s in primary_segs  for tag in s.get('tags', [])]
    secondary_tags = [tag for s in secondary_segs for tag in s.get('tags', [])]

    combos: set[str] = set()
    if primary_tags and secondary_tags:
        for p in primary_tags:
            for s in secondary_tags:
                combos.add(f"{p}|{s}")
    elif primary_tags:
        for p in primary_tags:
            combos.add(f"{p}|")
    elif secondary_tags:
        for s in secondary_tags:
            combos.add(f"|{s}")

    # Fallback: use all current segments if metric not configured yet
    if not combos:
        all_p = [tag for seg in segments if seg.get('type') == 'Primary Attribute'   for tag in seg.get('tags', [])]
        all_s = [tag for seg in segments if seg.get('type') == 'Secondary Attribute' for tag in seg.get('tags', [])]
        if all_p and all_s:
            for p in all_p:
                for s in all_s:
                    combos.add(f"{p}|{s}")
        elif all_p:
            for p in all_p:
                combos.add(f"{p}|")
        elif all_s:
            for s in all_s:
                combos.add(f"|{s}")
        else:
            combos.add("|")
    return combos


# ─── Per-period calculation ───────────────────────────────────────────────────

def calculate_for_period(
    formula_row: dict,
    primary_tag: str,
    secondary_tag: str,
    period: dict,
    metric_data: dict,
    calculated_outputs: dict,
    formula_rows: list,
    metric_configs: dict,
    precomputed_uptake: dict | None = None,
) -> Any:
    """
    Mirrors calculateForPeriod() in Calculations.jsx.
    Handles single-input, uptake-curve, and table-based metrics.

    precomputed_uptake: dict[metric_id, dict[year(int), float]]
        Pre-computed uptake curves generated by generate_uptake_curve().
        Built once in run_calculations() and passed down here.
    """
    items = formula_row.get('items', [])
    if not items:
        return ''

    if precomputed_uptake is None:
        precomputed_uptake = {}

    result = None
    pending_operator = None
    data_key = f"{primary_tag}-{secondary_tag}-{period['label']}"

    for current_item in items:
        metric_id: str | None = current_item.get('metricId')
        if not metric_id:
            continue

        if metric_id.startswith('output-'):
            ref_formula_id = metric_id[len('output-'):]
            ref_formula = next((fr for fr in formula_rows if fr['id'] == ref_formula_id), None)
            output_name = (ref_formula['items'][-1].get('outputName')
                          if ref_formula and ref_formula.get('items') else None)
            if (output_name and output_name in calculated_outputs
                    and data_key in calculated_outputs[output_name]['outputData']):
                raw = calculated_outputs[output_name]['outputData'][data_key]
                current_value = float(raw) if raw != '' else 0.0
            else:
                current_value = 0.0
        else:
            metric_config = metric_configs.get(metric_id, {})
            input_type = metric_config.get('inputType', '')

            if input_type == 'single-input':
                # Match frontend: prefer per-segment SINGLE keys in metric_data
                single_key        = f"{metric_id}-{primary_tag}-{secondary_tag}-SINGLE"
                primary_single_key = f"{metric_id}-{primary_tag}--SINGLE"
                single_val = metric_data.get(single_key)
                if single_val is None:
                    single_val = metric_data.get(primary_single_key)
                if single_val is not None and single_val != '':
                    current_value = float(single_val)
                elif metric_config.get('inputValue') not in (None, ''):
                    current_value = float(metric_config['inputValue'])
                else:
                    current_value = 0.0

            elif input_type == 'uptake-curve':
                # Uptake-curve precedence:
                # 1) Stored exact key in metric_data
                # 2) Stored primary-only key in metric_data
                # 3) Precomputed exact combo curve
                # 4) Precomputed primary-only or secondary-only curve
                # 5) Zero
                exact_key = f"{metric_id}-{primary_tag}-{secondary_tag}-{period['label']}"
                primary_only_key = f"{metric_id}-{primary_tag}--{period['label']}"
                secondary_only_key = f"{metric_id}--{secondary_tag}-{period['label']}"

                stored = metric_data.get(exact_key)
                if stored is None:
                    stored = metric_data.get(primary_only_key)
                if stored is None:
                    stored = metric_data.get(secondary_only_key)

                if stored is not None and stored != '':
                    current_value = _to_float(stored)
                else:
                    year = period.get('year')
                    series_map = precomputed_uptake.get(metric_id, {})
                    combo_keys = [
                        f"{primary_tag}|{secondary_tag}",
                        f"{primary_tag}|",
                        f"|{secondary_tag}",
                        "|",
                    ]
                    current_value = 0.0
                    for combo_key in combo_keys:
                        uptake = series_map.get(combo_key)
                        if not uptake:
                            continue
                        if year in uptake:
                            current_value = uptake[year]
                        else:
                            years = sorted(uptake.keys())
                            if years:
                                current_value = uptake[years[0]] if year < years[0] else uptake[years[-1]]
                        break

            else:
                # Table-based: try exact key, primary-only, then secondary-only fallback
                exact_key          = f"{metric_id}-{primary_tag}-{secondary_tag}-{period['label']}"
                primary_only_key   = f"{metric_id}-{primary_tag}--{period['label']}"
                secondary_only_key = f"{metric_id}--{secondary_tag}-{period['label']}"
                stored = metric_data.get(exact_key)
                if stored is None:
                    stored = metric_data.get(primary_only_key)
                if stored is None:
                    stored = metric_data.get(secondary_only_key)
                current_value = _to_float(stored) if (stored is not None and stored != '') else 0.0

            # Only treat as uptake-curve if metricConfig explicitly says so.
            # The metricData flag is only a fallback when inputType is missing entirely.
            # This prevents stale flags from a previous inputType change causing wrong /100 division.
            is_uptake = metric_config.get('inputType') == 'uptake-curve' or (
                not metric_config.get('inputType') and
                metric_data.get(f"{metric_id}--is-uptake-curve") is True
            )
            if is_uptake:
                current_value /= 100.0
            elif metric_config.get('valueType') == 'percentage':
                current_value /= 100.0

        item_operator = current_item.get('operator')
        if result is None:
            result = current_value
            pending_operator = item_operator
        else:
            if pending_operator and pending_operator != 'equal':
                result = _apply_operator(pending_operator, result, current_value)
            if pending_operator == 'equal':
                break
            pending_operator = item_operator

    return round(result, 4) if result is not None else ''


def _is_percentage_output(formula_row: dict, metric_configs: dict, formula_rows: list, _visited: set | None = None) -> bool:
    """Mirror of frontend isPercentageOutput — returns True if every formula input is a % type."""
    if _visited is None:
        _visited = set()
    row_id = formula_row.get('id')
    if not row_id or row_id in _visited:
        return False
    _visited.add(row_id)
    input_items = [i for i in (formula_row.get('items') or []) if i.get('metricId')]
    if not input_items:
        return False
    for item in input_items:
        mid = item['metricId']
        if mid.startswith('output-'):
            ref_id  = mid[len('output-'):]
            ref_row = next((r for r in formula_rows if r.get('id') == ref_id), None)
            if not ref_row or not _is_percentage_output(ref_row, metric_configs, formula_rows, set(_visited)):
                return False
        else:
            cfg = metric_configs.get(mid, {})
            if cfg.get('inputType') != 'uptake-curve' and cfg.get('valueType') != 'percentage':
                return False
    return True


# ─── Main calculation engine ──────────────────────────────────────────────────

def run_calculations(
    formula_rows: list,
    metric_data: dict,
    segments: list,
    timeline: dict,
    metric_configs: dict | None = None,
    configured_metrics: list | None = None,
) -> list[dict]:
    """
    Process all formula rows in order, supporting cascading outputs.
    Uses configuredMetrics + segments for attribute combinations — never stale metricData keys.
    """
    if metric_configs is None:
        metric_configs = {}
    if configured_metrics is None:
        configured_metrics = []

    annual_periods = generate_timeline({**timeline, 'granularity': 'annual'})
    from_year = int(timeline.get('fromYear', annual_periods[0]['year'] if annual_periods else 2024))
    to_year   = int(timeline.get('toYear',   annual_periods[-1]['year'] if annual_periods else 2030))

    # ── Pre-compute uptake curves for all uptake-curve metrics ───────────────
    precomputed_uptake: dict[str, dict[str, dict[int, float]]] = {}
    for metric_id, config in metric_configs.items():
        if config.get('inputType') == 'uptake-curve':
            combos = get_attribute_combinations(metric_id, configured_metrics, segments, metric_configs)
            segment_peak_values = config.get('segmentPeakValues', {}) or {}
            metric_series: dict[str, dict[int, float]] = {}
            for combo in combos:
                primary_tag, secondary_tag = combo.split('|', 1)
                peak_value = segment_peak_values.get(
                    combo,
                    segment_peak_values.get(primary_tag, segment_peak_values.get(secondary_tag, config.get('peakValue', 0.0))),
                )
                try:
                    metric_series[combo] = generate_uptake_curve(
                        months_to_peak=float(config.get('monthsToPeak', 12)),
                        diffusion_constant=float(config.get('diffusionConstant', 1.5)),
                        peak_value=float(peak_value),
                        from_year=from_year,
                        to_year=to_year,
                    )
                except (ValueError, TypeError):
                    metric_series[combo] = {y: 0.0 for y in range(from_year, to_year + 1)}
            precomputed_uptake[metric_id] = metric_series

    formula_outputs: list[dict] = []
    calculated_outputs: dict[str, dict] = {}

    for formula_row in formula_rows:
        items: list = formula_row.get('items', [])
        if not items:
            continue

        last_item = items[-1]
        if last_item.get('operator') != 'equal' or not last_item.get('outputName'):
            continue

        # All items with a metricId (including the last/equal item) — mirrors JS inputItems
        all_input_items = [i for i in items if i.get('metricId')]
        if not all_input_items:
            continue

        output_name: str = last_item['outputName']
        output_data: dict = {}

        # ── Build attribute combinations — union of ALL input metrics ─────────
        # This mirrors the JavaScript computeLocalOutputs logic which accumulates
        # combos from every metric in the formula before choosing which to iterate.
        all_combos: set[str] = set()
        has_any_valid_source = False

        for item in all_input_items:
            item_metric_id: str | None = item.get('metricId')
            if not item_metric_id:
                continue
            if item_metric_id.startswith('output-'):
                ref_formula_id = item_metric_id[len('output-'):]
                ref_formula = next((fr for fr in formula_rows if fr['id'] == ref_formula_id), None)
                if not ref_formula or not ref_formula.get('items'):
                    continue
                ref_output_name = ref_formula['items'][-1].get('outputName')
                if not ref_output_name or ref_output_name not in calculated_outputs:
                    continue
                has_any_valid_source = True
                for key in calculated_outputs[ref_output_name]['outputData']:
                    parts = key.split('-')
                    if len(parts) >= 2:
                        all_combos.add(f"{parts[0]}|{parts[1]}")
            else:
                combos = get_attribute_combinations(item_metric_id, configured_metrics, segments, metric_configs)
                if combos:
                    has_any_valid_source = True
                    all_combos.update(combos)

        if not has_any_valid_source or not all_combos:
            continue

        # Promotion: prefer primary+secondary combos over primary-only for same primary.
        # Mirrors JS: if both "APP|" and "APP|Commercial" exist, keep only "APP|Commercial".
        primary_only_combos   = {c for c in all_combos if c.endswith('|')}
        with_secondary_combos = {c for c in all_combos if not c.endswith('|')}

        if with_secondary_combos and primary_only_combos:
            attribute_combinations: set[str] = set(with_secondary_combos)
            for p_combo in primary_only_combos:
                primary = p_combo[:-1]  # strip trailing "|"
                if not any(c.startswith(primary + '|') for c in with_secondary_combos):
                    attribute_combinations.add(p_combo)
        else:
            attribute_combinations = all_combos

        # ── Calculate for each combination × period ───────────────────────────
        # Detect reverse-array operator: requires full timeline context per combo
        has_reverse_array = any(item.get('operator') == 'reverse-array' for item in all_input_items)

        if has_reverse_array:
            # Formula: [metric1] ⊛ [metric2] = output
            # At year index i: SUMPRODUCT(m1[0..i], reversed(m2[0..i])) + m1[i]
            m1_item = next((item for item in all_input_items if item.get('operator') == 'reverse-array'), None)
            m1_index = all_input_items.index(m1_item) if m1_item else -1
            m2_item = all_input_items[m1_index + 1] if m1_item and m1_index + 1 < len(all_input_items) else None

            if m1_item and m2_item:
                for combo in attribute_combinations:
                    primary_tag, secondary_tag = combo.split('|', 1)
                    m1_values = [
                        _get_item_value_for_period(m1_item, primary_tag, secondary_tag, p, metric_data, metric_configs, calculated_outputs, formula_rows, precomputed_uptake)
                        for p in annual_periods
                    ]
                    m2_values = [
                        _get_item_value_for_period(m2_item, primary_tag, secondary_tag, p, metric_data, metric_configs, calculated_outputs, formula_rows, precomputed_uptake)
                        for p in annual_periods
                    ]
                    for i, period in enumerate(annual_periods):
                        sum_product = sum(m1_values[j] * m2_values[i - j] for j in range(i + 1))
                        sum_product += m1_values[i]
                        output_data[f"{primary_tag}-{secondary_tag}-{period['label']}"] = round(sum_product, 4)
        else:
            for combo in attribute_combinations:
                primary_tag, secondary_tag = combo.split('|', 1)
                for period in annual_periods:
                    val = calculate_for_period(
                        formula_row, primary_tag, secondary_tag, period,
                        metric_data, calculated_outputs, formula_rows, metric_configs,
                        precomputed_uptake=precomputed_uptake,
                    )
                    output_data[f"{primary_tag}-{secondary_tag}-{period['label']}"] = val

        if output_data:
            # Mirror frontend isPercentageOutput: if ALL inputs are % types, scale values ×100
            # so the stored values are on the 0-100 scale (e.g. 16.0 not 0.16)
            if _is_percentage_output(formula_row, metric_configs, formula_rows):
                output_data = {k: round(v * 100, 4) for k, v in output_data.items()}
            entry = {'outputName': output_name, 'outputData': output_data, 'formulaRowId': formula_row['id']}
            formula_outputs.append(entry)
            calculated_outputs[output_name] = entry

    return formula_outputs

