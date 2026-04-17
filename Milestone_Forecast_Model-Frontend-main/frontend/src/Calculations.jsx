import { useApp } from './App.jsx';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { calculateOutputs as apiCalculate } from './api.js';
import {
  generateAnnualPeriods,
  computeLocalOutputs,
  isPercentageOutput,
  getAttributeCombinations,
  getRawInputValue,
  formatSmartNumber,
  formatPercent,
} from './calculationUtils.js';

// Returns an ordering map { tagName: index } based on the segments array (ModelSetup insertion order)
function getPrimaryTagOrder(segments) {
  const order = {};
  let idx = 0;
  (segments || [])
    .filter(s => s.type === 'Primary Attribute')
    .forEach(seg => seg.tags.forEach(tag => {
      if (!(tag in order)) order[tag] = idx++;
    }));
  return order;
}

// Generate full (monthly or annual) timeline for display purposes
function generateTimeline(timeline) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fromIdx = months.indexOf(timeline.fromMonth);
  const toIdx = months.indexOf(timeline.toMonth);
  
  if (timeline.granularity === 'annual') {
    return generateAnnualPeriods(timeline);
  } else {
    const periods = [];
    let year = timeline.fromYear;
    let month = fromIdx;
    
    while (year < timeline.toYear || (year === timeline.toYear && month <= toIdx)) {
      periods.push({
        label: `${months[month]} ${year}`,
        year,
        month: month + 1,
      });
      month++;
      if (month >= 12) {
        month = 0;
        year++;
      }
    }
    return periods;
  }
}

function FormulaDisplay({ formulaRow, allMetrics, defaultMetricNames, metricsState }) {
  const items = formulaRow.items || [];
  
  // Handle both old (metric object) and new (metricId) formats
  const normalizedItems = items.map(item => {
    let metricId = item.metricId;
    
    // If metricId is not set but metric object exists, extract ID
    if (!metricId && item.metric && typeof item.metric === 'object' && item.metric.id) {
      metricId = item.metric.id;
    }
    
    return {
      ...item,
      metricId: metricId
    };
  });
  
  const hasMarketShare = normalizedItems.some(item => item.metricId === 'market-share');

  return (
    <div className="bg-card rounded-lg border border-border-light p-4 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        {normalizedItems.map((item, idx) => {
          // Get metric name with multiple fallback levels
          let metricName = null;
          
          // Check if this is a formula output reference
          if (item.metricId && item.metricId.startsWith('output-')) {
            // Find the formula with this ID and get its output name
            const refFormulaId = item.metricId.replace('output-', '');
            const refFormula = metricsState?.formulaRows?.find(fr => fr.id === refFormulaId);
            if (refFormula) {
              metricName = refFormula.items[refFormula.items.length - 1]?.outputName || 'Unknown';
            } else {
              metricName = 'Unknown';
            }
          }
          
          // Try allMetrics first (if available)
          if (!metricName && allMetrics && item.metricId) {
            const foundMetric = allMetrics.find(m => m.id === item.metricId);
            metricName = foundMetric?.name;
          }
          
          // Fallback to defaultMetricNames
          if (!metricName && item.metricId && defaultMetricNames) {
            metricName = defaultMetricNames[item.metricId];
          }
          
          return (
            <div key={idx} className="flex items-center gap-2">
              {/* Metric Badge - Show for all items with metricId, even if followed by 'equal' */}
              {metricName && (
                <span className="inline-block px-3 py-1.5 bg-primary-light text-primary rounded text-[11px] font-bold whitespace-nowrap">
                  {metricName}
                </span>
              )}
              
              {/* Operator */}
              {item.operator && (
                <span className="text-[16px] font-bold text-text">
                  {item.operator === 'multiply' && '×'}
                  {item.operator === 'divide' && '÷'}
                  {item.operator === 'add' && '+'}
                  {item.operator === 'subtract' && '−'}
                  {item.operator === 'equal' && '='}
                </span>
              )}

              {/* Output name (shown after equal operator) */}
              {item.operator === 'equal' && item.outputName && (
                <span className="inline-block px-3 py-1.5 bg-red-100 text-red-700 rounded text-[11px] font-bold">
                  {item.outputName}
                </span>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Auto-divide note */}
      {hasMarketShare && (
        <div className="mt-3 text-[10px] text-text-muted">
          
        </div>
      )}
    </div>
  );
}

// Table that shows raw input metric data for one metric
function InputTable({ metricName, metricId, metricConfigs, metricData, segments, configuredMetrics, timelinePeriods, isPercentage }) {
  const primaryTagOrder = getPrimaryTagOrder(segments);

  const combos = Array.from(
    getAttributeCombinations(metricId, configuredMetrics, segments, metricConfigs)
  );
  const primaryTags   = [...new Set(combos.map(c => c.split('|')[0]).filter(Boolean))]
    .sort((a, b) => (primaryTagOrder[a] ?? 999) - (primaryTagOrder[b] ?? 999));
  const secondaryTags = [...new Set(combos.map(c => c.split('|')[1]).filter(t => t !== '' && t !== undefined))].sort();
  const hasPrimary   = primaryTags.length > 0;
  const hasSecondary = secondaryTags.length > 0;

  const getCellValue = (primaryTag, secondaryTag, period) => {
    const raw = getRawInputValue(metricId, primaryTag, secondaryTag, period.label, metricData, metricConfigs);
    if (raw === '' || raw === undefined || raw === null) return '—';
    const num = parseFloat(raw);
    if (isNaN(num)) return raw;
    return isPercentage ? `${num.toFixed(0)}%` : formatSmartNumber(num, 2);
  };

  const DASH_STYLE = { borderRight: '2px dashed rgba(192,0,0,0.25)' };
  const SEG_W = 200;
  const COL_W = 110;

  return (
    <div className="rounded-lg border border-border-light overflow-hidden mb-2">
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-low border-b border-border-light">
        <span className="text-[12px] font-bold text-text">{metricName}</span>
        <span className="text-[10px] font-bold" style={{ color: 'rgb(0,160,0)' }}>INPUT</span>
        {isPercentage && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">%</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]" style={{ tableLayout: 'fixed', minWidth: SEG_W + timelinePeriods.length * COL_W }}>
          <colgroup>
            <col style={{ width: SEG_W }} />
            {timelinePeriods.map((_, i) => <col key={i} style={{ width: COL_W }} />)}
          </colgroup>
          <thead>
            <tr className="bg-surface-lowest">
              <th className="px-3 text-left font-bold text-text-muted text-[10px] h-[38px]" style={DASH_STYLE}>
                {hasPrimary && hasSecondary ? 'Primary → Secondary' : hasPrimary ? 'Primary' : 'Secondary'}
              </th>
              {timelinePeriods.map((period, idx) => (
                <th key={idx} className="px-2 text-center font-bold h-[38px] bg-surface-low border border-border-light" style={{ color: 'rgb(192,0,0)' }}>
                  {period.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasPrimary && hasSecondary ? (
              primaryTags.flatMap(primaryTag => [
                <tr key={`h-${primaryTag}`} className="h-10" style={{ background: 'rgba(192,0,0,0.06)' }}>
                  <td className="px-3 font-bold text-[11px] h-10 border-b border-border-light border-l-4" style={{ ...DASH_STYLE, color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)' }}>
                    {primaryTag}
                  </td>
                  {timelinePeriods.map((_, idx) => (
                    <td key={idx} className="border border-border-light h-10" style={{ background: 'rgba(192,0,0,0.03)' }}></td>
                  ))}
                </tr>,
                ...secondaryTags.map(secondaryTag => (
                  <tr key={`${primaryTag}-${secondaryTag}`} className="hover:bg-surface-low h-9">
                    <td className="px-3 pl-7 text-text-muted text-[11px] h-9 border-b border-border-light" style={DASH_STYLE}>
                      {secondaryTag}
                    </td>
                    {timelinePeriods.map((period, pIdx) => (
                      <td key={pIdx} className="border border-border-light px-2 h-9 text-center text-xs font-semibold" style={{ color: 'rgb(0,0,0)' }}>
                        {getCellValue(primaryTag, secondaryTag, period)}
                      </td>
                    ))}
                  </tr>
                ))
              ])
            ) : hasPrimary ? (
              primaryTags.map(pt => (
                <tr key={pt} className="hover:bg-surface-low h-9" style={{ background: 'rgba(192,0,0,0.06)' }}>
                  <td className="px-3 font-bold text-[11px] h-9 border-b border-border-light border-l-4" style={{ ...DASH_STYLE, color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)' }}>
                    {pt}
                  </td>
                  {timelinePeriods.map((period, pIdx) => (
                    <td key={pIdx} className="border border-border-light px-2 h-9 text-center text-xs font-semibold" style={{ color: 'rgb(0,0,0)' }}>
                      {getCellValue(pt, '', period)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              secondaryTags.map(st => (
                <tr key={st} className="hover:bg-surface-low h-9">
                  <td className="px-3 font-bold text-[11px] h-9 border-b border-border-light border-l-4 text-text" style={{ ...DASH_STYLE, color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)' }}>
                    {st}
                  </td>
                  {timelinePeriods.map((period, pIdx) => (
                    <td key={pIdx} className="border border-border-light px-2 h-9 text-center text-xs font-semibold" style={{ color: 'rgb(0,0,0)' }}>
                      {getCellValue('', st, period)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OutputTable({ outputName, outputData, allSegments, timelinePeriods, granularity, isPercentage }) {
  const primaryTagOrder = getPrimaryTagOrder(allSegments);

  // Extract all unique primary and secondary tags from outputData keys
  const allPrimaryTags = new Set();
  const allSecondaryTags = new Set();
  
  Object.keys(outputData).forEach(key => {
    const parts = key.split('-');
    if (parts.length >= 3) {
      const primaryTag = parts[0];
      const secondaryTag = parts[1];
      if (primaryTag) allPrimaryTags.add(primaryTag);
      if (secondaryTag) allSecondaryTags.add(secondaryTag);
    }
  });

  const primaryTags = Array.from(allPrimaryTags)
    .sort((a, b) => (primaryTagOrder[a] ?? 999) - (primaryTagOrder[b] ?? 999));
  const secondaryTags = Array.from(allSecondaryTags).sort();

  const hasPrimary = primaryTags.length > 0;
  const hasSecondary = secondaryTags.length > 0;

  const getCellValue = (primaryTag, secondaryTag, period) => {
    let key;
    if (primaryTag && secondaryTag) {
      key = `${primaryTag}-${secondaryTag}-${period.label}`;
    } else if (primaryTag) {
      key = `${primaryTag}--${period.label}`;
    } else if (secondaryTag) {
      key = `-${secondaryTag}-${period.label}`;
    } else {
      key = `--${period.label}`;
    }
    const raw = outputData[key];
    if (raw === undefined || raw === '') return '';
    if (isPercentage) {
      return `${(parseFloat(raw) * 100).toFixed(0)}%`;
    }
    return formatSmartNumber(parseFloat(raw));
  };

  const DASH_STYLE = { borderRight: '2px dashed rgba(192,0,0,0.25)' };
  const SEG_W = 200;
  const COL_W = 110;

  return (
    <div className="rounded-lg border border-border-light overflow-hidden mb-3">
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]" style={{ tableLayout: 'fixed', minWidth: SEG_W + timelinePeriods.length * COL_W }}>
          <colgroup>
            <col style={{ width: SEG_W }} />
            {timelinePeriods.map((_, i) => <col key={i} style={{ width: COL_W }} />)}
          </colgroup>
          <thead>
            <tr className="bg-surface-lowest">
              <th className="px-3 text-left font-bold text-text-muted text-[11px] h-[38px]" style={DASH_STYLE}>
                {hasPrimary && hasSecondary ? 'Primary → Secondary' : hasPrimary ? 'Primary' : 'Secondary'}
              </th>
              {timelinePeriods.map((period, idx) => (
                <th key={idx} className="px-2 text-center font-bold h-[38px] bg-surface-low border border-border-light" style={{ color: 'rgb(192,0,0)' }}>
                  {period.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasPrimary && hasSecondary ? (
              primaryTags.flatMap((primaryTag) => [
                <tr key={`header-${primaryTag}`} className="h-10" style={{ background: 'rgba(192,0,0,0.06)' }}>
                  <td className="px-3 font-bold text-[11px] h-10 border-b border-border-light border-l-4" style={{ ...DASH_STYLE, color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)' }}>
                    {primaryTag}
                  </td>
                  {timelinePeriods.map((_, idx) => (
                    <td key={idx} className="border border-border-light h-10" style={{ background: 'rgba(192,0,0,0.03)' }}></td>
                  ))}
                </tr>,
                ...secondaryTags.map((secondaryTag) => (
                  <tr key={`${primaryTag}-${secondaryTag}`} className="hover:bg-surface-low h-9">
                    <td className="px-3 pl-8 text-text-muted text-[11px] h-9 border-b border-border-light" style={DASH_STYLE}>
                      {secondaryTag}
                    </td>
                    {timelinePeriods.map((period, pIdx) => (
                      <td key={pIdx} className="border border-border-light px-2 h-9 text-center text-xs font-semibold" style={{ color: 'rgb(0,0,0)' }}>
                        {getCellValue(primaryTag, secondaryTag, period)}
                      </td>
                    ))}
                  </tr>
                ))
              ])
            ) : hasPrimary ? (
              primaryTags.map((primaryTag) => (
                <tr key={primaryTag} className="hover:bg-surface-low h-9">
                  <td className="px-3 font-bold text-[11px] h-9 border-b border-border-light border-l-4" style={{ ...DASH_STYLE, color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)' }}>
                    {primaryTag}
                  </td>
                  {timelinePeriods.map((period, pIdx) => (
                    <td key={pIdx} className="border border-border-light px-2 h-9 text-center text-xs font-semibold" style={{ color: 'rgb(0,0,0)' }}>
                      {getCellValue(primaryTag, '', period)}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              secondaryTags.map((secondaryTag) => (
                <tr key={secondaryTag} className="hover:bg-surface-low h-9">
                  <td className="px-3 font-bold text-[11px] h-9 border-b border-border-light border-l-4 text-text" style={{ ...DASH_STYLE, color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)' }}>
                    {secondaryTag}
                  </td>
                  {timelinePeriods.map((period, pIdx) => (
                    <td key={pIdx} className="border border-border-light px-2 h-9 text-center text-xs font-semibold" style={{ color: 'rgb(0,0,0)' }}>
                      {getCellValue('', secondaryTag, period)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Calculations() {
  const { metricsState, metricData, segments, timeline, configuredMetrics } = useApp();
  const formulaRows = metricsState.formulaRows || [];
  const allMetrics = metricsState.metrics || [];
  const metricConfigs = metricsState.metricConfigs || {};
  const defaultMetricNames = {
    'population': 'Patient Population',
    'market-share': 'Market Share',
    'treatment-rate': 'Treatment Rate',
    'cost-per-patient': 'Cost per Patient',
  };

  const annualPeriods = generateAnnualPeriods(timeline);

  // ── Backend calculation state ─────────────────────────────────────────────
  const [backendOutputs, setBackendOutputs] = useState(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError, setCalcError] = useState(null);
  const [usingBackend, setUsingBackend] = useState(false);

  const runBackendCalc = useCallback(async () => {
    if (formulaRows.length === 0) return;
    setCalcLoading(true);
    setCalcError(null);
    try {
      const result = await apiCalculate({
        formulaRows,
        metricData,
        segments,
        timeline,
        metricConfigs,
        configuredMetrics,
      });
      setBackendOutputs(result.outputs);
      setUsingBackend(true);
    } catch (err) {
      setCalcError(err.message);
      setUsingBackend(false);
    } finally {
      setCalcLoading(false);
    }
  }, [formulaRows, metricData, segments, timeline, metricConfigs, configuredMetrics]);

  useEffect(() => {
    runBackendCalc();
  }, [runBackendCalc]);

  // ── Local (JS) fallback calculation via shared utility ────────────────────
  const localFormulaOutputs = computeLocalOutputs(
    formulaRows, metricData, segments, configuredMetrics, metricConfigs, annualPeriods
  );

  // ── Decide which results to display ──────────────────────────────────────
  // When any formula uses an uptake-curve metric, always use local calculation
  // because the backend doesn't implement per-segment uptake curve key lookup.
  const anyFormulaHasUptakeCurve = formulaRows.some(fr =>
    fr.items?.some(item => {
      const id = item.metricId || item.metric?.id;
      return id && metricConfigs[id]?.inputType === 'uptake-curve';
    })
  );

  const displayOutputs = (usingBackend && backendOutputs && !anyFormulaHasUptakeCurve)
    ? backendOutputs.map(o => {
        const matchingRow = formulaRows.find(r => r.id === o.formulaRowId);
        const formulaRow  = matchingRow || { items: [] };
        return {
          outputName: o.outputName,
          outputData: o.outputData,
          formulaRow,
          isPercentage: isPercentageOutput(formulaRow, metricConfigs, formulaRows),
        };
      })
    : localFormulaOutputs.map(o => ({
        ...o,
        isPercentage: isPercentageOutput(o.formulaRow, metricConfigs, formulaRows),
      }));

  return (
    <div className="h-full overflow-y-auto p-[20px_24px] flex flex-col gap-[16px]">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-primary mb-1">Calculations</h1>
          <p className="text-[13px] text-text-muted max-w-[720px] leading-relaxed">
            
          </p>
        </div>
        {/* Backend status + recalculate button */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {calcLoading && (
            <span className="text-[11px] text-text-muted flex items-center gap-1">
              <span className="mi text-[14px] animate-spin">refresh</span> Calculating…
            </span>
          )}
          {!calcLoading && usingBackend && (
            <span className="text-[11px] text-green-600 flex items-center gap-1">
              <span className="mi text-[14px]">cloud_done</span>
            </span>
          )}
          {!calcLoading && !usingBackend && calcError && (
            <span className="text-[11px] text-amber-500 flex items-center gap-1">
              <span className="mi text-[14px]">warning</span> 
            </span>
          )}
          <button
            disabled={calcLoading || formulaRows.length === 0}
            onClick={runBackendCalc}
            className="inline-flex items-center gap-1.5 py-[7px] px-[14px] rounded-sm text-[11px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="mi text-[14px]">refresh</span> Recalculate
          </button>
        </div>
      </div>

      {/* Outputs Display */}
      <div>
        {displayOutputs.length === 0 ? (
          <div className="bg-surface-low rounded-lg border border-border-light p-8 text-center">
            <span className="mi text-[32px] text-text-muted mb-3 block">calculate</span>
            <p className="text-sm font-semibold text-text-muted mb-1">No formula outputs available</p>
            <div className="text-xs text-text-muted space-y-2 mt-3">
              <p>Make sure you have created and saved formulas in the <strong>Model Setup</strong> page.</p>
              <p>Go to <strong>Model Setup</strong> → <strong>Formula Builder</strong> and create your formulas, then click <strong>"Save & Proceed"</strong>.</p>
            </div>
          </div>
        ) : (
        <>
            {displayOutputs.map((output, idx) => {
              // Collect input metrics in formula order (no duplicates, no output-refs).
              // We keep ALL items that have a metricId — including the one whose operator
              // is 'equal' (the last real input before '='), which was previously excluded.
              const inputItems = (output.formulaRow?.items || [])
                .filter(item => item.metricId && !item.metricId.startsWith('output-'))
                .reduce((acc, item) => {
                  if (!acc.find(i => i.metricId === item.metricId)) acc.push(item);
                  return acc;
                }, []);

              return (
              <div key={idx} className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="mi text-[20px]" style={{ color: 'rgb(192, 0, 0)' }}>assessment</span>
                  <h2 className="text-lg font-bold text-text">{output.outputName}</h2>
                  {output.isPercentage && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">% Output</span>
                  )}
                </div>
                <FormulaDisplay
                  formulaRow={output.formulaRow}
                  allMetrics={allMetrics}
                  defaultMetricNames={defaultMetricNames}
                  metricsState={metricsState}
                />
                {/* Input tables in formula order */}
                {inputItems.length > 0 && (
                  <div className="mb-2">
                    {inputItems.map(item => {
                      const metricId = item.metricId;
                      let metricName = allMetrics.find(m => m.id === metricId)?.name
                        || defaultMetricNames[metricId]
                        || metricId;
                      const isInputPerc =
                        metricConfigs[metricId]?.valueType === 'percentage' ||
                        metricConfigs[metricId]?.inputType === 'uptake-curve';
                      return (
                        <InputTable
                          key={metricId}
                          metricName={metricName}
                          metricId={metricId}
                          metricConfigs={metricConfigs}
                          metricData={metricData}
                          segments={segments}
                          configuredMetrics={configuredMetrics}
                          timelinePeriods={annualPeriods}
                          isPercentage={isInputPerc}
                        />
                      );
                    })}
                  </div>
                )}
                {/* Output table */}
                <div className="flex items-center gap-2 mb-1 mt-2">
                  <span className="text-[12px] font-bold text-text">{output.outputName}</span>
                  <span className="text-[10px] font-bold text-[rgb(192,0,0)]">OUTPUT</span>
                </div>
                <OutputTable
                  outputName={output.outputName}
                  outputData={output.outputData}
                  allSegments={segments}
                  timelinePeriods={annualPeriods}
                  granularity="annual"
                  isPercentage={output.isPercentage}
                />
              </div>
              );
            })}
          </>
        )}
      </div>

      {/* Save & Proceed Button */}
      {displayOutputs.length > 0 && (
        <div className="flex justify-end gap-2 pt-3 border-t border-border-light">
          <button
            onClick={() => {
              toast.success('Calculations saved!');
            }}
            className="inline-flex items-center gap-1.5 py-[8px] px-[16px] rounded-sm text-[12px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground shadow-red hover:opacity-90 transition-all duration-150 border-none cursor-pointer"
          >
            <span className="mi text-[14px]">save</span> Save & Proceed
          </button>
        </div>
      )}
    </div>
  );
}
