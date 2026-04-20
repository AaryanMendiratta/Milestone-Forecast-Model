import { useMemo, useState, useCallback } from 'react';
import { useApp } from './App.jsx';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Area, Line, LabelList, Legend,
} from 'recharts';
import {
  computeLocalOutputs, generateAnnualPeriods, getAttributeCombinations,
  isPercentageOutput, computeAnnualTotals, formatSmartNumber,
} from './calculationUtils.js';
import { runMonteCarloRun, fetchMonteCarloResults } from './api.js';
import { supabase, supabaseReady } from './supabaseClient.js';

const OUTPUT_COLORS = [
  'rgb(192,0,0)', 'rgb(168,85,247)', 'rgb(14,165,233)', 'rgb(22,163,74)',
  'rgb(234,88,12)', 'rgb(107,114,128)',
];
const MC_PAGE_SIZE = 1000;
const MC_MAX_ROWS = 200000;

const keyToMetricId = {
  patientPopulation: 'population', // assuming same
  marketShare: 'market-share',
  treatmentRate: 'treatment-rate',
  pricePerPack: 'cost-per-patient',
};

const defaultDistParams = () => ({
  distType: 'normal',
  changeType: 'multiplicative',
  minChange: -20,
  maxChange: 20,
  sd: 10,
  confidenceLevel: 90,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomUniform(min, max) {
  return min + Math.random() * (max - min);
}

function randomNormal(mean = 0, sd = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Inverse normal CDF (probit) — Abramowitz & Stegun 26.2.17 approximation
function probit(p) {
  p = Math.max(1e-12, Math.min(1 - 1e-12, p));
  const t = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p));
  const c = [2.515517, 0.802853, 0.010328];
  const d = [1.432788, 0.189269, 0.001308];
  const x = t - (c[0] + c[1]*t + c[2]*t*t) / (1 + d[0]*t + d[1]*t*t + d[2]*t*t*t);
  return p >= 0.5 ? x : -x;
}

// Sample a % change from the distribution, then apply to a base value
function sampleValue(base, dist) {
  if (base === 0) return 0;
  const minChange = parseFloat(dist.minChange) || 0;
  const maxChange = parseFloat(dist.maxChange) || 0;
  let pct;
  if (dist.distType === 'uniform') {
    pct = randomUniform(minChange, maxChange);
  } else {
    // Derive σ from confidenceLevel so that CL% of draws span the full [min, max] range
    // σ = halfRange / Φ⁻¹((1 + CL/100) / 2)
    const confidence = dist.confidenceLevel || 90;
    const halfRange = Math.max(Math.abs(minChange), Math.abs(maxChange));
    const z = probit((1 + confidence / 100) / 2);
    const sd = z > 0.0001 ? halfRange / z : (dist.sd || 10);
    pct = randomNormal(0, sd);
  }
  if (dist.changeType === 'additive') return base + pct;
  return base * (1 + pct / 100); // multiplicative (default)
}

function summarizeSamples(values = []) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const getQuantile = (p) => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
    return sorted[index];
  };
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const variance = sorted.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / sorted.length;
  return {
    p05: getQuantile(0.05),
    p10: getQuantile(0.1),
    p25: getQuantile(0.25),
    p375: getQuantile(0.375),
    p45: getQuantile(0.45),
    p50: getQuantile(0.5),
    p55: getQuantile(0.55),
    p625: getQuantile(0.625),
    p75: getQuantile(0.75),
    p90: getQuantile(0.9),
    p95: getQuantile(0.95),
    mean,
    std: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function buildHistogramFromSamples(values = []) {
  if (values.length === 0) return [];
  // Use reduce instead of spread to avoid stack overflow with large arrays (10k+ samples)
  const min = values.reduce((a, b) => a < b ? a : b);
  const max = values.reduce((a, b) => a > b ? a : b);
  if (min === max) {
    return [{ value: min, label: fmtK(min), prob: 1 }];
  }

  // Use ~50 bins to match the granular bell-curve look from the VBA reference.
  // With 5000 samples this gives ~100 samples/bin on average — enough for stable counts.
  const bins = 50;
  const width = (max - min) / bins;
  const buckets = Array.from({ length: bins }, () => 0);
  values.forEach(val => {
    let index = Math.floor((val - min) / width);
    if (index < 0) index = 0;
    if (index >= bins) index = bins - 1;
    buckets[index] += 1;
  });

  // 5-point weighted moving average (weights 1-2-3-2-1) to smooth sampling noise
  // while preserving the bell-curve shape.
  const weights = [1, 2, 3, 2, 1];
  const wSum = weights.reduce((a, b) => a + b, 0);
  const smoothed = buckets.map((_, i) => {
    let total = 0;
    weights.forEach((w, wi) => {
      const idx = i + wi - 2;
      total += w * (buckets[idx] ?? buckets[Math.max(0, Math.min(bins - 1, idx))]);
    });
    return total / wSum;
  });

  return smoothed.map((count, i) => {
    const lo = min + i * width;
    const hi = lo + width;
    return {
      value: (lo + hi) / 2,
      label: fmtK((lo + hi) / 2),
      prob: count / values.length,
    };
  });
}

async function fetchRowsFromSupabase(runId, onProgress) {
  let rows = [];
  let pageCount = 0;
  let lastIteration = 0;
  while (rows.length < MC_MAX_ROWS) {
    const { data, error } = await supabase
      .from('monte_carlo_iterations')
      .select('iteration, total_output, outputs')
      .eq('run_id', runId)
      .gt('iteration', lastIteration)
      .order('iteration', { ascending: true })
      .limit(MC_PAGE_SIZE);
    if (error) throw new Error(error.message);
    const batch = data || [];
    if (batch.length === 0) {
      onProgress?.({ rowsLoaded: rows.length, pageCount, done: true });
      break;
    }
    rows = rows.concat(batch);
    pageCount += 1;
    const nextIteration = Number(batch[batch.length - 1]?.iteration);
    if (!Number.isFinite(nextIteration) || nextIteration <= lastIteration) {
      throw new Error('Failed to paginate Monte Carlo results by iteration.');
    }
    lastIteration = nextIteration;
    onProgress?.({ rowsLoaded: rows.length, pageCount, done: batch.length < MC_PAGE_SIZE });
    if (batch.length < MC_PAGE_SIZE) break;
  }
  if (rows.length >= MC_MAX_ROWS) {
    throw new Error('Result set too large to fetch in the browser.');
  }
  return rows;
}

async function fetchRowsFromBackend(runId, onProgress) {
  onProgress?.({ rowsLoaded: 0, pageCount: 0, done: false });
  const result = await fetchMonteCarloResults(runId);
  const rows = result.rows || [];
  onProgress?.({ rowsLoaded: rows.length, pageCount: 1, done: true });
  return rows;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function generateCCDF(hist) {
  let cum = hist.reduce((s, d) => s + d.prob, 0);
  return hist.map(d => {
    const pAchieve = Math.max(0, +(Math.min(1, cum)).toFixed(3));
    cum -= d.prob;
    return { ...d, pAchieve };
  });
}

function fmtK(v) {
  const n = Number(v);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

// ─── Per-metric data sampler ─────────────────────────────────────────────────
function sampleMetricData(metricData, metricsInFormula, metricDists) {
  const sampled = { ...metricData };
  for (const metric of metricsInFormula) {
    const dist = metricDists[metric.id] || defaultDistParams();
    const prefix = `${metric.id}-`;
    for (const key of Object.keys(metricData)) {
      if (!key.startsWith(prefix)) continue;
      if (key.endsWith('--is-uptake-curve')) continue;
      const val = parseFloat(metricData[key]);
      if (isNaN(val) || val === 0) continue;
      sampled[key] = sampleValue(val, dist);
    }
  }
  return sampled;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function MonteCarlo() {
  const {
    monteCarloOutputName, setMonteCarloOutputName,
    metricsState, metricData, segments, configuredMetrics, timeline,
  } = useApp();

  const [isRunning, setIsRunning]       = useState(false);
  const [simulationsCount, setSimCount] = useState(10000);
  const [metricDists, setMetricDists]   = useState(() => {
    try {
      const saved = localStorage.getItem('monteCarlo_metricDists');
      return saved ? JSON.parse(saved) : {};
    } catch { localStorage.removeItem('monteCarlo_metricDists'); return {}; }
  });
  // enabled: true = include in simulation, false = use base values only
  const [metricEnabled, setMetricEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('monteCarlo_metricEnabled');
      return saved ? JSON.parse(saved) : {};
    } catch { localStorage.removeItem('monteCarlo_metricEnabled'); return {}; }
  });
  const [simulationResults, setSimulationResults] = useState(() => {
    try {
      const saved = localStorage.getItem('monteCarlo_simulationResults');
      return saved ? JSON.parse(saved) : { samples: [], revenueSamples: [], summary: null, runAt: null };
    } catch {
      localStorage.removeItem('monteCarlo_simulationResults');
      return { samples: [], revenueSamples: [], summary: null, runAt: null };
    }
  });
  const [hasRun, setHasRun] = useState(() => (simulationResults.revenueSamples || []).length > 0);
  const [runProgress, setRunProgress] = useState({ value: 0, stage: '' });

  const getMetricDist  = (metricId) => metricDists[metricId] || defaultDistParams();
  const updateMetricDist = (metricId, field, value) =>
    setMetricDists(prev => {
      const next = { ...prev, [metricId]: { ...(prev[metricId] || defaultDistParams()), [field]: value } };
      localStorage.setItem('monteCarlo_metricDists', JSON.stringify(next));
      return next;
    });
  const isMetricEnabled = (metricId) => metricEnabled[metricId] !== false; // default true
  const setMetricEnabledFlag = (metricId, val) =>
    setMetricEnabled(prev => {
      const next = { ...prev, [metricId]: val };
      localStorage.setItem('monteCarlo_metricEnabled', JSON.stringify(next));
      return next;
    });

  // ── Compute outputs from context state ──────────────────────────────────
  const formulaRows   = metricsState.formulaRows   || [];
  const metricConfigs = metricsState.metricConfigs || {};
  const annualPeriods = useMemo(() => generateAnnualPeriods(timeline), [timeline]);

  const effectiveConfiguredMetrics = useMemo(() => {
    const source = (metricsState.metrics && metricsState.metrics.length > 0)
      ? metricsState.metrics
      : configuredMetrics;
    return (source || []).map(m => ({
      id: m.id,
      name: m.name || m.id,
      icon: m.icon,
      color: m.color,
      rgbColor: m.rgbColor,
      granularity: metricConfigs[m.id]?.granularity || m.granularity || 'monthly',
      selectedSegments: metricConfigs[m.id]?.selectedSegments || m.selectedSegments || [],
    }));
  }, [metricsState.metrics, configuredMetrics, metricConfigs]);

  const enrichedOutputs = useMemo(() => {
    const raw = computeLocalOutputs(formulaRows, metricData, segments, effectiveConfiguredMetrics, metricConfigs, annualPeriods);
    return raw.map((output, idx) => {
      const isPerc       = isPercentageOutput(output.formulaRow, metricConfigs, formulaRows);
      const annualTotals = computeAnnualTotals(output.outputData, annualPeriods, isPerc);
      return { ...output, isPercentage: isPerc, annualTotals, color: OUTPUT_COLORS[idx % OUTPUT_COLORS.length] };
    });
  }, [formulaRows, metricData, segments, effectiveConfiguredMetrics, metricConfigs, annualPeriods]);

  // ── Selected output ──────────────────────────────────────────────────────
  const selectedOutput = useMemo(() => {
    if (enrichedOutputs.length === 0) return null;
    return enrichedOutputs.find(o => o.outputName === monteCarloOutputName) ?? enrichedOutputs[0];
  }, [enrichedOutputs, monteCarloOutputName]);

  // ── All configured metrics from model setup (not just formula metrics) ───
  const allModelMetrics = useMemo(() => {
    if (effectiveConfiguredMetrics.length > 0) return effectiveConfiguredMetrics;
    // Fallback: extract from formula rows if configuredMetrics is empty
    if (!selectedOutput) return [];
    const items = selectedOutput.formulaRow?.items || [];
    const seen = new Set();
    return items
      .filter(item => item.metricId && !item.metricId.startsWith('output-'))
      .reduce((acc, item) => {
        if (seen.has(item.metricId)) return acc;
        seen.add(item.metricId);
        acc.push({ id: item.metricId, name: item.metricId, icon: 'analytics', rgbColor: 'rgb(107,114,128)' });
        return acc;
      }, []);
  }, [effectiveConfiguredMetrics, selectedOutput]);

  // Base forecast: per-year values from the selected output's annualTotals
  const baseForecastYears = useMemo(() => {
    if (!selectedOutput) return [];
    return Object.entries(selectedOutput.annualTotals).map(([year, base]) => ({ year, base }));
  }, [selectedOutput]);

  const baseTotal = useMemo(
    () => baseForecastYears.reduce((sum, { base }) => sum + base, 0),
    [baseForecastYears]
  );


  // ── Local (browser) Monte Carlo — fallback when Supabase/backend is unavailable ──
  const runLocalSimulation = useCallback((simCount, effectiveMetricDists) => {
    const perYearBuckets = {};
    const metricsInFormula = allModelMetrics;
    for (let i = 0; i < simCount; i++) {
      const sampledData = sampleMetricData(metricData, metricsInFormula, effectiveMetricDists);
      const outputs = computeLocalOutputs(formulaRows, sampledData, segments, effectiveConfiguredMetrics, metricConfigs, annualPeriods);
      const targetOutput = outputs.find(o => o.outputName === selectedOutput?.outputName) || outputs[0];
      if (!targetOutput) continue;
      for (const [key, val] of Object.entries(targetOutput.outputData || {})) {
        if (val === '' || val === null || val === undefined) continue;
        const year = key.split('-').pop();
        if (!year || isNaN(Number(year))) continue;
        if (!perYearBuckets[year]) perYearBuckets[year] = [];
        perYearBuckets[year].push(Number(val));
      }
    }
    const perYearPercentiles = {};
    for (const [year, values] of Object.entries(perYearBuckets)) {
      perYearPercentiles[year] = summarizeSamples(values);
    }
    const sortedYears = Object.keys(perYearBuckets).sort();
    const lastYear = sortedYears[sortedYears.length - 1];
    const revenueSamples = lastYear ? perYearBuckets[lastYear] : [];
    const summary = summarizeSamples(revenueSamples);
    return { samples: [], revenueSamples, summary, perYearPercentiles, runAt: Date.now() };
  }, [metricData, allModelMetrics, formulaRows, segments, effectiveConfiguredMetrics, metricConfigs, annualPeriods, selectedOutput]);

  // ── Simulation ───────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!selectedOutput || baseForecastYears.length === 0) {
      toast.error('No forecast data — configure metrics and run calculations first.');
      return;
    }

    setIsRunning(true);
    setRunProgress({ value: 4, stage: 'Preparing simulation inputs...' });
    toast(`Running ${simulationsCount.toLocaleString()} simulations…`);

    // Build effective distributions — include ALL configured metrics with their stored params (or defaults).
    // This ensures metrics are properly sampled even after reset (when metricDists state is empty).
    const variedMetrics = allModelMetrics
      .filter(metric => metric && metric.id && isMetricEnabled(metric.id));
    const effectiveMetricDists = Object.fromEntries(
      variedMetrics.map(metric => [metric.id, metricDists[metric.id] || defaultDistParams()])
    );
    // Include=No should keep base input values in formula evaluation, just without sampling.
    const metricsForCalculation = allModelMetrics.filter(metric => metric && metric.id);
    const allowedMetricDataKeys = new Set();
    metricsForCalculation.forEach((metric) => {
      const metricId = metric.id;
      allowedMetricDataKeys.add(`${metricId}--is-uptake-curve`);
      const inputType = metricConfigs[metricId]?.inputType || 'table';
      const combos = getAttributeCombinations(metricId, effectiveConfiguredMetrics, segments, metricConfigs);

      if (inputType === 'single-input') {
        combos.forEach((combo) => {
          const [primaryTag = '', secondaryTag = ''] = combo.split('|');
          if (primaryTag && secondaryTag) {
            allowedMetricDataKeys.add(`${metricId}-${primaryTag}-${secondaryTag}-SINGLE`);
          } else if (primaryTag) {
            allowedMetricDataKeys.add(`${metricId}-${primaryTag}--SINGLE`);
          } else if (secondaryTag) {
            allowedMetricDataKeys.add(`${metricId}--${secondaryTag}-SINGLE`);
          } else {
            allowedMetricDataKeys.add(`${metricId}---SINGLE`);
          }
        });
        return;
      }

      annualPeriods.forEach((period) => {
        const periodLabel = period.label;
        combos.forEach((combo) => {
          const [primaryTag = '', secondaryTag = ''] = combo.split('|');
          if (primaryTag && secondaryTag) {
            allowedMetricDataKeys.add(`${metricId}-${primaryTag}-${secondaryTag}-${periodLabel}`);
          } else if (primaryTag) {
            allowedMetricDataKeys.add(`${metricId}-${primaryTag}--${periodLabel}`);
          } else if (secondaryTag) {
            allowedMetricDataKeys.add(`${metricId}--${secondaryTag}-${periodLabel}`);
          } else {
            allowedMetricDataKeys.add(`${metricId}---${periodLabel}`);
          }
        });
      });
    });
    const sanitizedMetricData = Object.fromEntries(
      Object.entries(metricData).filter(([key]) => allowedMetricDataKeys.has(key))
    );

    let trickleTimer;
    const clearTrickle = () => {
      if (trickleTimer) {
        clearInterval(trickleTimer);
        trickleTimer = null;
      }
    };
    const updateProgress = (value, stage) => {
      setRunProgress(prev => ({
        value: Math.max(prev.value, Math.min(100, value)),
        stage: stage ?? prev.stage,
      }));
    };
    const handleFetchProgress = ({ rowsLoaded }) => {
      const ratio = simulationsCount > 0 ? rowsLoaded / simulationsCount : 0;
      const value = 82 + Math.min(12, Math.max(0, ratio * 12));
      updateProgress(value, 'Fetching simulation results...');
    };

    try {
      updateProgress(10, 'Submitting Monte Carlo job...');
      trickleTimer = setInterval(() => {
        setRunProgress(prev => {
          const cap = 78;
          if (prev.value >= cap) return prev;
          const step = prev.value < 35 ? 3 : (prev.value < 60 ? 2 : 1);
          return {
            value: Math.min(cap, prev.value + step),
            stage: 'Running simulations...',
          };
        });
      }, 700);

      // 1. Tell the backend to clear the DB and run all iterations
      const { run_id } = await runMonteCarloRun({
        simulations: simulationsCount,
        metricData: sanitizedMetricData,
        formulaRows,
        segments,
        timeline,
        metricConfigs,
        configuredMetrics: effectiveConfiguredMetrics,
        metricDists: effectiveMetricDists,
        outputName: selectedOutput.outputName,
      });
      clearTrickle();
      updateProgress(82, 'Fetching simulation results...');

      // 2. Fetch all iteration rows (Supabase directly if configured, otherwise via backend)
      let rows = [];
      try {
        if (supabaseReady && supabase) {
          rows = await fetchRowsFromSupabase(run_id, handleFetchProgress);
        } else {
          rows = await fetchRowsFromBackend(run_id, handleFetchProgress);
        }
      } catch (primaryErr) {
        if (supabaseReady && supabase) {
          rows = await fetchRowsFromBackend(run_id, handleFetchProgress);
        } else {
          throw primaryErr;
        }
      }
      updateProgress(95, 'Computing percentile ranges...');

      // 3. Build per-year buckets — for each iteration, sum all segment values for each year
      const perYearBuckets = {};
      for (const row of rows) {
        const yearTotals = {};
        for (const [key, val] of Object.entries(row.outputs || {})) {
          if (val === '' || val === null || val === undefined) continue;
          const year = key.split('-').pop();
          yearTotals[year] = (yearTotals[year] || 0) + Number(val);
        }
        for (const [year, total] of Object.entries(yearTotals)) {
          if (!perYearBuckets[year]) perYearBuckets[year] = [];
          perYearBuckets[year].push(total);
        }
      }

      // If DB returned no rows, fall back to local simulation
      if (Object.keys(perYearBuckets).length === 0) {
        updateProgress(96, 'No DB rows found; running local simulation...');
        const results = runLocalSimulation(simulationsCount, effectiveMetricDists);
        setSimulationResults(results);
        localStorage.setItem('monteCarlo_simulationResults', JSON.stringify(results));
        setHasRun(true);
        setRunProgress({ value: 100, stage: 'Simulation complete' });
        toast.success('Simulation complete — results updated (local)');
        return;
      }

      const perYearPercentiles = {};
      for (const [year, values] of Object.entries(perYearBuckets)) {
        perYearPercentiles[year] = summarizeSamples(values);
      }

      // 4. revenueSamples = last forecast year's per-iteration totals
      const sortedYears   = Object.keys(perYearBuckets).sort();
      const lastYear      = sortedYears[sortedYears.length - 1];
      const revenueSamples = lastYear ? perYearBuckets[lastYear] : [];

      const summary = summarizeSamples(revenueSamples);
      const results = { samples: [], revenueSamples, summary, perYearPercentiles, runAt: Date.now() };

      setSimulationResults(results);
      localStorage.setItem('monteCarlo_simulationResults', JSON.stringify(results));
      setHasRun(true);
      setRunProgress({ value: 100, stage: 'Simulation complete' });
      toast.success('Simulation complete — results updated');
    } catch (err) {
      clearTrickle();
      if ((err?.message || '').includes('(409)')) {
        setRunProgress({ value: 0, stage: '' });
        toast.error('Running on other system pease wait');
        return;
      }
      // DB-backed flow failed — fall back to local simulation
      toast(`Database unavailable, running local simulation…`);
      try {
        updateProgress(90, 'Database unavailable; running local simulation...');
        const results = runLocalSimulation(simulationsCount, effectiveMetricDists);
        setSimulationResults(results);
        localStorage.setItem('monteCarlo_simulationResults', JSON.stringify(results));
        setHasRun(true);
        setRunProgress({ value: 100, stage: 'Simulation complete' });
        toast.success('Simulation complete — results updated (local)');
      } catch (localErr) {
        setRunProgress({ value: 0, stage: '' });
        toast.error(`Simulation failed: ${localErr.message}`);
        setHasRun(true); // still mark as run so user sees the (empty) results panel
      }
    } finally {
      clearTrickle();
      setIsRunning(false);
    }
  };

  const handleReset = () => {
    setHasRun(false);
    setSimCount(10000);
    setMetricDists({});
    setMetricEnabled({});
    const emptyResults = { samples: [], revenueSamples: [], summary: null, runAt: null };
    setSimulationResults(emptyResults);
    setRunProgress({ value: 0, stage: '' });
    localStorage.removeItem('monteCarlo_simulationResults');
    localStorage.removeItem('monteCarlo_metricDists');
    localStorage.removeItem('monteCarlo_metricEnabled');
    toast('Simulation reset');
  };

  const histData = useMemo(() => buildHistogramFromSamples(simulationResults.revenueSamples || []), [simulationResults.revenueSamples]);
  const ccdfData = useMemo(() => generateCCDF(histData), [histData]);
  const runStats = simulationResults.summary;

  // ── Cone chart data: per-year percentile bands ────────────────────────
  const coneData = useMemo(() => {
    const ppy = simulationResults.perYearPercentiles;
    if (!ppy || baseForecastYears.length === 0) return [];
    return baseForecastYears.map(({ year, base }) => {
      const ps = ppy[year];
      if (!ps) {
        return {
          year,
          base,
          _p05: base,
          band_90_low: 0,
          band_50_low: 0,
          band_25_low: 0,
          band_10: 0,
          band_25_high: 0,
          band_50_high: 0,
          band_90_high: 0,
        };
      }

      // Backward-compatible fallbacks for results stored before these quantiles existed
      const q05 = Number.isFinite(ps.p05) ? ps.p05 : (Number.isFinite(ps.min) ? ps.min : base);
      const q25 = Number.isFinite(ps.p25) ? ps.p25 : q05;
      const q375 = Number.isFinite(ps.p375) ? ps.p375 : q25;
      const q45 = Number.isFinite(ps.p45) ? ps.p45 : (Number.isFinite(ps.p50) ? ps.p50 : q375);
      const q55 = Number.isFinite(ps.p55) ? ps.p55 : (Number.isFinite(ps.p50) ? ps.p50 : q45);
      const q625 = Number.isFinite(ps.p625) ? ps.p625 : (Number.isFinite(ps.p75) ? ps.p75 : q55);
      const q75 = Number.isFinite(ps.p75) ? ps.p75 : q625;
      const q95 = Number.isFinite(ps.p95) ? ps.p95 : (Number.isFinite(ps.max) ? ps.max : q75);

      return {
        year,
        base,
        _p05: Math.max(0, q05),
        band_90_low: Math.max(0, q25 - q05),
        band_50_low: Math.max(0, q375 - q25),
        band_25_low: Math.max(0, q45 - q375),
        band_10: Math.max(0, q55 - q45),
        band_25_high: Math.max(0, q625 - q55),
        band_50_high: Math.max(0, q75 - q625),
        band_90_high: Math.max(0, q95 - q75),
      };
    });
  }, [simulationResults.perYearPercentiles, baseForecastYears]);

  const outputLabel = selectedOutput?.outputName ?? 'Output';
  const isPerc      = selectedOutput?.isPercentage ?? false;
  const fmt         = (v) => isPerc ? `${Number(v).toFixed(0)}%` : fmtK(v);

  return (
    <div className="h-full overflow-y-auto p-[26px_28px] flex flex-col gap-[22px]">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-primary mb-1">Monte Carlo Simulation</h1>
          <p className="text-[13px] text-text-muted max-w-[520px] leading-relaxed">
            Define forecast variance and run probabilistic simulations to quantify uncertainty in the selected output.
          </p>
        </div>
        <div className="flex items-end gap-[10px]">
          {enrichedOutputs.length > 0 && (
            <div className="flex flex-col items-end gap-[3px]">
              <label className="text-[9px] font-bold text-text-muted uppercase tracking-[0.8px]">Output Metric</label>
              <select
                value={monteCarloOutputName}
                onChange={e => setMonteCarloOutputName(e.target.value)}
                className="h-[34px] py-[7px] px-[10px] rounded-sm text-[12px] font-bold border-[1.5px] border-border bg-card text-text focus:outline-none focus:border-primary transition-colors cursor-pointer"
              >
                {enrichedOutputs.map(o => (
                  <option key={o.outputName} value={o.outputName}>{o.outputName}{o.isPercentage ? ' (%)' : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col items-end gap-[3px]">
            <label className="text-[9px] font-bold text-text-muted uppercase tracking-[0.8px]">Simulations</label>
            <input
              type="number" min={100} max={100000} step={1000}
              value={simulationsCount}
              onChange={e => setSimCount(Math.max(100, Math.min(100000, +e.target.value || 1000)))}
              className="h-[34px] w-[110px] py-[7px] px-[10px] rounded-sm text-[13px] font-bold border-[1.5px] border-border bg-card text-text text-right focus:outline-none focus:border-primary transition-colors"
            />
          </div>
          <div className="flex flex-col gap-[3px]">
            <span className="text-[9px] invisible">x</span>
            <button onClick={handleReset}
              className="inline-flex items-center gap-1.5 py-[7px] px-[18px] rounded-sm text-[13px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150">
              <span className="mi text-sm">refresh</span> Reset
            </button>
          </div>
          <div className="flex flex-col gap-[3px]">
            <span className="text-[9px] invisible">x</span>
            <button onClick={handleRun} disabled={isRunning}
              className="inline-flex items-center gap-1.5 py-[7px] px-[18px] rounded-sm text-[13px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground shadow-red hover:opacity-90 hover:-translate-y-px transition-all duration-150 border-none cursor-pointer disabled:opacity-60">
              <span className="mi text-sm">play_arrow</span> {isRunning ? 'Running…' : 'Run Simulation'}
            </button>
          </div>
        </div>
      </div>

      {/* No outputs warning */}
      {enrichedOutputs.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-5 py-4 text-[13px] text-amber-800 font-medium flex items-center gap-2">
          <span className="mi text-[18px]">warning</span>
          No outputs found. Configure your metrics and formula in Model Setup first, then return here.
        </div>
      )}

      {isRunning && (
        <div className="bg-surface-low rounded-lg border border-border-light p-4">
          <div className="flex items-center justify-between text-[11px] font-semibold text-text-muted mb-2">
            <span>{runProgress.stage || 'Running Monte Carlo simulation...'}</span>
            <span>{Math.round(runProgress.value)}%</span>
          </div>
          <div className="h-2 w-full bg-surface-highest rounded-full overflow-hidden border border-border-light">
            <div
              className="h-full bg-gradient-to-r from-primary to-primary-dark transition-all duration-300 ease-out"
              style={{ width: `${Math.max(2, Math.min(100, runProgress.value))}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Simulation Results (shown FIRST when simulation has run) ─────────── */}
      {hasRun && (
        <div className="flex flex-col gap-[18px]">

          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Simulations Run', value: simulationsCount.toLocaleString(), sub: 'Configured sample size', subCls: 'text-[#16a34a]' },
              { label: `Median ${outputLabel} (Latest Year)`, value: runStats ? fmt(runStats.p50) : '—', sub: 'Expected result per year (P50)', subCls: 'text-text-muted' },
              { label: 'P90–P10 Range (Latest Year)', value: runStats ? `±${fmt((runStats.p90 - runStats.p10) / 2)}` : '—', sub: 'Forecast uncertainty spread', subCls: 'text-primary' },
            ].map(c => (
              <div key={c.label} className="bg-card rounded-lg p-4 px-5 border border-border-light shadow-sm">
                <div className="text-[10px] text-text-muted font-semibold uppercase tracking-[0.8px]">{c.label}</div>
                <div className="text-[24px] font-extrabold text-text leading-none my-1.5">{c.value}</div>
                <span className={`text-xs font-bold ${c.subCls}`}>{c.sub}</span>
              </div>
            ))}
          </div>

          {/* Bayesian Cone */}
          <div className="bg-surface-low rounded-lg border border-border-light p-5">
            <div className="text-sm font-bold text-text mb-1">{outputLabel} | Range of Forecast</div>
            <div className="text-[11px] text-text-muted mb-4">Bayesian Cone — probabilistic forecast bands over time</div>
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={coneData} margin={{ top: 24, right: 24, bottom: 8, left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="year" tick={{ fontSize: 10, fontWeight: 600 }} />
                  <YAxis tickFormatter={v => fmtK(v)} tick={{ fontSize: 9 }} width={52} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload) return null;
                      const d = coneData.find(r => r.year === label);
                      if (!d) return null;
                      const ppy = simulationResults.perYearPercentiles?.[label];
                      return (
                        <div className="bg-card border border-border-light rounded-md p-3 shadow-sm text-[11px] min-w-[160px]">
                          <div className="font-bold text-text mb-2">{label}</div>
                          {ppy && [
                            ['MAX', ppy.max], ['P90', ppy.p90], ['P75', ppy.p75],
                            ['P50 (Median)', ppy.p50],
                            ['P25', ppy.p25], ['P10', ppy.p10], ['MIN', ppy.min],
                          ].map(([lbl, val]) => (
                            <div key={lbl} className="flex justify-between gap-4">
                              <span className="text-text-muted">{lbl}</span>
                              <span className="font-semibold text-text">{fmt(val)}</span>
                            </div>
                          ))}
                          <div className="border-t border-border-light mt-1.5 pt-1.5 flex justify-between">
                            <span className="text-text-muted">Base</span>
                            <span className="font-bold text-primary">{fmt(d.base)}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend verticalAlign="bottom" height={32} formatter={(value) => <span style={{ fontSize: 10, color: '#64748b' }}>{value}</span>} />
                  {/* Stacked nested bands: 90% (P05–P95), 50% (P25–P75), 25% (P37.5–P62.5), 10% (P45–P55) */}
                  <Area type="monotone" dataKey="_p05"         stackId="cone" fill="transparent" stroke="none" legendType="none" isAnimationActive={false} />
                  <Area type="monotone" dataKey="band_90_low"  stackId="cone" name="90%"   fill="rgba(147,197,253,0.55)" stroke="none" isAnimationActive={false} />
                  <Area type="monotone" dataKey="band_50_low"  stackId="cone" name="50%"   fill="rgba(181,175,194,0.70)" stroke="none" isAnimationActive={false} />
                  <Area type="monotone" dataKey="band_25_low"  stackId="cone" name="25%"   fill="rgba(242,221,195,0.85)" stroke="none" isAnimationActive={false} />
                  <Area type="monotone" dataKey="band_10"      stackId="cone" name="10%"   fill="rgba(166,208,198,0.95)" stroke="none" isAnimationActive={false} />
                  <Area type="monotone" dataKey="band_25_high" stackId="cone" fill="rgba(242,221,195,0.85)" stroke="none" legendType="none" isAnimationActive={false} />
                  <Area type="monotone" dataKey="band_50_high" stackId="cone" fill="rgba(181,175,194,0.70)" stroke="none" legendType="none" isAnimationActive={false} />
                  <Area type="monotone" dataKey="band_90_high" stackId="cone" fill="rgba(147,197,253,0.55)" stroke="none" legendType="none" isAnimationActive={false} />
                  <Line type="monotone" dataKey="base" name="Base Forecast" stroke="#1a1a1a" strokeDasharray="7 4" strokeWidth={2.5}
                    dot={{ fill: '#fff', stroke: '#1a1a1a', strokeWidth: 2, r: 4 }} isAnimationActive={false}>
                    <LabelList dataKey="base" position="top" formatter={v => fmtK(v)} style={{ fill: 'rgb(192,0,0)', fontSize: 10, fontWeight: 'bold' }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Distribution + Cumulative CDF side by side */}
          <div className="grid grid-cols-2 gap-[14px]">
            <div className="bg-surface-low rounded-lg border border-border-light p-5">
              <div className="text-sm font-bold text-text mb-4">Probability of {outputLabel} Achieving Targets</div>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ccdfData} margin={{ top: 4, right: 6, bottom: 36, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="label" tick={{ fontSize: 7 }} angle={-45} textAnchor="end" interval={4} />
                    <YAxis domain={[0, 1]} tick={{ fontSize: 9 }} tickFormatter={v => v.toFixed(1)} width={42} label={{ value: 'Probability', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <Tooltip formatter={value => typeof value === 'number' ? value.toFixed(3) : value} />
                    <Bar dataKey="pAchieve" fill="rgb(192,0,0)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-surface-low rounded-lg border border-border-light p-5">
              <div className="text-sm font-bold text-text mb-4">Probability Distribution of {outputLabel}</div>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histData} margin={{ top: 4, right: 6, bottom: 36, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="label" tick={{ fontSize: 7 }} angle={-45} textAnchor="end" interval={4} />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={v => v.toFixed(3)} width={42} label={{ value: 'Probability', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 9, fill: '#94a3b8' } }} />
                    <Tooltip formatter={value => typeof value === 'number' ? value.toFixed(4) : value} />
                    <Bar dataKey="prob" fill="rgb(192,0,0)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Per-year simulation percentile table */}
          <div className="bg-surface-low rounded-lg border border-border-light p-5">
            <div className="text-sm font-bold text-text mb-1">Simulation Summary — {outputLabel} (Per Year)</div>
            <div className="text-[11px] text-text-muted mb-4">
              Each row shows the range of simulated outcomes for that year across all {simulationsCount.toLocaleString()} iterations.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-3 text-[10px] font-bold uppercase tracking-[0.8px] text-text-muted border-b-2 border-border-light">Year</th>
                    {['Min', 'P10', 'P25', 'Median', 'P75', 'P90', 'Max'].map(h => (
                      <th key={h} className="text-right py-2 px-3 text-[10px] font-bold uppercase tracking-[0.8px] text-text-muted border-b-2 border-border-light">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {baseForecastYears.map(({ year }) => {
                    const ps = simulationResults.perYearPercentiles?.[year];
                    if (!ps) return null;
                    return (
                      <tr key={year} className="hover:bg-surface-highest/50 transition-colors">
                        <td className="py-2 px-3 border-b border-border-light font-bold text-text">{year}</td>
                        {[ps.min, ps.p10, ps.p25, ps.p50, ps.p75, ps.p90, ps.max].map((v, i) => (
                          <td key={i} className="py-2 px-3 border-b border-border-light text-right text-text-muted">{v !== undefined ? fmt(v) : '—'}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Forecast Variance Config (below charts when simulation has run) ─── */}
      <div className="bg-surface-low rounded-lg border border-border-light p-5 flex flex-col gap-3">
        <div className="text-sm font-bold text-text flex items-center gap-2">
          <span className="mi text-[18px] text-primary">tune</span> Input Variance — Model Setup Metrics
          <span className="ml-1 text-[10px] font-normal text-text-muted">(enable/disable each metric's sampling independently)</span>
        </div>

        {/* Column headers */}
        {allModelMetrics.length > 0 && (
          <div className="flex items-center gap-2 px-2 py-1 border-b border-border-light text-[9px] font-bold text-text-muted uppercase tracking-[0.7px]">
            <div className="w-[160px] flex-shrink-0">Metric</div>
            <div className="w-[72px] flex-shrink-0">Include</div>
            <div className="w-[110px] flex-shrink-0">Distribution</div>
            <div className="w-[130px] flex-shrink-0">Change Type</div>
            <div className="w-[90px] flex-shrink-0">Min %</div>
            <div className="w-[90px] flex-shrink-0">Max %</div>
            <div className="w-[90px] flex-shrink-0">Std Dev %</div>
            <div className="w-[90px] flex-shrink-0">Confidence %</div>
          </div>
        )}

        {allModelMetrics.length === 0 ? (
          <div className="rounded-md border border-border-light bg-card p-4 text-[12px] text-text-muted flex items-center gap-2">
            <span className="mi text-[16px]">info</span>
            No metrics configured. Go to Model Setup to add metrics.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {allModelMetrics.map(metric => {
              const dist    = getMetricDist(metric.id);
              const enabled = isMetricEnabled(metric.id);
              return (
                <div key={metric.id} className={`rounded-md border bg-card flex items-center gap-2 px-3 py-2.5 transition-opacity ${enabled ? 'border-border-light opacity-100' : 'border-border-light/50 opacity-50'}`}>
                  {/* Metric name */}
                  <div className="w-[160px] flex-shrink-0 flex items-center gap-1.5 min-w-0">
                    <span className="mi text-[14px] flex-shrink-0" style={{ color: metric.rgbColor || 'rgb(192,0,0)' }}>{metric.icon || 'analytics'}</span>
                    <span className="text-[11px] font-bold text-text truncate">{metric.name}</span>
                  </div>

                  {/* Include Yes/No dropdown */}
                  <div className="w-[72px] flex-shrink-0">
                    <select
                      value={enabled ? 'yes' : 'no'}
                      onChange={e => setMetricEnabledFlag(metric.id, e.target.value === 'yes')}
                      className="w-full py-[4px] px-2 rounded-sm text-[11px] font-bold border border-border bg-surface-highest text-text focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>

                  {/* Distribution type dropdown */}
                  <div className="w-[110px] flex-shrink-0">
                    <select
                      value={dist.distType}
                      disabled={!enabled}
                      onChange={e => updateMetricDist(metric.id, 'distType', e.target.value)}
                      className="w-full py-[4px] px-2 rounded-sm text-[11px] font-semibold border border-border bg-surface-highest text-text focus:outline-none focus:border-primary cursor-pointer disabled:cursor-not-allowed"
                    >
                      <option value="uniform">Uniform</option>
                      <option value="normal">Normal</option>
                    </select>
                  </div>

                  {/* Change type dropdown */}
                  <div className="w-[130px] flex-shrink-0">
                    <select
                      value={dist.changeType}
                      disabled={!enabled}
                      onChange={e => updateMetricDist(metric.id, 'changeType', e.target.value)}
                      className="w-full py-[4px] px-2 rounded-sm text-[11px] font-semibold border border-border bg-surface-highest text-text focus:outline-none focus:border-primary cursor-pointer disabled:cursor-not-allowed"
                    >
                      <option value="multiplicative">Multiplicative</option>
                      <option value="additive">Additive</option>
                    </select>
                  </div>

                  {/* Min change % */}
                  <div className="w-[90px] flex-shrink-0">
                    <input type="number" value={dist.minChange} disabled={!enabled}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '' || raw === '-') {
                          updateMetricDist(metric.id, 'minChange', raw);
                        } else {
                          const num = parseFloat(raw);
                          if (!isNaN(num)) updateMetricDist(metric.id, 'minChange', num);
                        }
                      }}
                      className="w-full py-[4px] px-2 rounded-sm text-[11px] font-semibold border border-border bg-surface-highest text-text text-right focus:outline-none focus:border-primary disabled:opacity-40" />
                  </div>

                  {/* Max change % */}
                  <div className="w-[90px] flex-shrink-0">
                    <input type="number" value={dist.maxChange} disabled={!enabled}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '' || raw === '-') {
                          updateMetricDist(metric.id, 'maxChange', raw);
                        } else {
                          const num = parseFloat(raw);
                          if (!isNaN(num)) updateMetricDist(metric.id, 'maxChange', num);
                        }
                      }}
                      className="w-full py-[4px] px-2 rounded-sm text-[11px] font-semibold border border-border bg-surface-highest text-text text-right focus:outline-none focus:border-primary disabled:opacity-40" />
                  </div>

                  {/* Std Dev % (only for normal) */}
                  <div className="w-[90px] flex-shrink-0">
                    {dist.distType === 'normal' ? (
                      <input type="number" min={0} value={dist.sd} disabled={!enabled}
                        onChange={e => updateMetricDist(metric.id, 'sd', +e.target.value)}
                        className="w-full py-[4px] px-2 rounded-sm text-[11px] font-semibold border border-border bg-surface-highest text-text text-right focus:outline-none focus:border-primary disabled:opacity-40" />
                    ) : (
                      <div className="text-[10px] text-text-muted text-center">—</div>
                    )}
                  </div>

                  {/* Confidence % (only for normal) */}
                  <div className="w-[90px] flex-shrink-0">
                    {dist.distType === 'normal' ? (
                      <input type="number" min={50} max={99} value={dist.confidenceLevel} disabled={!enabled}
                        onChange={e => updateMetricDist(metric.id, 'confidenceLevel', Math.max(50, Math.min(99, +e.target.value)))}
                        className="w-full py-[4px] px-2 rounded-sm text-[11px] font-semibold border border-border bg-surface-highest text-text text-right focus:outline-none focus:border-primary disabled:opacity-40" />
                    ) : (
                      <div className="text-[10px] text-text-muted text-center">—</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Base forecast reference */}
      {selectedOutput && (
        <div className="bg-surface-low rounded-lg border border-border-light p-5 flex flex-col gap-3">
          <div className="text-sm font-bold text-text flex items-center gap-2">
            <span className="mi text-[18px] text-primary">analytics</span> Base Forecast — {outputLabel}
          </div>
          <div className="flex flex-wrap gap-4">
            {baseForecastYears.map(({ year, base }) => (
              <div key={year} className="flex flex-col items-center bg-card rounded-md border border-border-light px-4 py-2 min-w-[80px]">
                <span className="text-[10px] text-text-muted font-semibold">{year}</span>
                <span className="text-[13px] font-bold text-text">{fmt(base)}</span>
              </div>
            ))}
            {baseForecastYears.length === 0 && (
              <p className="text-[11px] text-text-muted italic">No forecast data available.</p>
            )}
          </div>
        </div>
      )}

      {/* Placeholder when not yet run */}
      {!hasRun && (
        <div className="bg-surface-low rounded-lg border border-border-light p-16 flex flex-col items-center justify-center gap-4 text-center min-h-[200px]">
          <span className="mi text-[52px] text-text-muted/30">insights</span>
          <div>
            <div className="text-sm font-bold text-text mb-1.5">No Results Yet</div>
            <p className="text-[12px] text-text-muted max-w-[300px] leading-relaxed">
              Configure the input distributions above, set your simulation count, then click <strong>Run Simulation</strong>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
