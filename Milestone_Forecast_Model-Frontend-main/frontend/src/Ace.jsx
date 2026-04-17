import { useApp } from './App.jsx';
import { useState, useCallback, useEffect, Fragment } from 'react';
import { toast } from 'sonner';
import { fetchUptakeCurve } from './api.js';

// Hide number input spinners (arrows)
const styles = `
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type="number"] {
    -moz-appearance: textfield;
  }
`;

// Format a raw numeric string with thousand separators for display
const fmtNum = (val) => {
  if (val === '' || val === undefined || val === null) return '';
  const num = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num)) return val;
  return num.toLocaleString('en-US');
};
const stripCommas = (val) => String(val).replace(/,/g, '');

// Generate date range based on timeline
function generateTimeline(timeline) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fromIdx = months.indexOf(timeline.fromMonth);
  const toIdx = months.indexOf(timeline.toMonth);
  
  if (timeline.granularity === 'annual') {
    // Generate years only
    const years = [];
    for (let y = timeline.fromYear; y <= timeline.toYear; y++) {
      years.push({ label: `${y}`, year: y, month: null });
    }
    return years;
  } else {
    // Generate months
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


// Uptake Curve: 3-param inputs + year-by-year computed data table
function UptakeCurveTable({ metric, metricConfig, timelinePeriods, primaryTags = [], secondaryTags = [] }) {
  const { metricsState, setMetricsState, metricData, setMetricData } = useApp();

  const segmentPeakValues      = metricConfig.segmentPeakValues      ?? {};
  const segmentMonthsToPeak    = metricConfig.segmentMonthsToPeak    ?? {};
  const segmentDiffusionConstant = metricConfig.segmentDiffusionConstant ?? {};

  const curveKeys = (() => {
    if (primaryTags.length > 0 && secondaryTags.length > 0) {
      const combos = [];
      primaryTags.forEach((p) => secondaryTags.forEach((s) => combos.push(`${p}|${s}`)));
      return combos;
    }
    if (primaryTags.length > 0) return primaryTags.map((p) => `${p}|`);
    if (secondaryTags.length > 0) return secondaryTags.map((s) => `|${s}`);
    return ['Default|'];
  })();

  const labelForKey = (key) => {
    const [p, s] = key.split('|');
    if (p && s) return `${p} -> ${s}`;
    if (p) return p;
    if (s) return s;
    return 'Default';
  };

  const [segmentRows, setSegmentRows] = useState({});
  const [segmentYearsToPeak, setSegmentYearsToPeak] = useState({});
  const [error, setError] = useState('');

  const updateSegmentField = (field, tag, value) => {
    setMetricsState(prev => ({
      ...prev,
      metricConfigs: {
        ...prev.metricConfigs,
        [metric.id]: {
          ...(prev.metricConfigs?.[metric.id] || {}),
          [field]: {
            ...(prev.metricConfigs?.[metric.id]?.[field] || {}),
            [tag]: value,
          },
        },
      },
    }));
  };

  const updateSegmentPeak = (tag, value) => updateSegmentField('segmentPeakValues', tag, value);
  const updateSegmentMtp  = (tag, value) => updateSegmentField('segmentMonthsToPeak', tag, value);
  const updateSegmentDc   = (tag, value) => updateSegmentField('segmentDiffusionConstant', tag, value);

  const fromYear = timelinePeriods[0]?.year ?? new Date().getFullYear();
  const toYear   = timelinePeriods[timelinePeriods.length - 1]?.year ?? fromYear + 5;

  const buildAllCurves = useCallback(() => {
    const allValid = curveKeys.every((curveKey) => {
      const mtp = parseFloat(segmentMonthsToPeak[curveKey]);
      const dc  = parseFloat(segmentDiffusionConstant[curveKey]);
      const pv  = parseFloat(segmentPeakValues[curveKey]);
      return !isNaN(mtp) && mtp > 0 && !isNaN(dc) && dc >= 1 && dc <= 2 && !isNaN(pv) && pv >= 0;
    });
    if (!allValid || curveKeys.length === 0) { setSegmentRows({}); setError(''); return; }

    const hasInvalidDc = curveKeys.some((curveKey) => {
      const dc = parseFloat(segmentDiffusionConstant[curveKey]);
      return dc < 1 || dc > 2;
    });
    if (hasInvalidDc) { setError('Diffusion constant must be between 1.0 and 2.0 for all segments'); setSegmentRows({}); return; }

    setError('');

    // Compute locally first (instant, no API dependency)
    const computeLocal = (pv_num, mtp, dc) => {
      const ytp = Math.max(1, Math.round(mtp / 12));
      const exp = 1 / (dc - 0.5);
      const rows = [];
      for (let y = fromYear; y <= toYear; y++) {
        const idx = y - fromYear + 1;
        const val = idx >= ytp ? pv_num : pv_num * Math.pow(idx / ytp, exp);
        rows.push({ year: String(y), value: Math.round(val * 10000) / 10000 });
      }
      return { ytp, rows };
    };

    const results = {};
    const ytpMap = {};
    for (const curveKey of curveKeys) {
      const pv  = parseFloat(segmentPeakValues[curveKey]);
      const mtp = parseFloat(segmentMonthsToPeak[curveKey]);
      const dc  = parseFloat(segmentDiffusionConstant[curveKey]);
      const { ytp, rows } = computeLocal(pv, mtp, dc);
      results[curveKey] = rows;
      ytpMap[curveKey] = ytp;
    }
    setSegmentYearsToPeak(ytpMap);
    setSegmentRows(results);

    // Persist computed curve values into metricData so Calculations can look them up.
    // Key format: `${metric.id}-${tag}--${year}` (primary-only, no secondary tag).
    setMetricData(prev => {
      const updates = { ...prev };
      // Store a flag so calculateForPeriod can detect uptake-curve even if metricConfigs is stale
      updates[`${metric.id}--is-uptake-curve`] = true;
      for (const curveKey of curveKeys) {
        const [p, s] = curveKey.split('|');
        for (const { year, value } of (results[curveKey] || [])) {
          updates[`${metric.id}-${p}-${s}-${year}`] = value;
          if (p && !s) updates[`${metric.id}-${p}--${year}`] = value;
          if (!p && s) updates[`${metric.id}--${s}-${year}`] = value;
        }
      }
      return updates;
    });

    // Optionally refine with backend (fire-and-forget, 3s timeout)
    (async () => {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 3000);
        const refined = {};
        for (const curveKey of curveKeys) {
          const pv  = parseFloat(segmentPeakValues[curveKey]);
          const mtp = parseFloat(segmentMonthsToPeak[curveKey]);
          const dc  = parseFloat(segmentDiffusionConstant[curveKey]);
          const res = await fetchUptakeCurve({
            months_to_peak: mtp, diffusion_constant: dc,
            peak_value: pv, from_year: fromYear, to_year: toYear,
          }, controller.signal);
          if (res?.status === 'ok') {
            refined[curveKey] = Object.entries(res.curve)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([year, value]) => ({ year, value }));
          }
        }
        clearTimeout(tid);
        if (Object.keys(refined).length === curveKeys.length) {
          setSegmentRows(refined);
          setMetricData(prev => {
            const updates = { ...prev };
            updates[`${metric.id}--is-uptake-curve`] = true;
            for (const curveKey of curveKeys) {
              const [p, s] = curveKey.split('|');
              for (const { year, value } of (refined[curveKey] || [])) {
                updates[`${metric.id}-${p}-${s}-${year}`] = value;
                if (p && !s) updates[`${metric.id}-${p}--${year}`] = value;
                if (!p && s) updates[`${metric.id}--${s}-${year}`] = value;
              }
            }
            return updates;
          });
        }
      } catch { /* backend unavailable — local result already shown */ }
    })();
  }, [segmentMonthsToPeak, segmentDiffusionConstant, segmentPeakValues, curveKeys, fromYear, toYear]);

  useEffect(() => {
    const t = setTimeout(buildAllCurves, 400);
    return () => clearTimeout(t);
  }, [buildAllCurves]);

  const years = Object.values(segmentRows)[0]?.map(r => r.year) || [];
  const hasData = years.length > 0;
  const hasPrimaryAndSecondary = primaryTags.length > 0 && secondaryTags.length > 0;

  return (
    <div className="bg-card rounded-lg border border-border-light overflow-hidden mb-4">
      {/* Input table: grouped by primary tag, columns = MTP | DC | Peak Value */}
      <div className="border-b border-border-light overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border-light">
              <th className="text-left px-4 py-2 font-bold text-text-muted w-[180px] border-r border-border-light">
                {hasPrimaryAndSecondary ? 'Primary → Secondary' : 'Segment'}
              </th>
              <th className="text-center px-3 py-2 font-bold text-primary border-r border-border-light w-[120px]">
                MTP <span className="text-text-muted font-normal normal-case">(months)</span>
              </th>
              <th className="text-center px-3 py-2 font-bold text-primary border-r border-border-light w-[120px]">
                DC <span className="text-text-muted font-normal normal-case">(1.0–2.0)</span>
              </th>
              <th className="text-center px-3 py-2 font-bold text-primary w-[120px]">
                Peak Value <span className="text-text-muted font-normal normal-case">(%)</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {hasPrimaryAndSecondary ? (
              primaryTags.map((primaryTag) => {
                const secRows = secondaryTags.filter((s) => curveKeys.includes(`${primaryTag}|${s}`));
                return (
                  <Fragment key={`group-${primaryTag}`}>
                    <tr className="border-b border-border-light bg-primary/10">
                      <td className="px-4 py-2.5 font-bold border-r border-border-light border-l-[3px] text-[rgb(192,0,0)] text-[11px]" style={{ borderLeftColor: 'rgb(192,0,0)' }} colSpan={4}>
                        {primaryTag}
                      </td>
                    </tr>
                    {secRows.map((secondaryTag, idx) => {
                      const curveKey = `${primaryTag}|${secondaryTag}`;
                      const mtp    = segmentMonthsToPeak[curveKey]    ?? '';
                      const dc     = segmentDiffusionConstant[curveKey] ?? '';
                      const ytp    = segmentYearsToPeak[curveKey];
                      const dcVal  = parseFloat(dc);
                      const dcLabel = isNaN(dcVal) ? '' : dcVal === 1.5 ? 'Linear' : dcVal < 1.5 ? 'Slow' : 'Fast';
                      return (
                        <tr key={curveKey} className={`border-b border-border-light ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                          <td className="px-4 py-2 font-semibold text-text-muted text-[11px] border-r border-border-light pl-9 w-[180px]">
                            {secondaryTag}
                          </td>
                          <td className="px-3 py-2 border-r border-border-light w-[120px]">
                            <input
                              type="number" min="1"
                              value={mtp}
                              onChange={(e) => updateSegmentMtp(curveKey, e.target.value)}
                              placeholder="e.g. 24"
                              className="w-full px-2 py-1 border border-border rounded-sm text-[11px] font-semibold bg-card text-text outline-none focus:border-primary"
                            />
                            {ytp && mtp && (
                              <div className="text-[9px] text-text-muted mt-0.5">≈ {ytp} yr{ytp !== 1 ? 's' : ''}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 border-r border-border-light w-[120px]">
                            <input
                              type="number" min="1" max="2" step="0.01"
                              value={dc}
                              onChange={(e) => updateSegmentDc(curveKey, e.target.value)}
                              placeholder="1.0–2.0"
                              className="w-full px-2 py-1 border border-border rounded-sm text-[11px] font-semibold bg-card text-text outline-none focus:border-primary"
                            />
                            {dcLabel && <div className="text-[9px] text-primary font-semibold mt-0.5">{dcLabel}</div>}
                          </td>
                          <td className="px-3 py-2 w-[120px]">
                            <div className="flex items-center border border-border rounded-sm bg-card focus-within:border-primary overflow-hidden">
                              <input
                                type="number" min="0" max="100"
                                value={segmentPeakValues[curveKey] ?? ''}
                                onChange={(e) => updateSegmentPeak(curveKey, e.target.value)}
                                placeholder="e.g. 80"
                                className="flex-1 min-w-0 px-2 py-1 text-[11px] font-semibold bg-transparent text-text outline-none border-none"
                              />
                              <span className="px-2 text-[11px] font-bold text-black bg-gray-100 border-l border-border select-none">%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })
            ) : (
              curveKeys.map((curveKey, idx) => (
                <tr key={curveKey} className={`border-b border-border-light ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                  <td className="px-4 py-2 font-semibold text-text text-[11px] border-r border-border-light border-l-[3px] w-[180px]" style={{ borderLeftColor: 'rgb(192,0,0)' }}>
                    {labelForKey(curveKey)}
                  </td>
                  {/* MTP */}
                  <td className="px-3 py-2 border-r border-border-light">
                    <div>
                      <input
                        type="number" min="1"
                        value={segmentMonthsToPeak[curveKey] ?? ''}
                        onChange={(e) => updateSegmentMtp(curveKey, e.target.value)}
                        placeholder="e.g. 24"
                        className="w-full px-2 py-1 border border-border rounded-sm text-[11px] font-semibold bg-card text-text outline-none focus:border-primary"
                      />
                      {segmentYearsToPeak[curveKey] && segmentMonthsToPeak[curveKey] && (
                        <div className="text-[9px] text-text-muted mt-0.5">≈ {segmentYearsToPeak[curveKey]} yr{segmentYearsToPeak[curveKey] !== 1 ? 's' : ''}</div>
                      )}
                    </div>
                  </td>
                  {/* DC */}
                  <td className="px-3 py-2 border-r border-border-light">
                    <div>
                      <input
                        type="number" min="1" max="2" step="0.01"
                        value={segmentDiffusionConstant[curveKey] ?? ''}
                        onChange={(e) => updateSegmentDc(curveKey, e.target.value)}
                        placeholder="1.0–2.0"
                        className="w-full px-2 py-1 border border-border rounded-sm text-[11px] font-semibold bg-card text-text outline-none focus:border-primary"
                      />
                      {(() => { const v = parseFloat(segmentDiffusionConstant[curveKey]); const l = isNaN(v) ? '' : v === 1.5 ? 'Linear' : v < 1.5 ? 'Slow' : 'Fast'; return l ? <div className="text-[9px] text-primary font-semibold mt-0.5">{l}</div> : null; })()}
                    </div>
                  </td>
                  {/* Peak Value */}
                  <td className="px-3 py-2">
                    <div className="flex items-center border border-border rounded-sm bg-card focus-within:border-primary overflow-hidden">
                      <input
                        type="number" min="0" max="100"
                        value={segmentPeakValues[curveKey] ?? ''}
                        onChange={(e) => updateSegmentPeak(curveKey, e.target.value)}
                        placeholder="e.g. 80"
                        className="flex-1 min-w-0 px-2 py-1 text-[11px] font-semibold bg-transparent text-text outline-none border-none"
                      />
                      <span className="px-2 text-[11px] font-bold text-black bg-gray-100 border-l border-border select-none">%</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {error && <div className="text-[10px] text-red-500 font-semibold px-4 pb-2">⚠ {error}</div>}
      </div>

      {/* Horizontal table: years as columns, grouped like Primary -> Secondary when both are selected */}
      {hasData && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border-light">
                <th className="text-left px-4 py-2 font-bold text-text-muted w-[180px] border-r border-border-light">
                  {hasPrimaryAndSecondary ? 'Primary Attribute -> Secondary Attribute (%)' : 'Segment (%)'}
                </th>
                {years.map(year => (
                  <th key={year} className="text-center px-3 py-2 font-bold text-primary min-w-[60px]">{year}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hasPrimaryAndSecondary ? (
                primaryTags.map((primaryTag) => {
                  const secondaryRows = secondaryTags.filter((secondaryTag) => curveKeys.includes(`${primaryTag}|${secondaryTag}`));
                  return (
                    <Fragment key={`group-${primaryTag}`}>
                      <tr key={`group-${primaryTag}`} className="border-b border-border-light bg-primary/10">
                        <td className="px-4 py-2.5 font-bold border-r border-border-light border-l-[3px] text-[rgb(192,0,0)]" style={{ borderLeftColor: 'rgb(192,0,0)' }}>
                          {primaryTag}
                        </td>
                        {years.map((year) => (
                          <td key={`${primaryTag}-blank-${year}`} className="px-3 py-2 border-border-light"></td>
                        ))}
                      </tr>
                      {secondaryRows.map((secondaryTag, idx) => {
                        const curveKey = `${primaryTag}|${secondaryTag}`;
                        return (
                          <tr key={curveKey} className={`border-b border-border-light ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                            <td className="px-4 py-2 font-semibold text-text-muted border-r border-border-light pl-9">
                              {secondaryTag}
                            </td>
                            {(segmentRows[curveKey] || []).map(({ year, value }) => (
                              <td key={year} className="text-center px-3 py-2 text-text font-semibold">
                                <span>{Number(value).toFixed(2)}</span><span className="text-black font-bold ml-0.5">%</span>
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })
              ) : (
                curveKeys.map((curveKey, idx) => (
                  <tr key={curveKey} className={`border-b border-border-light ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                    <td
                      className="px-4 py-2 font-semibold text-text border-r border-border-light border-l-[3px]"
                      style={{ borderLeftColor: 'rgb(192,0,0)' }}
                    >
                      {labelForKey(curveKey)}
                    </td>
                    {(segmentRows[curveKey] || []).map(({ year, value }) => (
                      <td key={year} className="text-center px-3 py-2 text-text font-semibold">
                        <span>{Number(value).toFixed(2)}</span><span className="text-black font-bold ml-0.5">%</span>
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {!hasData && !error && (
        <div className="p-6 text-center text-[11px] text-text-muted">
          Enter peak value, months to peak, and diffusion constant for each segment above to generate the uptake curve.
        </div>
      )}
    </div>
  );
}

// ── Single Input Table ────────────────────────────────────────────────────────
// Renders a one-value-per-segment table (no time periods) for inputType='single-input'
function SingleInputTable({ metric, allSegments, metricConfig }) {
  const { metricData, setMetricData } = useApp();

  const selectedSegmentIds = metric.selectedSegments || [];
  const selectedSegs = allSegments.filter(s => selectedSegmentIds.includes(s.id));
  const primarySegs = selectedSegs.filter(s => s.type === 'Primary Attribute');
  const secondarySegs = selectedSegs.filter(s => s.type === 'Secondary Attribute');
  const primaryTags = primarySegs.flatMap(s => s.tags || []);
  const secondaryTags = secondarySegs.flatMap(s => s.tags || []);
  const hasPrimary = primaryTags.length > 0;
  const hasSecondary = secondaryTags.length > 0;
  const isPercentage = metricConfig.valueType === 'percentage';

  if (!hasPrimary && !hasSecondary) {
    return (
      <div className="bg-surface-low rounded-lg border border-border-light p-4 text-center">
        <p className="text-xs text-text-muted">No attributes selected for this metric. Configure in Model Setup.</p>
      </div>
    );
  }

  const getSingleValue = (primaryTag, secondaryTag) => {
    const key = `${metric.id}-${primaryTag}-${secondaryTag}-SINGLE`;
    return metricData[key] ?? '';
  };

  const handleSingleChange = (primaryTag, secondaryTag, value) => {
    const key = `${metric.id}-${primaryTag}-${secondaryTag}-SINGLE`;
    setMetricData(prev => ({ ...prev, [key]: value }));
  };

  const renderValueCell = (primaryTag, secondaryTag) => {
    const val = getSingleValue(primaryTag, secondaryTag);
    return (
      <td className="p-0 border-b border-r border-border-light h-9" style={{ minWidth: isPercentage ? '110px' : '120px' }}>
        <div className="flex items-center h-9 focus-within:bg-primary/5">
          <input
            type="text"
            value={isPercentage ? val : fmtNum(val)}
            onChange={(e) => handleSingleChange(primaryTag, secondaryTag, isPercentage ? e.target.value : stripCommas(e.target.value))}
            className="flex-1 min-w-0 h-9 px-2 text-center text-[11px] font-bold text-text border-none outline-none bg-transparent"
            placeholder="-"
          />
          {isPercentage && (
            <span className="pr-2 text-[10px] font-semibold text-black select-none">%</span>
          )}
        </div>
      </td>
    );
  };

  return (
    <div className="bg-card rounded-lg border border-border-light overflow-hidden mb-4">
      <div className="overflow-x-auto">
        <table className="text-[11px] border-collapse">
          <thead>
            <tr className="bg-surface-lowest border-b-2 border-border-light">
              <th className="sticky left-0 z-10 bg-surface-lowest text-left px-4 py-2.5 font-bold text-text-muted min-w-[160px] border-r border-border-light whitespace-nowrap">
                {hasPrimary && hasSecondary
                  ? `${primarySegs[0]?.name || 'Primary'} → ${secondarySegs[0]?.name || 'Secondary'}`
                  : hasPrimary ? primarySegs[0]?.name || 'Attribute'
                  : secondarySegs[0]?.name || 'Attribute'}
              </th>
              <th
                className="text-center px-2 py-2.5 font-bold text-primary whitespace-nowrap border-r border-border-light"
                style={{ minWidth: isPercentage ? '110px' : '120px' }}
              >
                Value{isPercentage ? ' (%)' : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {hasPrimary && hasSecondary ? (
              primaryTags.flatMap((primaryTag) => [
                <tr key={`grp-${primaryTag}`} style={{ backgroundColor: 'rgba(192,0,0,0.07)' }}>
                  <td
                    className="sticky left-0 z-10 px-4 py-2.5 font-bold text-[11px] border-b border-border-light border-r border-border-light border-l-[3px]"
                    style={{ color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)', backgroundColor: 'rgba(192,0,0,0.07)' }}
                  >
                    {primaryTag}
                  </td>
                  <td className="border-b border-r border-border-light" style={{ backgroundColor: 'rgba(192,0,0,0.04)' }} />
                </tr>,
                ...secondaryTags.map((secondaryTag, sIdx) => (
                  <tr key={`${primaryTag}-${secondaryTag}`} className={`hover:bg-primary/5 transition-colors ${sIdx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                    <td className={`sticky left-0 z-10 pl-8 pr-4 py-2 font-semibold text-[11px] text-text-muted border-b border-r border-border-light ${sIdx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                      {secondaryTag}
                    </td>
                    {renderValueCell(primaryTag, secondaryTag)}
                  </tr>
                ))
              ])
            ) : hasPrimary ? (
              primaryTags.map((primaryTag, idx) => (
                <tr key={primaryTag} className={`hover:bg-primary/5 transition-colors ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                  <td
                    className={`sticky left-0 z-10 px-4 py-2.5 font-bold text-[11px] border-b border-r border-border-light border-l-[3px] ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}
                    style={{ color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)' }}
                  >
                    {primaryTag}
                  </td>
                  {renderValueCell(primaryTag, '')}
                </tr>
              ))
            ) : (
              secondaryTags.map((secondaryTag, idx) => (
                <tr key={secondaryTag} className={`hover:bg-primary/5 transition-colors ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                  <td
                    className={`sticky left-0 z-10 px-4 py-2.5 font-bold text-[11px] border-b border-r border-border-light border-l-[3px] ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}
                    style={{ color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)' }}
                  >
                    {secondaryTag}
                  </td>
                  {renderValueCell('', secondaryTag)}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="p-3 border-t border-border-light bg-surface-low flex justify-end">
        <button
          onClick={() => { toast.success('Metric data saved!'); }}
          className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-sm text-[11px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground hover:opacity-90 transition-all"
        >
          <span className="mi text-xs">save</span> Save Data
        </button>
      </div>
    </div>
  );
}

function MetricDataTable({ metric, allSegments, timelinePeriods, granularity, metricConfig = {} }) {
  const { metricData, setMetricData } = useApp();

  // Get only the selected segment attributes for this metric
  const selectedSegmentIds = metric.selectedSegments || [];
  const selectedSegs = allSegments.filter(s => selectedSegmentIds.includes(s.id));
  
  const primarySegs = selectedSegs.filter(s => s.type === 'Primary Attribute');
  const secondarySegs = selectedSegs.filter(s => s.type === 'Secondary Attribute');

  const handleCellChange = (primaryTag, secondaryTag, period, value) => {
    const key = `${metric.id}-${primaryTag}-${secondaryTag}-${period.label}`;
    setMetricData(prev => ({ ...prev, [key]: value }));
  };

  const getCellValue = (primaryTag, secondaryTag, period) => {
    const key = `${metric.id}-${primaryTag}-${secondaryTag}-${period.label}`;
    return metricData[key] ?? '';
  };

  const getInputTitle = () => {
    if (metricConfig.valueType === 'percentage') {
      return 'Enter value between 0-100';
    }
    return 'Enter value';
  };

  // Get primary attribute tags
  const primaryTags = primarySegs.flatMap(s => s.tags || []);
  const secondaryTags = secondarySegs.flatMap(s => s.tags || []);

  // Check if at least one attribute is selected
  if (primaryTags.length === 0 && secondaryTags.length === 0) {
    return (
      <div className="bg-surface-low rounded-lg border border-border-light p-4 text-center">
        <p className="text-xs text-text-muted">No attributes selected for this metric. Configure in Model Setup.</p>
      </div>
    );
  }

  // Render table based on available attributes
  const hasPrimary = primaryTags.length > 0;
  const hasSecondary = secondaryTags.length > 0;

  // If single input type, show per-segment single-value table
  if (metricConfig.inputType === 'single-input') {
    return (
      <SingleInputTable
        metric={metric}
        allSegments={allSegments}
        metricConfig={metricConfig}
      />
    );
  }

  // If uptake curve input type, show params + computed table
  if (metricConfig.inputType === 'uptake-curve') {
    return (
      <UptakeCurveTable
        metric={metric}
        metricConfig={metricConfig}
        timelinePeriods={timelinePeriods}
        primaryTags={primaryTags}
        secondaryTags={secondaryTags}
      />
    );
  }

  const isPercentage = metricConfig.valueType === 'percentage';

  // Each period renders: value input cell + (if percentage) a separate % label cell
  const renderDataCells = (primaryTag, secondaryTag) =>
    timelinePeriods.flatMap((period, pIdx) => {
      const val = getCellValue(primaryTag, secondaryTag, period);
      const cells = [
        <td key={`v-${pIdx}`} className="p-0 border-b border-border-light h-9" style={{ minWidth: '56px' }}>
          <input
            type="text"
            value={fmtNum(val)}
            onChange={(e) => handleCellChange(primaryTag, secondaryTag, period, stripCommas(e.target.value))}
            className="w-full h-9 px-2 text-center text-[11px] font-bold text-text border-none outline-none bg-transparent focus:bg-primary/5 transition-colors"
            placeholder="-"
            title={getInputTitle()}
          />
        </td>,
      ];
      if (isPercentage) {
        cells.push(
          <td key={`pct-${pIdx}`} className="p-0 border-b border-r border-border-light h-9 pr-2" style={{ width: '22px' }}>
            <span className="flex items-center justify-start h-9 text-[10px] font-semibold text-text-muted select-none">%</span>
          </td>
        );
      } else {
        cells[0] = (
          <td key={`v-${pIdx}`} className="p-0 border-b border-r border-border-light h-9" style={{ minWidth: '72px' }}>
            <input
              type="text"
              value={fmtNum(val)}
              onChange={(e) => handleCellChange(primaryTag, secondaryTag, period, stripCommas(e.target.value))}
              className="w-full h-9 px-2 text-center text-[11px] font-bold text-text border-none outline-none bg-transparent focus:bg-primary/5 transition-colors"
              placeholder="-"
              title={getInputTitle()}
            />
          </td>
        );
      }
      return cells;
    });

  return (
    <div className="bg-card rounded-lg border border-border-light overflow-hidden mb-4">
      <div className="overflow-x-auto">
        <table className="text-[11px] border-collapse">
          <thead>
            <tr className="bg-surface-lowest border-b-2 border-border-light">
              <th className="sticky left-0 z-10 bg-surface-lowest text-left px-4 py-2.5 font-bold text-text-muted min-w-[160px] border-r border-border-light whitespace-nowrap">
                {hasPrimary && hasSecondary
                  ? `${primarySegs[0]?.name || 'Primary'} → ${secondarySegs[0]?.name || 'Secondary'}`
                  : hasPrimary ? primarySegs[0]?.name || 'Attribute'
                  : secondarySegs[0]?.name || 'Attribute'}
              </th>
              {timelinePeriods.map((period, idx) => (
                <th
                  key={idx}
                  colSpan={isPercentage ? 2 : 1}
                  className="text-center px-2 py-2.5 font-bold text-primary whitespace-nowrap border-r border-border-light"
                  style={{ minWidth: isPercentage ? '78px' : '72px' }}
                >
                  {period.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasPrimary && hasSecondary ? (
              primaryTags.flatMap((primaryTag) => [
                <tr key={`grp-${primaryTag}`} style={{ backgroundColor: 'rgba(192,0,0,0.07)' }}>
                  <td
                    className="sticky left-0 z-10 px-4 py-2.5 font-bold text-[11px] border-b border-border-light border-r border-border-light border-l-[3px]"
                    style={{ color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)', backgroundColor: 'rgba(192,0,0,0.07)' }}
                  >
                    {primaryTag}
                  </td>
                  {timelinePeriods.flatMap((_, i) =>
                    isPercentage
                      ? [<td key={`a${i}`} className="border-b border-border-light" style={{ backgroundColor: 'rgba(192,0,0,0.04)' }} />,
                         <td key={`b${i}`} className="border-b border-r border-border-light" style={{ backgroundColor: 'rgba(192,0,0,0.04)' }} />]
                      : [<td key={i} className="border-b border-r border-border-light" style={{ backgroundColor: 'rgba(192,0,0,0.04)' }} />]
                  )}
                </tr>,
                ...secondaryTags.map((secondaryTag, sIdx) => (
                  <tr key={`${primaryTag}-${secondaryTag}`} className={`hover:bg-primary/5 transition-colors ${sIdx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                    <td className={`sticky left-0 z-10 pl-8 pr-4 py-2 font-semibold text-[11px] text-text-muted border-b border-r border-border-light ${sIdx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                      {secondaryTag}
                    </td>
                    {renderDataCells(primaryTag, secondaryTag)}
                  </tr>
                ))
              ])
            ) : hasPrimary ? (
              primaryTags.map((primaryTag, idx) => (
                <tr key={primaryTag} className={`hover:bg-primary/5 transition-colors ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                  <td
                    className={`sticky left-0 z-10 px-4 py-2.5 font-bold text-[11px] border-b border-r border-border-light border-l-[3px] ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}
                    style={{ color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)' }}
                  >
                    {primaryTag}
                  </td>
                  {renderDataCells(primaryTag, '')}
                </tr>
              ))
            ) : (
              secondaryTags.map((secondaryTag, idx) => (
                <tr key={secondaryTag} className={`hover:bg-primary/5 transition-colors ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}>
                  <td
                    className={`sticky left-0 z-10 px-4 py-2.5 font-bold text-[11px] border-b border-r border-border-light border-l-[3px] ${idx % 2 === 0 ? 'bg-card' : 'bg-surface-lowest'}`}
                    style={{ color: 'rgb(192,0,0)', borderLeftColor: 'rgb(192,0,0)' }}
                  >
                    {secondaryTag}
                  </td>
                  {renderDataCells('', secondaryTag)}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="p-3 border-t border-border-light bg-surface-low flex justify-end">
        <button
          onClick={() => { toast.success('Metric data saved!'); }}
          className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-sm text-[11px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground hover:opacity-90 transition-all"
        >
          <span className="mi text-xs">save</span> Save Data
        </button>
      </div>
    </div>
  );
}

export default function Ace() {
  const { configuredMetrics, segments, timeline, metricsState, setCurrentPage, saveToBackend, loadFromBackend } = useApp();
  const metricConfigs = metricsState.metricConfigs || {};
  const [syncing, setSyncing] = useState(false);

  // Always generate both monthly and annual periods independently
  const monthlyPeriods = generateTimeline({ ...timeline, granularity: 'monthly' });
  const annualPeriods = generateTimeline({ ...timeline, granularity: 'annual' });

  // Group metrics by granularity
  const annualMetrics = configuredMetrics.filter(m => m.granularity === 'annual');
  const monthlyMetrics = configuredMetrics.filter(m => m.granularity === 'monthly');

  return (
    <>
      <style>{styles}</style>
      <div className="h-full overflow-y-auto p-[26px_28px] flex flex-col gap-[22px]">
        {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-primary mb-1">ACE</h1>
          <p className="text-[13px] text-text-muted max-w-[720px] leading-relaxed">
            Input ingestion for metrics defined on Model Setup page.
          </p>
        </div>
      </div>

      {/* Stats - Removed */}

      {/* Metrics Display */}
      <div>
        {configuredMetrics.length === 0 ? (
          <div className="bg-surface-low rounded-lg border border-border-light p-8 text-center">
            <span className="mi text-[32px] text-text-muted mb-3 block">data_exploration</span>
            <p className="text-sm font-semibold text-text-muted mb-1">No metrics configured yet</p>
            <p className="text-xs text-text-muted">Go to Model Setup to configure metrics and their granularity</p>
          </div>
        ) : (
          <>
            {/* Annual Metrics Section */}
            {configuredMetrics.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <span className="mi text-[20px]" style={{ color: 'rgb(192, 0, 0)' }}>calendar_month</span>
                  <h2 className="text-lg font-bold text-text">Inputs</h2>
                </div>
                <div className="space-y-6">
                  {configuredMetrics.map(metric => (
                    <div key={metric.id}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="mi text-[16px]" style={{ color: metric.rgbColor || 'rgb(192, 0, 0)' }}>{metric.icon || 'bar_chart'}</span>
                        <h3 className="text-[13px] font-bold text-text">{metric.name}</h3>
                        {metricConfigs[metric.id]?.inputType === 'uptake-curve' && (
                          <span className="text-[10px] font-bold text-purple-600 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded" title="Values are percentages (0–100). Divided by 100 when used in formulas.">%</span>
                        )}
                        {metricConfigs[metric.id]?.inputType === 'single-input' && (
                          <span className="text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">Single Input</span>
                        )}
                      </div>
                      <MetricDataTable
                        metric={{ ...metric, selectedSegments: metricConfigs[metric.id]?.selectedSegments || [] }}
                        allSegments={segments}
                        timelinePeriods={annualPeriods}
                        granularity="annual"
                        metricConfig={metricConfigs[metric.id] || {}}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Save & Proceed Button */}
      {configuredMetrics.length > 0 && (
        <div className="flex justify-end gap-2 pt-3 border-t border-border-light">
          {/* Proceed to calculations */}
          <button
            onClick={() => {
              toast.success('Metric data saved!');
              setCurrentPage('calculations');
            }}
            className="inline-flex items-center gap-1.5 py-[8px] px-[16px] rounded-sm text-[12px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground shadow-red hover:opacity-90 transition-all duration-150 border-none cursor-pointer"
          >
            <span className="mi text-[14px]">save</span> Save & Proceed
          </button>
        </div>
      )}
    </div>
    </>
  );
}
