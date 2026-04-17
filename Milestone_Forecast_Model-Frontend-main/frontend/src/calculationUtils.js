// Shared calculation utilities used by Calculations.jsx and ExecutiveSummary.jsx

export const OPERATORS_LIST = [
  { id: 'multiply',      symbol: '×',  name: 'Multiply',      fn: (a, b) => a * b },
  { id: 'divide',        symbol: '÷',  name: 'Divide',        fn: (a, b) => b !== 0 ? a / b : 0 },
  { id: 'add',           symbol: '+',  name: 'Add',           fn: (a, b) => a + b },
  { id: 'subtract',      symbol: '−',  name: 'Subtract',      fn: (a, b) => a - b },
  { id: 'reverse-array', symbol: '⊛',  name: 'Reverse Array', fn: null }, // handled specially
];

// Generate annual timeline periods from the timeline config
export function generateAnnualPeriods(timeline) {
  const years = [];
  for (let y = timeline.fromYear; y <= timeline.toYear; y++) {
    years.push({ label: `${y}`, year: y, month: null });
  }
  return years;
}

// Build the set of "primary|secondary" attribute combos for a given metric.
// Only segments explicitly selected in model setup are used — no fallback to all available.
// If only primary segments are selected, calculations run on primary only (and vice versa).
// If neither type is selected, the calculation runs without any segment breakdown.
// metricConfigs is checked first (updated immediately when user applies in the modal)
// before falling back to configuredMetrics (updated when user clicks Save & Proceed).
export function getAttributeCombinations(metricId, configuredMetrics, segments, metricConfigs = {}) {
  const configuredMetric = configuredMetrics.find(m => m.id === metricId);

  // Prefer metricConfigs (reflects Apply-button changes immediately)
  const selectedSegmentIds = (
    metricConfigs[metricId]?.selectedSegments !== undefined
      ? metricConfigs[metricId].selectedSegments
      : configuredMetric?.selectedSegments
  ) ?? [];

  const selectedSegs = segments.filter(s => selectedSegmentIds.includes(s.id));

  const selPrimarySegs   = selectedSegs.filter(s => s.type === 'Primary Attribute');
  const selSecondarySegs = selectedSegs.filter(s => s.type === 'Secondary Attribute');

  // Only use what was explicitly selected — no fallback to all available segments
  const primaryTags   = selPrimarySegs.flatMap(s => s.tags || []);
  const secondaryTags = selSecondarySegs.flatMap(s => s.tags || []);

  const combos = new Set();
  if (primaryTags.length > 0 && secondaryTags.length > 0) {
    primaryTags.forEach(p => secondaryTags.forEach(s => combos.add(`${p}|${s}`)));
  } else if (primaryTags.length > 0) {
    primaryTags.forEach(p => combos.add(`${p}|`));
  } else if (secondaryTags.length > 0) {
    secondaryTags.forEach(s => combos.add(`|${s}`));
  } else {
    // Absolute fallback: no segment tags defined at all — still run calculations
    combos.add(`|`);
  }

  return combos;
}

// Calculate the output value for one cell (one primary/secondary/period combo).
// For the reverse-array operator, use computeLocalOutputs which handles the full
// timeline at once.
// Internal helper: resolve the numeric value of a single formula item at one
// period. Extracted from calculateForPeriod so it can be reused for the
// reverse-array operator which needs every period's value up-front.
// ---------------------------------------------------------------------------
function _getItemValueForPeriod(item, primaryTag, secondaryTag, period, metricData, metricConfigs, calculatedOutputs, formulaRows, fromYear) {
  let metricId = item?.metricId;
  if (!metricId && item?.metric && typeof item.metric === 'object') metricId = item.metric.id;
  if (!metricId) return 0;

  const dataKey = `${primaryTag}-${secondaryTag}-${period.label}`;

  // ── Chained formula output reference ──────────────────────────────────────
  if (metricId.startsWith('output-')) {
    const refFormulaId = metricId.replace('output-', '');
    const refFormula   = formulaRows?.find(fr => fr.id === refFormulaId);
    const outputName   = refFormula?.items?.[refFormula.items.length - 1]?.outputName;
    if (outputName && calculatedOutputs[outputName]) {
      const od               = calculatedOutputs[outputName].outputData;
      const primaryOnlyKey   = `${primaryTag}--${period.label}`;
      const secondaryOnlyKey = `--${secondaryTag}-${period.label}`;
      const found = od[dataKey] !== undefined ? od[dataKey]
        : od[primaryOnlyKey]   !== undefined ? od[primaryOnlyKey]
        : od[secondaryOnlyKey] !== undefined ? od[secondaryOnlyKey]
        : undefined;
      return found !== undefined ? parseFloat(found) || 0 : 0;
    }
    return 0;
  }

  // ── Regular metric ─────────────────────────────────────────────────────────
  const metricConfig = metricConfigs[metricId] || {};
  let currentValue = 0;

  if (metricConfig.inputType === 'single-input') {
    const singleKey          = `${metricId}-${primaryTag}-${secondaryTag}-SINGLE`;
    const primarySingleKey   = `${metricId}-${primaryTag}--SINGLE`;
    const secondarySingleKey = `${metricId}--${secondaryTag}-SINGLE`;
    const singleValue =
      metricData[singleKey]          !== undefined ? metricData[singleKey] :
      metricData[primarySingleKey]   !== undefined ? metricData[primarySingleKey] :
      metricData[secondarySingleKey] !== undefined ? metricData[secondarySingleKey] :
      undefined;
    if (singleValue !== undefined && singleValue !== '') {
      currentValue = parseFloat(singleValue) || 0;
    } else if (metricConfig.inputValue !== undefined && metricConfig.inputValue !== '') {
      currentValue = parseFloat(metricConfig.inputValue) || 0;
    }
  } else if (metricConfig.inputType === 'uptake-curve') {
    const primaryOnlyKey   = `${metricId}-${primaryTag}--${period.label}`;
    const secondaryOnlyKey = `${metricId}--${secondaryTag}-${period.label}`;
    const exactKey         = `${metricId}-${primaryTag}-${secondaryTag}-${period.label}`;
    const storedValue =
      metricData[primaryOnlyKey]   !== undefined ? metricData[primaryOnlyKey] :
      metricData[secondaryOnlyKey] !== undefined ? metricData[secondaryOnlyKey] :
      metricData[exactKey]         !== undefined ? metricData[exactKey] :
      undefined;
    if (storedValue !== undefined && storedValue !== '') {
      currentValue = parseFloat(storedValue) || 0;
    } else {
      const comboKey = primaryTag && secondaryTag ? `${primaryTag}|${secondaryTag}`
                     : primaryTag ? `${primaryTag}|` : `|${secondaryTag}`;
      const mtpMap = metricConfig.segmentMonthsToPeak    || {};
      const dcMap  = metricConfig.segmentDiffusionConstant || {};
      const pvMap  = metricConfig.segmentPeakValues       || {};
      const mtp = parseFloat(mtpMap[comboKey] ?? mtpMap[`${primaryTag}|`] ?? mtpMap[`|${secondaryTag}`]);
      const dc  = parseFloat(dcMap[comboKey]  ?? dcMap[`${primaryTag}|`]  ?? dcMap[`|${secondaryTag}`]  ?? 1.5);
      const pv  = parseFloat(pvMap[comboKey]  ?? pvMap[`${primaryTag}|`]  ?? pvMap[`|${secondaryTag}`]);
      if (!isNaN(mtp) && !isNaN(dc) && !isNaN(pv) && mtp > 0) {
        const fromYr = fromYear ?? period.year;
        const ytp    = Math.max(1, Math.round(mtp / 12));
        const exp    = 1 / (dc - 0.5);
        const idx    = period.year - fromYr + 1;
        currentValue = idx >= ytp ? pv : pv * Math.pow(idx / ytp, exp);
        currentValue = Math.round(currentValue * 10000) / 10000;
      }
    }
  } else {
    const exactKey         = `${metricId}-${primaryTag}-${secondaryTag}-${period.label}`;
    const primaryOnlyKey   = `${metricId}-${primaryTag}--${period.label}`;
    const secondaryOnlyKey = `${metricId}--${secondaryTag}-${period.label}`;
    const storedValue =
      metricData[exactKey]         !== undefined ? metricData[exactKey] :
      metricData[primaryOnlyKey]   !== undefined ? metricData[primaryOnlyKey] :
      metricData[secondaryOnlyKey] !== undefined ? metricData[secondaryOnlyKey] :
      undefined;
    currentValue = (storedValue !== undefined && storedValue !== '') ? (parseFloat(storedValue) || 0) : 0;
  }

  const isUptakeCurve = metricConfig.inputType === 'uptake-curve' ||
                        (!metricConfig.inputType && metricData[`${metricId}--is-uptake-curve`] === true);
  if (isUptakeCurve) currentValue /= 100;
  else if (metricConfig.valueType === 'percentage') currentValue /= 100;

  return currentValue;
}

export function calculateForPeriod(
  formulaRow, primaryTag, secondaryTag, period,
  metricData, calculatedOutputs = {}, formulaRows = [], metricConfigs = {}, fromYear = null
) {
  const items = formulaRow.items || [];
  if (items.length === 0) return '';

  let result   = null;
  let operator = null;

  for (let i = 0; i < items.length; i++) {
    const currentItem = items[i];

    let metricId = currentItem?.metricId;
    if (!metricId && currentItem?.metric && typeof currentItem.metric === 'object') {
      metricId = currentItem.metric.id;
    }
    if (!metricId) continue;

    // reverse-array requires all periods — handled in computeLocalOutputs, not here
    if (operator === 'reverse-array') return '';

    const currentValue = _getItemValueForPeriod(
      { ...currentItem, metricId },
      primaryTag, secondaryTag, period,
      metricData, metricConfigs, calculatedOutputs, formulaRows, fromYear
    );

    if (result === null) {
      result   = currentValue;
      operator = currentItem.operator;
    } else {
      const operatorObj = OPERATORS_LIST.find(op => op.id === operator);
      if (operatorObj && operatorObj.fn && operator && operator !== 'equal') {
        result = operatorObj.fn(result, currentValue);
      }
      if (operator === 'equal') break;
      operator = currentItem.operator;
    }
  }

  return result !== null ? parseFloat(result.toFixed(4)) : '';
}

// Run all formula rows and return an array of { outputName, outputData, formulaRow }
export function computeLocalOutputs(
  formulaRows, metricData, segments, configuredMetrics, metricConfigs, annualPeriods
) {
  const localFormulaOutputs     = [];
  const localCalculatedOutputs  = {};

  formulaRows.forEach((formulaRow) => {
    if (!formulaRow.items || formulaRow.items.length === 0) return;
    const lastItem = formulaRow.items[formulaRow.items.length - 1];
    if (lastItem.operator !== 'equal' || !lastItem.outputName) return;

    // All items that are real metric inputs (including the last one before '=',
    // whose operator is 'equal'). Items without metricId are the output name placeholders.
    const inputItems = formulaRow.items.filter(item => item.metricId);
    if (inputItems.length === 0) return;

    const outputName = lastItem.outputName;
    const outputData = {};

    // Build union of attribute combinations across ALL input metrics — including chained
    // output-refs. This handles mixed-attribute formulas correctly regardless of which
    // metric comes first in the formula:
    //   • primary-only metric × primary+secondary metric  → output is primary+secondary
    //   • secondary-only metric × primary+secondary metric → output is primary+secondary
    //   • chained output (primary-only) × new metric (primary+secondary) → output is primary+secondary
    const allCombos = new Set();
    let hasAnyValidSource = false;

    for (const item of inputItems) {
      const itemMetricId = item.metricId;
      if (!itemMetricId) continue;

      if (itemMetricId.startsWith('output-')) {
        const refFormulaId  = itemMetricId.replace('output-', '');
        const refFormula    = formulaRows.find(fr => fr.id === refFormulaId);
        const refOutputName = refFormula?.items?.[refFormula.items.length - 1]?.outputName;
        if (!refOutputName || !localCalculatedOutputs[refOutputName]) continue;
        hasAnyValidSource = true;
        Object.keys(localCalculatedOutputs[refOutputName].outputData).forEach(key => {
          const dashIdx  = key.indexOf('-');
          const dashIdx2 = key.indexOf('-', dashIdx + 1);
          // key format: primaryTag-secondaryTag-period (period may contain dashes)
          const primary   = key.slice(0, dashIdx);
          const secondary = key.slice(dashIdx + 1, dashIdx2);
          allCombos.add(`${primary}|${secondary}`);
        });
      } else {
        const combos = getAttributeCombinations(itemMetricId, configuredMetrics, segments, metricConfigs);
        if (combos.size > 0) hasAnyValidSource = true;
        combos.forEach(c => allCombos.add(c));
      }
    }

    if (!hasAnyValidSource || allCombos.size === 0) return;

    // "Promote" primary-only combos when more specific combos exist for that primary.
    // e.g., given {EP|, EP|Commercial, EP|Medicare}, drop EP| and keep the specific ones.
    const primaryOnlyCombos   = [...allCombos].filter(c => c.endsWith('|'));
    const withSecondaryCombos = [...allCombos].filter(c => !c.endsWith('|'));

    let attributeCombinations;
    if (withSecondaryCombos.length > 0 && primaryOnlyCombos.length > 0) {
      attributeCombinations = new Set(withSecondaryCombos);
      // Keep primary-only for any primary that has no secondary breakdown
      primaryOnlyCombos.forEach(pCombo => {
        const primary = pCombo.slice(0, -1);
        const hasMoreSpecific = withSecondaryCombos.some(c => c.startsWith(primary + '|'));
        if (!hasMoreSpecific) attributeCombinations.add(pCombo);
      });
    } else {
      attributeCombinations = allCombos;
    }

    if (attributeCombinations.size === 0) return;

    // ── Reverse-array operator: convolution path ───────────────────────────
    // Formula structure: [metric1] ⊛ [metric2] = output
    // At year index i: result = SUMPRODUCT(m1[0..i], reversed(m2[0..i])) + m1[i]
    const reverseArrayItem = inputItems.find(item => item.operator === 'reverse-array');
    if (reverseArrayItem) {
      const m1Item = reverseArrayItem;
      const m1Index = inputItems.indexOf(m1Item);
      const m2Item = inputItems[m1Index + 1];

      if (m1Item && m2Item) {
        const fromYr = annualPeriods[0]?.year ?? null;
        attributeCombinations.forEach(combo => {
          const [primaryTag, secondaryTag] = combo.split('|');
          const m1Values = annualPeriods.map(p =>
            _getItemValueForPeriod(m1Item, primaryTag, secondaryTag, p, metricData, metricConfigs, localCalculatedOutputs, formulaRows, fromYr)
          );
          const m2Values = annualPeriods.map(p =>
            _getItemValueForPeriod(m2Item, primaryTag, secondaryTag, p, metricData, metricConfigs, localCalculatedOutputs, formulaRows, fromYr)
          );
          annualPeriods.forEach((period, i) => {
            let sumProduct = 0;
            for (let j = 0; j <= i; j++) {
              sumProduct += (m1Values[j] || 0) * (m2Values[i - j] || 0);
            }
            sumProduct += (m1Values[i] || 0);
            outputData[`${primaryTag}-${secondaryTag}-${period.label}`] = parseFloat(sumProduct.toFixed(4));
          });
        });
      }
    } else {
      // ── Standard per-period calculation ─────────────────────────────────
      attributeCombinations.forEach(combo => {
        const [primaryTag, secondaryTag] = combo.split('|');
        annualPeriods.forEach(period => {
          const calculatedValue = calculateForPeriod(
            formulaRow, primaryTag, secondaryTag, period,
            metricData, localCalculatedOutputs, formulaRows, metricConfigs,
            annualPeriods[0]?.year ?? null
          );
          outputData[`${primaryTag}-${secondaryTag}-${period.label}`] = calculatedValue;
        });
      });
    }

    if (Object.keys(outputData).length > 0) {
      const output = { outputName, outputData, formulaRow };
      localFormulaOutputs.push(output);
      localCalculatedOutputs[outputName] = output;
    }
  });

  return localFormulaOutputs;
}

// Determine whether a formula's output is a percentage type.
// Rule: output is % ONLY if every input metric (including the last one,
// which carries operator='equal') has valueType='percentage'.
// The formula items structure is:
//   { metricId, operator: 'multiply' }  ← regular input
//   { metricId, operator: 'equal' }     ← LAST input (still an input — not the output)
//   { outputName }                      ← output label, no metricId
// So we filter on item.metricId (not operator) to capture all inputs.
export function isPercentageOutput(formulaRow, metricConfigs, formulaRows, _visited = new Set()) {
  if (!formulaRow?.items) return false;
  if (_visited.has(formulaRow.id)) return false;
  _visited.add(formulaRow.id);

  // Handle both {metricId} (new format) and {metric: {id}} (legacy format)
  const inputItems = formulaRow.items
    .map(item => ({ ...item, metricId: item.metricId || item.metric?.id }))
    .filter(item => item.metricId);
  if (inputItems.length === 0) return false;

  return inputItems.every(item => {
    if (item.metricId.startsWith('output-')) {
      const refId  = item.metricId.replace('output-', '');
      const refRow = formulaRows.find(r => r.id === refId);
      return refRow ? isPercentageOutput(refRow, metricConfigs, formulaRows, new Set(_visited)) : false;
    }
    return metricConfigs[item.metricId]?.valueType === 'percentage' ||
           metricConfigs[item.metricId]?.inputType === 'uptake-curve';
  });
}

// Compute annual totals for an output:
//   percentage outputs → average across segments × 100 (produce a % value)
//   numeric outputs    → sum across all segments
export function computeAnnualTotals(outputData, periods, isPercentage) {
  const totals = {};
  periods.forEach(period => {
    const values = Object.entries(outputData)
      .filter(([key]) => key.endsWith(`-${period.label}`))
      .map(([, v]) => parseFloat(v))
      .filter(v => !isNaN(v));

    if (values.length === 0) {
      totals[period.label] = 0;
    } else if (isPercentage) {
      totals[period.label] = (values.reduce((a, b) => a + b, 0) / values.length) * 100;
    } else {
      totals[period.label] = values.reduce((a, b) => a + b, 0);
    }
  });
  return totals;
}

// Compute totals broken down by primary segment (summed/averaged across all years + secondary combos)
export function computePrimarySegmentAllTimeTotals(outputData, isPercentage) {
  const buckets = {};
  Object.entries(outputData).forEach(([key, value]) => {
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;
    const primaryTag = key.split('-')[0];
    if (!buckets[primaryTag]) buckets[primaryTag] = { sum: 0, count: 0 };
    buckets[primaryTag].sum   += numVal;
    buckets[primaryTag].count += 1;
  });
  const result = {};
  Object.entries(buckets).forEach(([tag, { sum, count }]) => {
    result[tag] = isPercentage ? (sum / count) * 100 : sum;
  });
  return result;
}

// Compute totals broken down by secondary segment (summed/averaged across all years + primary combos)
// Keys format: "{primaryTag}-{secondaryTag}-{YYYY}" — year is always the last dash-segment.
export function computeSecondarySegmentAllTimeTotals(outputData, isPercentage) {
  const buckets = {};
  Object.entries(outputData).forEach(([key, value]) => {
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;
    const parts = key.split('-');
    if (parts.length < 3) return;
    // Everything between first part (primary) and last part (year) is the secondary tag
    const secondary = parts.slice(1, -1).join('-');
    if (!secondary) return;
    if (!buckets[secondary]) buckets[secondary] = { sum: 0, count: 0 };
    buckets[secondary].sum   += numVal;
    buckets[secondary].count += 1;
  });
  const result = {};
  Object.entries(buckets).forEach(([tag, { sum, count }]) => {
    result[tag] = isPercentage ? (sum / count) * 100 : sum;
  });
  return result;
}

// Smart numeric formatter (K / M / B)
export function formatSmartNumber(value, dp = 1) {
  if (value === null || value === undefined || isNaN(value)) return 'N/A';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(dp)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(dp)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(dp)}K`;
  return Math.round(value).toLocaleString();
}

// Percentage formatter (value already in 0-100 range)
export function formatPercent(value, dp = 0) {
  if (value === null || value === undefined || isNaN(value)) return 'N/A';
  return `${value.toFixed(dp)}%`;
}

// Combined formatter
export function formatValue(value, isPercentage, dp = 0) {
  const num = parseFloat(value);
  if (value === null || value === undefined || value === '' || isNaN(num)) return '—';
  return isPercentage ? formatPercent(num, dp) : formatSmartNumber(num, dp);
}

// Get the raw input value for a cell (for the data table, before any percentage conversion)
export function getRawInputValue(metricId, primaryTag, secondaryTag, periodLabel, metricData, metricConfigs) {
  const metricConfig = metricConfigs[metricId] || {};
  if (metricConfig.inputType === 'single-input') {
    const singleKey        = `${metricId}-${primaryTag}-${secondaryTag}-SINGLE`;
    const primarySingleKey = `${metricId}-${primaryTag}--SINGLE`;
    const stored =
      metricData[singleKey] !== undefined ? metricData[singleKey] :
      metricData[primarySingleKey] !== undefined ? metricData[primarySingleKey] :
      undefined;
    if (stored !== undefined) return stored;
    return metricConfig.inputValue !== undefined ? metricConfig.inputValue : '';
  }
  if (metricConfig.inputType === 'uptake-curve') {
    // Check all three key formats — exact combo first, then primary-only, then secondary-only.
    // This mirrors calculateForPeriod which also tries all three before falling back to inline.
    const exactKey       = `${metricId}-${primaryTag}-${secondaryTag}-${periodLabel}`;
    const primaryKey     = `${metricId}-${primaryTag}--${periodLabel}`;
    const secondaryKey   = `${metricId}--${secondaryTag}-${periodLabel}`;
    if (metricData[exactKey] !== undefined) return metricData[exactKey];
    if (metricData[primaryKey] !== undefined) return metricData[primaryKey];
    if (secondaryTag && metricData[secondaryKey] !== undefined) return metricData[secondaryKey];
    return '';
  }
  const exactKey       = `${metricId}-${primaryTag}-${secondaryTag}-${periodLabel}`;
  const primaryOnlyKey = `${metricId}-${primaryTag}--${periodLabel}`;
  return metricData[exactKey] !== undefined ? metricData[exactKey] : (metricData[primaryOnlyKey] ?? '');
}
