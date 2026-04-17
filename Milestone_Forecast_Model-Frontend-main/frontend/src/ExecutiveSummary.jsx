import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { useApp } from './App.jsx';
import {
  generateAnnualPeriods,
  computeLocalOutputs,
  isPercentageOutput,
  computeAnnualTotals,
  computePrimarySegmentAllTimeTotals,
  formatSmartNumber,
  formatPercent,
  formatValue,
} from './calculationUtils.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const OUTPUT_COLORS = [
  'rgb(192,0,0)', 'rgb(192,0,0)', 'rgb(192,0,0)', 'rgb(192,0,0)',
  'rgb(192,0,0)', 'rgb(192,0,0)', 'rgb(192,0,0)', 'rgb(192,0,0)',
];

const DEFAULT_METRIC_NAMES = {
  'population':      'Patient Population',
  'market-share':    'Market Share',
  'treatment-rate':  'Treatment Rate',
  'cost-per-patient':'Cost per Patient',
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function KPICard({ label, value, sub, icon, progress, badge, color = 'text-text' }) {
  return (
    <div className="bg-card rounded-lg p-5 px-[22px] border border-border-light shadow-sm flex flex-col gap-1">
      <div className="text-[11px] text-text-muted font-semibold uppercase tracking-[0.8px] flex items-center gap-1.5">
        {icon && <span className="mi text-[14px] text-primary">{icon}</span>}
        {label}
      </div>
      <div className={`text-[26px] font-extrabold leading-none my-1 ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-text-muted font-medium">{sub}</div>}
      {progress !== undefined && (
        <div className="h-1.5 bg-surface-highest rounded-[3px] overflow-hidden mt-1.5">
          <div
            className="h-full bg-gradient-to-r from-primary to-primary-dark rounded-[3px] transition-all duration-700"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
      {badge && (
        <span className="self-start inline-flex items-center py-[3px] px-[9px] rounded-full text-[10px] font-bold bg-secondary/10 text-secondary mt-0.5">
          {badge}
        </span>
      )}
    </div>
  );
}

// Compact output summary table: rows = primary segments (with secondary breakdown),
// columns = annual periods, last col = CAGR
function OutputSummaryTable({ output, annualPeriods, segments = [] }) {
  const { outputData, isPercentage } = output;

  // Build primary tag order from segments (ModelSetup insertion order)
  const primaryTagOrder = {};
  let orderIdx = 0;
  segments
    .filter(s => s.type === 'Primary Attribute')
    .forEach(seg => seg.tags.forEach(tag => {
      if (!(tag in primaryTagOrder)) primaryTagOrder[tag] = orderIdx++;
    }));

  // Parse unique primary and secondary tags from keys more robustly
  // Keys format: "{primaryTag}-{secondaryTag}-{YYYY}" — strip trailing year first
  const segmentPart = (key) => key.replace(/-\d{4}$/, '');
  const primaryTags = [...new Set(
    Object.keys(outputData).map(k => {
      const seg = segmentPart(k);
      const idx = seg.indexOf('-');
      return idx === -1 ? seg : seg.substring(0, idx);
    }).filter(Boolean)
  )].sort((a, b) => (primaryTagOrder[a] ?? 999) - (primaryTagOrder[b] ?? 999));
  const secondaryTags = [...new Set(
    Object.keys(outputData).map(k => {
      const seg = segmentPart(k);
      const idx = seg.indexOf('-');
      return idx !== -1 ? seg.substring(idx + 1) : '';
    }).filter(t => t !== '')
  )].sort();

  const hasBoth = primaryTags.length > 0 && secondaryTags.length > 0;
  const hasPrimary = primaryTags.length > 0;

  const getCell = (primary, secondary, periodLabel) => {
    const key = `${primary}-${secondary}-${periodLabel}`;
    const alt = `${primary}--${periodLabel}`;
    const val = outputData[key] !== undefined ? outputData[key] : outputData[alt];
    return val !== undefined && val !== '' ? parseFloat(val) : null;
  };

  const rowTotal = (primary, secondary) => {
    const vals = annualPeriods
      .map(p => getCell(primary, secondary, p.label))
      .filter(v => v !== null);
    if (vals.length === 0) return null;
    return isPercentage
      ? (vals.reduce((a, b) => a + b, 0) / vals.length) * 100
      : vals.reduce((a, b) => a + b, 0);
  };

  const primarySubtotal = (primary, periodLabel) => {
    if (!hasBoth) return null;
    const vals = secondaryTags
      .map(s => getCell(primary, s, periodLabel))
      .filter(v => v !== null);
    if (vals.length === 0) return null;
    return isPercentage
      ? (vals.reduce((a, b) => a + b, 0) / vals.length) * 100
      : vals.reduce((a, b) => a + b, 0);
  };

  const grandTotal = (periodLabel) => {
    const allVals = Object.entries(outputData)
      .filter(([k]) => k.endsWith(`-${periodLabel}`))
      .map(([, v]) => parseFloat(v))
      .filter(v => !isNaN(v));
    if (allVals.length === 0) return null;
    return isPercentage
      ? (allVals.reduce((a, b) => a + b, 0) / allVals.length) * 100
      : allVals.reduce((a, b) => a + b, 0);
  };

  // Removed: computeCAGR, rowCAGR, subtotalCAGR, grandCAGR, fmtCAGR
  const fmt = (v) => formatValue(v, isPercentage);


  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] border-collapse table-fixed">
        <thead>
          <tr className="bg-surface-low">
            {hasBoth && <th className="border border-border-light px-2 py-1.5 text-left font-bold text-primary w-[100px]">Primary</th>}
            {hasBoth && <th className="border border-border-light px-2 py-1.5 text-left font-semibold text-text-muted w-[100px]">Secondary</th>}
            {!hasBoth && hasPrimary && <th className="border border-border-light px-2 py-1.5 text-left font-bold text-primary w-[100px]">Segment</th>}
            {!hasBoth && !hasPrimary && <th className="border border-border-light px-2 py-1.5 text-left font-bold text-primary w-[100px]">Segment</th>}
            {annualPeriods.map(p => (
              <th key={p.label} className="border border-border-light px-2 py-1.5 text-center font-bold text-primary w-[100px]">{p.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasBoth ? (
            primaryTags.flatMap((primary, pIdx) => [
              // Secondary rows
              ...secondaryTags.map((secondary, sIdx) => (
                <tr key={`${primary}-${secondary}`} className="hover:bg-surface-lowest">
                  {sIdx === 0 && (
                    <td rowSpan={secondaryTags.length + 1}
                      className="border border-border-light px-2 py-1.5 font-bold text-primary bg-primary/5 border-l-2 border-l-primary align-top">
                      {primary}
                    </td>
                  )}
                  <td className="border border-border-light px-2 py-1.5 text-text-muted pl-3">{secondary}</td>
                  {annualPeriods.map(p => {
                    const v = getCell(primary, secondary, p.label);
                    return (
                      <td key={p.label} className="border border-border-light px-2 py-1.5 text-center font-mono text-xs" style={{ color: 'rgb(192,0,0)' }}>
                        {v !== null ? fmt(isPercentage ? v * 100 : v) : '—'}
                      </td>
                    );
                  })}
                </tr>
              )),
              // Subtotal row for primary
              <tr key={`${primary}-subtotal`} className="bg-primary/5">
                <td className="border border-border-light px-2 py-1.5 text-xs font-bold text-primary italic pl-3">Subtotal</td>
                {annualPeriods.map(p => {
                  const v = primarySubtotal(primary, p.label);
                  return (
                    <td key={p.label} className="border border-border-light px-2 py-1.5 text-center font-bold text-xs" style={{ color: 'rgb(192,0,0)' }}>
                      {v !== null ? fmt(v) : '—'}
                    </td>
                  );
                })}
              </tr>,
            ])
          ) : hasPrimary ? (
            primaryTags.map(primary => (
              <tr key={primary} className="hover:bg-surface-lowest">
                <td className="border border-border-light px-2 py-1.5 font-bold text-primary border-l-2 border-l-primary">{primary}</td>
                {annualPeriods.map(p => {
                  const v = getCell(primary, '', p.label);
                  return (
                    <td key={p.label} className="border border-border-light px-2 py-1.5 text-center font-mono text-xs" style={{ color: 'rgb(192,0,0)' }}>
                      {v !== null ? fmt(isPercentage ? v * 100 : v) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))
          ) : (
            secondaryTags.map(secondary => (
              <tr key={secondary} className="hover:bg-surface-lowest">
                <td className="border border-border-light px-2 py-1.5 font-bold text-secondary border-l-2 border-l-secondary">{secondary}</td>
                {annualPeriods.map(p => {
                  const v = getCell('', secondary, p.label);
                  return (
                    <td key={p.label} className="border border-border-light px-2 py-1.5 text-center font-mono text-xs" style={{ color: 'rgb(192,0,0)' }}>
                      {v !== null ? fmt(isPercentage ? v * 100 : v) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))
          )}

          {/* Grand Total Row */}
          <tr className="bg-surface-highest font-bold">
            {hasBoth && <td className="border border-border-light px-2 py-2 text-xs font-extrabold text-text" colSpan={2}>TOTAL</td>}
            {!hasBoth && <td className="border border-border-light px-2 py-2 text-xs font-extrabold text-text">TOTAL</td>}
            {annualPeriods.map(p => {
              const v = grandTotal(p.label);
              return (
                <td key={p.label} className="border border-border-light px-2 py-2 text-center font-extrabold text-xs" style={{ color: 'rgb(192,0,0)' }}>
                  {v !== null ? fmt(v) : '—'}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Custom tooltip for trend chart
function TrendTooltip({ active, payload, label, isPercentage }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border-light rounded-lg p-3 shadow-lg text-xs">
      <div className="font-bold text-text mb-1.5">{label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: entry.color }} />
          <span className="text-text-muted">{entry.name}:</span>
          <span className="font-bold text-text">
            {entry.payload[`${entry.name}_isPerc`]
              ? formatPercent(entry.value)
              : formatSmartNumber(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ExecutiveSummary() {
  const { metricsState, metricData, segments, timeline, configuredMetrics } = useApp();

  const [chartType, setChartType] = useState('area');
  const [selectedOutputName, setSelectedOutputName] = useState('__all__');
  const [trendOutputName, setTrendOutputName]     = useState('__first__');
  const [breakdownOutputName, setBreakdownOutputName] = useState('__first__');
  const [breakdownSegType, setBreakdownSegType]   = useState('primary');

  const formulaRows    = metricsState.formulaRows    || [];
  const metricConfigs  = metricsState.metricConfigs  || {};

  const annualPeriods = useMemo(() => generateAnnualPeriods(timeline), [timeline]);

  // ── Run local calculations ────────────────────────────────────────────────
  const rawOutputs = useMemo(
    () => computeLocalOutputs(formulaRows, metricData, segments, configuredMetrics, metricConfigs, annualPeriods),
    [formulaRows, metricData, segments, configuredMetrics, metricConfigs, annualPeriods]
  );

  // ── Enrich outputs with type & totals ────────────────────────────────────
  const enrichedOutputs = useMemo(() => rawOutputs.map((output, idx) => {
    const isPerc      = isPercentageOutput(output.formulaRow, metricConfigs, formulaRows);
    const annualTotals = computeAnnualTotals(output.outputData, annualPeriods, isPerc);
    const primarySegTotals = computePrimarySegmentAllTimeTotals(output.outputData, isPerc);
    return { ...output, isPercentage: isPerc, annualTotals, primarySegTotals, color: OUTPUT_COLORS[idx % OUTPUT_COLORS.length] };
  }), [rawOutputs, annualPeriods, metricConfigs, formulaRows]);

  // ── Filtered outputs based on dropdown selection ──────────────────────────
  const visibleOutputs = useMemo(() => {
    if (selectedOutputName === '__all__') return enrichedOutputs;
    return enrichedOutputs.filter(o => o.outputName === selectedOutputName);
  }, [enrichedOutputs, selectedOutputName]);

  // ── Single output shown in the Trend chart ───────────────────────────────
  const trendOutput = useMemo(() => {
    if (trendOutputName === '__first__' || !trendOutputName) return enrichedOutputs[0] ?? null;
    return enrichedOutputs.find(o => o.outputName === trendOutputName) ?? enrichedOutputs[0] ?? null;
  }, [enrichedOutputs, trendOutputName]);

  // ── Output used in Segment Breakdown donut ───────────────────────────────
  const breakdownOutput = useMemo(() => {
    if (breakdownOutputName === '__first__' || !breakdownOutputName) {
      return enrichedOutputs.find(o => !o.isPercentage) ?? enrichedOutputs[0] ?? null;
    }
    return enrichedOutputs.find(o => o.outputName === breakdownOutputName) ?? enrichedOutputs[0] ?? null;
  }, [enrichedOutputs, breakdownOutputName]);

  // ── KPI Computations ─────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const numericOuts  = enrichedOutputs.filter(o => !o.isPercentage);
    const percentOuts  = enrichedOutputs.filter(o => o.isPercentage);

    // Primary numeric output = the one with the highest peak year total
    const primaryOut = numericOuts.reduce((best, cur) => {
      const curPeak  = Math.max(...Object.values(cur.annualTotals).filter(v => v > 0), 0);
      const bestPeak = best ? Math.max(...Object.values(best.annualTotals).filter(v => v > 0), 0) : -Infinity;
      return curPeak > bestPeak ? cur : best;
    }, null);

    let peakYear = null, peakValue = 0;
    if (primaryOut) {
      Object.entries(primaryOut.annualTotals).forEach(([yr, val]) => {
        if (val > peakValue) { peakValue = val; peakYear = yr; }
      });
    }

    // 5-year cumulative
    const totalsByYear = primaryOut ? Object.values(primaryOut.annualTotals) : [];
    const fiveYearCumulative = totalsByYear.slice(0, 5).reduce((a, b) => a + b, 0);

    // CAGR from first to last year (if ≥ 2 years and values > 0)
    let cagr = null;
    if (primaryOut && totalsByYear.length >= 2) {
      const first = totalsByYear[0];
      const last  = totalsByYear[totalsByYear.length - 1];
      const n     = totalsByYear.length - 1;
      if (first > 0 && last > 0) cagr = (Math.pow(last / first, 1 / n) - 1) * 100;
    }

    // Peak market share: from a percentage output OR from market-share metricData
    let peakMarketSharePct = null;
    let peakMSYear         = null;
    if (percentOuts.length > 0) {
      const msOut = percentOuts[0];
      Object.entries(msOut.annualTotals).forEach(([yr, val]) => {
        if (peakMarketSharePct === null || val > peakMarketSharePct) {
          peakMarketSharePct = val;
          peakMSYear = yr;
        }
      });
    } else {
      // Fall back to raw market-share input metric
      let maxVal = 0;
      Object.entries(metricData).forEach(([key, val]) => {
        if (key.startsWith('market-share-')) {
          const num = parseFloat(val);
          if (!isNaN(num) && num > maxVal) { maxVal = num; }
        }
      });
      if (maxVal > 0) peakMarketSharePct = maxVal;
    }

    return {
      primaryOutputName: primaryOut?.outputName ?? null,
      peakYear, peakValue, fiveYearCumulative, cagr,
      peakMarketSharePct, peakMSYear,
    };
  }, [enrichedOutputs, metricData]);

  // ── Trend chart data (single selected output) ────────────────────────────
  const trendChartData = useMemo(() => {
    if (!trendOutput) return [];
    return annualPeriods.map(period => ({
      year: period.label,
      [trendOutput.outputName]: trendOutput.annualTotals[period.label] ?? 0,
      [`${trendOutput.outputName}_isPerc`]: trendOutput.isPercentage,
    }));
  }, [annualPeriods, trendOutput]);

  // ── Donut chart data (selected output × selected segment type) ────────────
  const donutData = useMemo(() => {
    if (!breakdownOutput) return [];
    const pieColors = ['#bd302b', '#8f1f1b', '#e8877f', '#006a63', '#9f4300', '#6b7280', '#8b5cf6', '#0ea5e9'];

    // Aggregate totals per segment tag from outputData keys
    // key format: "{primaryTag}-{secondaryTag}-{YYYY}"
    const totals = {};
    for (const [key, rawVal] of Object.entries(breakdownOutput.outputData)) {
      const val = parseFloat(rawVal);
      if (isNaN(val)) continue;
      // Strip trailing year
      const withoutYear = key.replace(/-\d{4}$/, '');
      const dashIdx = withoutYear.indexOf('-');
      const primaryTag   = dashIdx === -1 ? withoutYear : withoutYear.substring(0, dashIdx);
      const secondaryTag = dashIdx === -1 ? ''          : withoutYear.substring(dashIdx + 1);
      const tag = breakdownSegType === 'primary' ? primaryTag : secondaryTag;
      if (!tag) continue;
      totals[tag] = (totals[tag] ?? 0) + val;
    }

    const total = Object.values(totals).reduce((a, b) => a + b, 0);
    return Object.entries(totals).map(([name, value], idx) => ({
      name,
      value: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
      rawValue: value,
      color: pieColors[idx % pieColors.length],
    }));
  }, [breakdownOutput, breakdownSegType]);

  const hasData = enrichedOutputs.length > 0;

  // ── Y-axis tick formatter for trend chart ─────────────────────────────────
  const yAxisFmt = (v) => {
    return trendOutput?.isPercentage ? `${v.toFixed(0)}%` : formatSmartNumber(v, 1);
  };

  return (
    <div className="h-full overflow-y-auto p-[26px_28px] flex flex-col gap-[22px]">

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-primary mb-1">Executive Summary</h1>
          <p className="text-[13px] text-text-muted max-w-[520px] leading-relaxed">
            Forecast results, annual output totals, and data breakdown for stakeholder review.
          </p>
        </div>
      </div>

      {/* ── Empty State ── */}
      {!hasData && (
        <div className="bg-surface-low rounded-lg border border-border-light p-10 text-center">
          <span className="mi text-[38px] text-text-muted mb-3 block">bar_chart</span>
          <p className="text-sm font-semibold text-text-muted mb-1">No calculation results yet</p>
          <p className="text-xs text-text-muted">Build formulas in <strong>Model Setup</strong>, enter data in <strong>ACE</strong>, then view <strong>Calculations</strong> to generate outputs.</p>
        </div>
      )}

      {hasData && (<>

        {/* ── Charts (above totals table) ── */}
        <div className="grid grid-cols-[2fr_1fr] gap-[18px]">
          {/* Trend Chart */}
          <div className="bg-surface-low rounded-lg border border-border-light p-5">
            <div className="text-sm font-bold text-text flex items-center gap-2 mb-3">
              <span className="mi text-[18px] text-primary">show_chart</span>
              Output Trends ({timeline.fromYear}–{timeline.toYear})
            </div>
            {/* Controls row — same vertical level as Segment Breakdown controls */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {enrichedOutputs.length > 1 && (
                <div className="relative flex items-center flex-1 min-w-0">
                  <select
                    value={trendOutputName}
                    onChange={e => setTrendOutputName(e.target.value)}
                    className="w-full appearance-none pl-3 pr-7 py-[6px] text-[12px] font-semibold border border-border rounded-sm bg-card text-text hover:border-primary focus:outline-none focus:border-primary transition-colors cursor-pointer"
                  >
                    {enrichedOutputs.map(o => (
                      <option key={o.outputName} value={o.outputName}>{o.outputName}</option>
                    ))}
                  </select>
                  <span className="mi absolute right-1.5 top-1/2 -translate-y-1/2 text-[14px] text-text-muted pointer-events-none">expand_more</span>
                </div>
              )}
              {/* Chart type toggle — area and bar only */}
              <div className="flex bg-surface-highest p-[3px] rounded-[9px] gap-0.5 flex-shrink-0">
                {['area', 'bar'].map(t => (
                  <button key={t} onClick={() => setChartType(t)}
                    className={`py-1.5 px-3 border-none rounded-[7px] text-[11px] cursor-pointer transition-all duration-150 ${
                      chartType === t ? 'bg-card text-primary font-bold shadow-sm' : 'bg-transparent text-text-muted font-medium'
                    }`}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                {!trendOutput ? <AreaChart data={[]}><XAxis /><YAxis /></AreaChart> :
                chartType === 'bar' ? (
                  <BarChart data={trendChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={yAxisFmt} tick={{ fontSize: 11 }} width={65} />
                    <Tooltip content={<TrendTooltip />} />
                    <Bar dataKey={trendOutput.outputName} fill={trendOutput.color} radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : (
                  <AreaChart data={trendChartData}>
                    <defs>
                      <linearGradient id="grad-trend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={trendOutput.color} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={trendOutput.color} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={yAxisFmt} tick={{ fontSize: 11 }} width={65} />
                    <Tooltip content={<TrendTooltip />} />
                    <Area type="monotone" dataKey={trendOutput.outputName}
                      stroke={trendOutput.color} strokeWidth={2}
                      fill="url(#grad-trend)" />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            {trendOutput && (
              <div className="flex items-center gap-1.5 mt-3 text-xs text-text-muted">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: trendOutput.color }} />
                {trendOutput.outputName}
                {trendOutput.isPercentage && <span className="text-[9px] text-purple-600 font-bold">%</span>}
              </div>
            )}
          </div>

          {/* Donut Chart */}
          <div className="bg-surface-low rounded-lg border border-border-light p-5">
            <div className="text-sm font-bold text-text flex items-center gap-2 mb-3">
              <span className="mi text-[18px] text-primary">donut_large</span> Segment Breakdown
            </div>

            {/* Controls: output selector + primary/secondary toggle */}
            <div className="flex flex-col gap-2 mb-3">
              {enrichedOutputs.length > 1 && (
                <div className="relative flex items-center">
                  <select
                    value={breakdownOutputName}
                    onChange={e => setBreakdownOutputName(e.target.value)}
                    className="w-full appearance-none pl-3 pr-7 py-[6px] text-[12px] font-semibold border border-border rounded-sm bg-card text-text hover:border-primary focus:outline-none focus:border-primary transition-colors cursor-pointer"
                  >
                    {enrichedOutputs.map(o => (
                      <option key={o.outputName} value={o.outputName}>{o.outputName}</option>
                    ))}
                  </select>
                  <span className="mi absolute right-1.5 top-1/2 -translate-y-1/2 text-[14px] text-text-muted pointer-events-none">expand_more</span>
                </div>
              )}
              <div className="flex bg-surface-highest p-[2px] rounded-[7px] gap-0.5">
                {[['primary', 'Primary'], ['secondary', 'Secondary']].map(([val, label]) => (
                  <button key={val} onClick={() => setBreakdownSegType(val)}
                    className={`flex-1 py-[4px] px-1 border-none rounded-[5px] text-[10px] cursor-pointer transition-all ${
                      breakdownSegType === val ? 'bg-card text-primary font-bold shadow-sm' : 'bg-transparent text-text-muted font-medium'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {donutData.length > 0 ? (<>
              <div className="h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} dataKey="value" innerRadius="65%" outerRadius="88%" paddingAngle={2}>
                      {donutData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(v, name, props) => [`${v}%`, name]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-2 mt-2.5">
                {donutData.map(d => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                      <span className="text-text-muted">{d.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-text-muted font-mono text-[10px]">{formatSmartNumber(d.rawValue)}</span>
                      <strong className="text-text">{d.value}%</strong>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-text-muted mt-2.5 italic">
                {breakdownOutput?.outputName} — all-time total by {breakdownSegType} segment
              </p>
            </>) : (
              <div className="h-[140px] flex items-center justify-center text-xs text-text-muted">
                No {breakdownSegType} segment data available
              </div>
            )}
          </div>
        </div>

        {/* ── Output Annual Totals (below charts) ── */}
        <div className="flex flex-col gap-[18px]">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="mi text-[20px] text-primary">assessment</span>
              <h2 className="text-[15px] font-extrabold text-text">Output Summary</h2>
              <span className="text-[11px] text-text-muted ml-1"></span>
            </div>
            {/* Output filter dropdown — moved here from the page header */}
            {enrichedOutputs.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-[12px] font-semibold text-text-muted whitespace-nowrap">View Output:</label>
                <div className="relative">
                  <select
                    value={selectedOutputName}
                    onChange={e => setSelectedOutputName(e.target.value)}
                    className="appearance-none pl-3 pr-8 py-[6px] text-[12px] font-semibold border border-border rounded-sm bg-card text-text hover:border-primary focus:outline-none focus:border-primary transition-colors cursor-pointer"
                  >
                    <option value="__all__">All Outputs</option>
                    {enrichedOutputs.map(o => (
                      <option key={o.outputName} value={o.outputName}>{o.outputName}</option>
                    ))}
                  </select>
                  <span className="mi absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-text-muted pointer-events-none">expand_more</span>
                </div>
              </div>
            )}
          </div>

          {visibleOutputs.map((output, idx) => (
            <div key={output.outputName} className="bg-card rounded-lg border border-border-light overflow-hidden">
              {/* Output header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-border-light bg-surface-low">
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: output.color }} />
                  <span className="text-[13px] font-extrabold text-text">{output.outputName}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${output.isPercentage ? 'bg-purple-100 text-purple-700' : 'bg-primary/10 text-primary'}`}>
                    {output.isPercentage ? 'Percentage Output' : 'Numeric Output'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <span>Peak: <strong className="text-text">{formatValue(
                    Math.max(...Object.values(output.annualTotals)), output.isPercentage
                  )}</strong></span>
                </div>
              </div>
              <div>
                <OutputSummaryTable output={output} annualPeriods={annualPeriods} segments={segments} />
              </div>
            </div>
          ))}
        </div>

      </>)}
    </div>
  );
}
