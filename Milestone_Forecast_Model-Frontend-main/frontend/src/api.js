// In dev: leave VITE_API_URL unset → BASE_URL = '' → requests hit the Vite proxy (/api → localhost:8000)
// In prod: set VITE_API_URL to the Render URL → direct requests to the backend
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * Save the full ACE application state to the Python backend.
 * @param {Object} state - { segments, timeline, configuredMetrics, metricData, metricsState }
 */
export async function saveToBackend(state) {
  const res = await fetch(`${BASE_URL}/api/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Save failed: ${err}`);
  }
  return res.json();
}

/**
 * Load previously saved ACE application state from the Python backend.
 * Returns { status, data } where data is null if nothing is saved yet.
 */
export async function loadFromBackend() {
  const res = await fetch(`${BASE_URL}/api/load`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Load failed: ${err}`);
  }
  return res.json();
}

/**
 * Run the Python formula engine and return calculated outputs.
 *
 * @param {{ formulaRows, metricData, segments, timeline }} payload
 * @returns {Promise<{ status: string, outputs: Array }>}
 *   outputs: [{ outputName, formulaRowId, outputData: { key: number } }]
 */
export async function calculateOutputs(payload) {
  const res = await fetch(`${BASE_URL}/api/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Calculate failed: ${err}`);
  }
  return res.json();
}

/**
 * Generate an uptake curve preview from the backend.
 *
 * @param {{ months_to_peak, diffusion_constant, peak_value, from_year, to_year }} params
 * @returns {Promise<{ status, years_to_peak, curve: { [year]: value } }>}
 */
export async function fetchUptakeCurve(params, signal) {
  const res = await fetch(`${BASE_URL}/api/uptake-curve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Uptake curve failed: ${err}`);
  }
  return res.json();
}

/**
 * Run Monte Carlo simulation on backend (legacy in-memory, no DB).
 *
 * @param {{
 *   simulations: number,
 *   baseForecastByYear: Array<{ year: number, base: number }>,
 *   inputDistributions: Array<{
 *     metricId: string,
 *     metricName: string,
 *     enabled: boolean,
 *     distributionType: 'uniform' | 'normal',
 *     changeType: 'additive' | 'multiplicative',
 *     minChange: number,
 *     maxChange: number,
 *     stdDev: number,
 *     confidenceLevel: number,
 *   }>
 * }} payload
 */
export async function runMonteCarlo(payload) {
  const res = await fetch(`${BASE_URL}/api/monte-carlo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Monte Carlo failed: ${err}`);
  }
  return res.json();
}

/**
 * Run DB-backed Monte Carlo simulation on backend.
 *
 * The backend will:
 *   1. Clear all previous simulation data from Supabase.
 *   2. Run the requested number of iterations.
 *   3. Write every iteration row (temp_vars, outputs, total_output) to Supabase.
 *   4. Return a run_id that the frontend uses to query results.
 *
 * @param {{
 *   simulations: number,
 *   metricData: Object,
 *   formulaRows: Array,
 *   segments: Array,
 *   timeline: Object,
 *   metricConfigs: Object,
 *   configuredMetrics: Array,
 *   metricDists: Object,  // { metricId: { distType, minChange, maxChange, sd } }
 *   outputName: string,
 * }} payload
 * @returns {Promise<{ status: string, run_id: string, simulations_count: number }>}
 */
export async function runMonteCarloRun(payload) {
  const res = await fetch(`${BASE_URL}/api/monte-carlo/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => res.statusText);
    }
    throw new Error(`Monte Carlo run failed (${res.status}): ${detail}`);
  }
  return res.json();
}

/**
 * Fetch Monte Carlo iteration rows via the backend (service key).
 * @param {string} runId
 * @returns {Promise<{ status: string, rows: Array }>}
 */
export async function fetchMonteCarloResults(runId) {
  const res = await fetch(`${BASE_URL}/api/monte-carlo/results/${encodeURIComponent(runId)}`);
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Monte Carlo results failed: ${err || res.statusText}`);
  }
  return res.json();
}
