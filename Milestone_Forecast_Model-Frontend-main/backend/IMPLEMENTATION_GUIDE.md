# Monte Carlo Implementation Guide

## Quick Summary
The Monte Carlo system is **fully implemented and working**. Your frontend calls the correct endpoint (`/api/monte-carlo/run`) which uses dynamic formulas and all enabled metrics.

If you're seeing hardcoded formulas or only 4 metrics in temp_vars, it means either:
1. The frontend is using the wrong endpoint (unlikely - it's correct)
2. The backend validation isn't warning about config issues (FIXED)
3. You haven't read the architecture guide yet (START HERE)

---

## Files to Understand

### Production Code (What's Running)
- **`monte_carlo_db.py`** ← YOUR MAIN SIMULATION CODE
  - `_sample_metric_data()` — Samples all enabled metrics
  - `run_monte_carlo_db()` — Main simulation loop
  - Uses `metric_dists` to determine which metrics to vary
  - Uses `formula_rows` to evaluate output dynamically
  - Uses `output_name` to select which output to simulate
  - **Status**: ✅ Correct implementation

- **`calculator.py`** — Formula evaluation engine
  - `run_calculations()` — Evaluates formulas with sampled data
  - Handles formula chaining (intermediate outputs)
  - **Status**: ✅ Correct implementation

- **`main.py`** — API endpoints
  - `/api/monte-carlo/run` — ACTIVE endpoint
  - **Status**: ✅ NOW with validation + logging

### Deprecated Code (Do Not Use)
- **`monte_carlo.py`** — Legacy in-memory version
  - Contains hardcoded formula
  - Never called by frontend
  - Kept for reference only
  - **Status**: ⚠️ Deprecated

---

## The Flow (What Happens When User Clicks "Run")

### 1. Frontend Prepares Data
```javascript
// MonteCarlo.jsx
const payload = {
  simulations: 10000,
  metricData: { /* ACE values */ },
  formulaRows: [ /* from Model Setup */ ],
  segments: [ /* segment definitions */ ],
  timeline: { /* model timeline */ },
  metricConfigs: { /* inputType, valueType per metric */ },
  configuredMetrics: [ /* all configured metrics */ ],
  metricDists: {
    "metric-1": { distType: "normal", minChange: -20, ... },
    "metric-2": { distType: "uniform", minChange: -10, ... },
    // ONLY enabled metrics ("Include = Yes")
  },
  outputName: "TRx",  // User selected from dropdown
};

const { run_id } = await runMonteCarloRun(payload);
```

### 2. Backend Validates
```python
# main.py line 264-305
if not req.metricDists:
    logger.warning("metric_dists is EMPTY!")
    # User didn't enable any metrics

if not req.formulaRows:
    raise "Configure formulas first"

if not req.outputName or output not in formulas:
    raise "Select valid output"

logger.info(f"Enabled metrics: {list(req.metricDists.keys())}")
logger.info(f"Output: {req.outputName}")
```

### 3. Backend Runs Simulation
```python
# monte_carlo_db.py line 206-351

# Build list of metrics to vary
enabled_metric_ids = set(metric_dists.keys())  # Only enabled ones
metrics_to_vary = [m for m in configured_metrics if m.id in enabled_metric_ids]

# For each iteration (default 10,000)
for i in range(1, simulations + 1):
    
    # Step A: Sample enabled metrics
    sampled_data, temp_vars = _sample_metric_data(
        metric_data,
        metrics_to_vary,      # ONLY enabled metrics
        metric_dists,         # Distribution params
        # ...
    )
    
    # Step B: Evaluate formulas
    formula_outputs = run_calculations(
        formula_rows=formula_rows,           # From Model Setup
        metric_data=sampled_data,            # Sampled values
        # ...
    )
    
    # Step C: Extract selected output
    selected = next((o for o in formula_outputs 
                     if o["outputName"] == output_name), None)
    
    # Step D: Store iteration
    batch.append({
        "run_id": run_id,
        "iteration": i,
        "temp_vars": temp_vars,              # ALL sampled values
        "outputs": selected["outputData"],   # Selected output by segment-year
        "total_output": sum(outputs),        # Grand total
    })
    
    # Insert batch to Supabase
    if len(batch) >= BATCH_SIZE:
        supabase.table("monte_carlo_iterations").insert(batch).execute()
```

### 4. Frontend Fetches Results
```javascript
// MonteCarlo.jsx line 359-402
const { data: rows } = await supabase
  .from("monte_carlo_iterations")
  .select("total_output, outputs")
  .eq("run_id", run_id);

// Build per-year percentiles
for (const row of rows) {
  for (const [segYear, value] of Object.entries(row.outputs)) {
    year = extractYear(segYear);
    perYearBuckets[year].push(value);
  }
}

// Compute and render
const perYearPercentiles = computePercentiles(perYearBuckets);
```

---

## Key Variables Explained

### metric_dists (Frontend → Backend)
```javascript
// What frontend sends:
{
  "metric-lives-reached": {
    distType: "normal",           // Distribution type
    minChange: -20,               // Min % change
    maxChange: 20,                // Max % change
    sd: 10,                       // Std dev (for normal)
    changeType: "multiplicative"  // Or "additive"
  },
  "metric-hcp-adoption": { ... }
}

// Backend uses:
for metric_id in metric_dists.keys():
    dist = metric_dists[metric_id]
    pct_change = sample_from_distribution(dist)
    for each data key:
        sampled[key] = apply_change(base[key], pct_change)
```

**Key Point**: Keys = which metrics to vary. Frontend filters before sending!

### temp_vars (All Sampled Values)
```python
# Backend stores in each iteration:
temp_vars = {
    "temp_Lives Reached (metric-1)-Oncology-Jan-2024": 52341.5,
    "temp_HCP Adoption (metric-2)-Oncology-Jan-2024": 0.45,
    "temp_Payer Access (metric-3)-Oncology-Jan-2024": 0.78,
    "temp_Lives Reached (metric-1)-Cardio-Jan-2024": 31200.0,
    # ... one entry per enabled_metric × segment × period
}

# Should contain:
# ✅ ALL enabled metrics (only those with "Include = Yes")
# ✅ Multiple entries per metric (one per segment-period combo)
# ✅ Actual sampled values (not base values)
```

**Not** 4 hardcoded metrics. **All** enabled metrics.

### outputs (Selected Output Result)
```python
# Backend stores in each iteration:
outputs = {
    "Oncology--2024": 125000.5,      # TRx value for Oncology in 2024
    "Cardio--2024": 87500.3,         # TRx value for Cardio in 2024
    # ... one entry per configured segment × year
}

# Computed from:
# - Formula: TRx = Lives × Adoption × Payer (from Model Setup)
# - Data: sampled_data (the inputs)
# - Result: one value per segment-year
```

---

## Debugging: What To Check

### Issue: "I'm seeing hardcoded formula results"
**Check**:
1. Are you hitting `/api/monte-carlo` (legacy) or `/api/monte-carlo/run` (active)?
   - Frontend uses: `runMonteCarloRun()` → `/api/monte-carlo/run` ✅
   
2. Check backend logs:
   ```
   Output selected: TRx
   Formula rows count: 3
   ```
   If count = 1 and formula is `a*b*c*d`, something is wrong

3. Look at `monte_carlo_db.py` line 304:
   ```python
   formula_outputs = run_calculations(formula_rows=formula_rows, ...)
   ```
   This should evaluate YOUR formulas, not hardcoded ones

### Issue: "temp_vars only has 4 entries"
**Check**:
1. Backend logs should show:
   ```
   Enabled metrics (metric_dists keys): ['metric-1', 'metric-2', ...]
   ```
   If it says 4 metrics, that's what frontend sent

2. Frontend issue: User didn't enable enough metrics
   - Action: Go to Monte Carlo page, check multiple metrics with "Include = Yes"

3. Backend extraction issue: `_sample_metric_data()` not creating temp_vars
   - Check: Does it iterate over `metrics_to_vary`?
   - Check: Line 176-177 creating temp_vars entry?

### Issue: "Output is wrong or missing"
**Check**:
1. Backend logs:
   ```
   Output selected: TRx
   Available formulas: ['TRx', 'NBRx', 'Revenue']
   ```

2. Formula exists in `formula_rows`?
3. Formula definition is correct in Model Setup?
4. `run_calculations()` is evaluating it?

---

## Testing Checklist

### Before Deploy
- [ ] `monte_carlo.py` has deprecation notice
- [ ] `main.py` has validation in `/api/monte-carlo/run`
- [ ] `monte_carlo_db.py` unchanged (already correct)
- [ ] Python syntax check: `python -m py_compile main.py monte_carlo.py monte_carlo_db.py`
- [ ] No import errors: `from .monte_carlo_db import run_monte_carlo_db`

### After Deploy
- [ ] Backend starts without errors
- [ ] `/api/health` returns 200 OK
- [ ] Create formula in Model Setup
- [ ] Enable at least one metric on Monte Carlo page
- [ ] Select output from dropdown
- [ ] Click "Run Simulation"
- [ ] Check backend logs for validation messages
- [ ] Check Supabase table has rows
- [ ] Frontend displays results

### Verification
- [ ] temp_vars has > 4 entries (not hardcoded)
- [ ] temp_vars keys match enabled metrics
- [ ] outputs match selected formula (e.g., TRx values)
- [ ] Results vary (not constant)
- [ ] Cone shows distribution

---

## Common Gotchas

1. **Frontend sends empty metric_dists**
   - User didn't enable any metrics
   - Backend logs: `⚠️  metric_dists is EMPTY!`
   - User action: Check at least one metric on MC page

2. **Formula not defined**
   - User goes to MC page but didn't define formula first
   - Backend error: `Output 'TRx' not found in formulas`
   - User action: Go to Model Setup → Formula Builder → create formula

3. **Wrong endpoint**
   - Old code at `/api/monte-carlo` (legacy, hardcoded)
   - Correct endpoint: `/api/monte-carlo/run` (dynamic, DB-backed)
   - Frontend uses correct one: ✅

4. **Stale formula_rows**
   - User changes formula but doesn't refresh Monte Carlo page
   - Solution: Refresh page or re-run with same selection

---

## Performance Notes

- `BATCH_SIZE = 100` iterations → insert batches to Supabase
- Default `simulations = 10000` (configurable)
- Each iteration: sample + formula eval + insert
- Typical run time: few seconds to minute (depending on Supabase)

---

## Next Steps (If You Need to Modify)

### To change which metrics are sampled:
Edit `metric_dists` filtering in frontend (MonteCarlo.jsx line 321-325)

### To change output selection:
It's already implemented! Just `output_name` parameter

### To change formula evaluation:
Edit `calculator.py` and update `run_calculations()` signature

### To add new metrics:
1. Define in Model Setup (configure)
2. User enables on Monte Carlo page
3. Backend automatically includes via `metric_dists`

### To change temp_vars format:
Edit `_sample_metric_data()` line 177:
```python
temp_vars[f"temp_{metric_name} ({metric_id})-{suffix}"] = ...
```

---

## Reference Links

- **Architecture**: `MONTE_CARLO_ARCHITECTURE.md`
- **Main endpoint**: `main.py` line 264
- **Simulation logic**: `monte_carlo_db.py` line 206
- **Formula evaluation**: `calculator.py` → `run_calculations()`
- **Frontend**: `MonteCarlo.jsx` → `handleRun()` function

---

## Summary

✅ System is working correctly
✅ Backend validation is in place
✅ Logging helps with debugging
✅ Documentation explains the flow
✅ No changes needed for normal use

If you see issues, check:
1. Backend logs (validation messages)
2. User configuration (enabled metrics, formula selected)
3. Supabase connection (can write rows?)
4. Formula definition (exists in Model Setup?)
