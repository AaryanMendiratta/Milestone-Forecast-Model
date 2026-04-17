# Monte Carlo Architecture: Complete Guide

## Overview
The Monte Carlo system has **two implementations**:
- **`monte_carlo.py`** (DEPRECATED) — Legacy in-memory version with hardcoded formulas ❌
- **`monte_carlo_db.py`** (ACTIVE) — DB-backed version with dynamic formulas ✅

The **frontend uses only the DB-backed version** (`/api/monte-carlo/run`).

---

## How It Works (DB-Backed Version)

### Step 1: Frontend Sends Configuration
From the **Monte Carlo page**, user selects:
1. **Output dropdown** — which output to simulate (e.g., "TRx", "NBRx")
2. **Metric checkboxes** — which metrics to vary ("Include = Yes")
3. **Distribution parameters** — for each enabled metric (minChange, maxChange, distribution type, etc.)

The frontend sends:
```javascript
{
  outputName: "TRx",
  metricDists: {
    "metric-lives": { distType: "normal", minChange: -20, maxChange: 20, ... },
    "metric-adoption": { distType: "uniform", minChange: -10, maxChange: 10, ... }
  },
  formulaRows: [ /* from Model Setup */ ],
  configuredMetrics: [ /* all metrics configured */ ],
  metricData: { /* ACE page values */ },
  segments: [ /* segment definitions */ ],
  timeline: { /* model timeline */ },
  // ... more
}
```

### Step 2: Backend Validates & Prepares
In `main.py`:
```python
if not req.metricDists:
    logger.warning("metric_dists is EMPTY! No metrics will be varied.")
    # This is a common issue — check that user enabled at least one metric

if not req.formulaRows:
    raise HTTPException("Configure formulas in Model Setup first")

if not req.outputName or output_not_in_formulas:
    raise HTTPException("Select a valid output from dropdown")
```

### Step 3: Simulation Loop (monte_carlo_db.py)
For each iteration (default 10,000):

#### 3a. Sample Inputs
```python
for metric in enabled_metrics:  # Only those with "Include = Yes"
    pct_change = sample_from_distribution(metric.distribution)
    
    for each_segment_period:
        sampled_value = base_value * (1 + pct_change/100)  # or additive
        temp_vars["temp_MetricName (id)-segment-period"] = sampled_value
```

**KEY**: `temp_vars` contains **ALL enabled metrics**, not hardcoded ones.

#### 3b. Evaluate Formulas
```python
formula_outputs = run_calculations(
    formula_rows=formula_rows,      # Your formula definitions from Model Setup
    metric_data=sampled_data,       # Sampled inputs + base values
    segments=segments,
    timeline=timeline,
    # ... more config
)
```

The formula engine:
- Evaluates each formula row in dependency order
- Intermediate outputs (e.g., `output-NBRx`) feed into dependent formulas
- Example: TRx = NBRx × Payer Access (if that's your formula)

#### 3c. Extract Selected Output
```python
selected = find_output_by_name(formula_outputs, output_name)
output_data = selected["outputData"]  # { "segment-year": value }
```

#### 3d. Store Iteration
```python
{
  run_id: "uuid",
  iteration: 1,
  temp_vars: { "temp_Lives (m-1)-Oncology--Jan 2024": 52341, ... },
  outputs: { "Oncology--2024": 125000, ... },
  total_output: 125000.0
}
```

### Step 4: Frontend Retrieves Results
```javascript
// Fetch all iterations from Supabase
const rows = await supabase
  .from("monte_carlo_iterations")
  .select("total_output, outputs, temp_vars")
  .eq("run_id", run_id);

// Build per-year percentiles (p10, p25, p50, p75, p90)
for (const row of rows) {
  for (const [segYear, value] of Object.entries(row.outputs)) {
    year = extract_year_from_key(segYear);
    perYearBuckets[year].push(value);
  }
}

// Compute summary statistics and render cone
```

---

## Common Issues & Solutions

### Issue 1: "temp_vars only shows 4 hardcoded metrics"
**Cause**: Using legacy `/api/monte-carlo` endpoint instead of `/api/monte-carlo/run`

**Fix**:
- Frontend should use `/api/monte-carlo/run` (it does by default)
- If you see `value = population * lives * adoption * payer`, you're looking at deprecated code

### Issue 2: "metric_dists is empty → no metrics being varied"
**Cause**: Frontend didn't send enabled metrics (all checkboxes unchecked)

**Debug**:
```
Backend logs: "⚠️  metric_dists is EMPTY! No metrics will be varied."
```

**Fix**:
1. On Monte Carlo page, check at least one metric ("Include = Yes")
2. Click "Run Simulation"

### Issue 3: "Output formula doesn't match my formula builder"
**Cause**: Formula builder rows not being sent, or wrong formula definition

**Debug**:
```python
# Check in logs:
logger.info(f"Formula rows count: {len(req.formulaRows)}")
logger.info(f"Output selected: {req.outputName}")
```

**Fix**:
1. Go to Model Setup → Formula Builder
2. Define your output formula (e.g., TRx = Lives × Adoption × Payer)
3. Return to Monte Carlo page and select that output

### Issue 4: "Selected output not found in formulas"
**Cause**: Formula was deleted or frontend/backend out of sync

**Error message**:
```
Output 'TRx' not found in formulas. Available: ['NBRx', 'Revenue']
```

**Fix**: Select from available outputs, or create the formula in Model Setup

---

## Database Schema

### Table: `monte_carlo_runs`
```
{
  id: "uuid",                          // Run identifier
  simulation_count: 10000,             // Number of iterations
  output_name: "TRx",                  // Selected output
  metric_configs: { ... }              // Distribution params used
}
```

### Table: `monte_carlo_iterations`
```
{
  id: "uuid",
  run_id: "uuid",                      // Links to run
  iteration: 1,                        // Iteration number
  temp_vars: {                         // All sampled values
    "temp_Lives Reached (m-1)-Oncology--|Jan 2024": 52341,
    "temp_Adoption (m-2)-Cardio--|Feb 2024": 0.45,
    ...                                // Every enabled metric
  },
  outputs: {                           // Selected output by segment-year
    "Oncology--2024": 125000,
    "Cardio--2024": 87500,
    ...
  },
  total_output: 212500.0               // Sum for histogram
}
```

---

## Code Flow Diagram

```
Frontend (MonteCarlo.jsx)
    ↓
    → Collect enabled metrics + distributions
    → Select output from dropdown
    → Send to /api/monte-carlo/run
    
Backend (main.py)
    ↓
    → Validate: metric_dists, formula_rows, outputName
    → Call run_monte_carlo_db()
    
monte_carlo_db.py: For each iteration (10k times)
    ↓
    1. _sample_metric_data()
       → For each enabled metric, draw % change
       → Apply to all data keys → sampled_data + temp_vars
       
    2. run_calculations()
       → Evaluate all formulas with sampled_data
       → Return formula_outputs (all outputs)
       
    3. Extract selected output
       → Find output_name in formula_outputs
       → Get outputData { "segment-year": value }
       
    4. Insert row to Supabase:
       temp_vars, outputs, total_output

Frontend: Fetch results (Supabase directly if configured, otherwise via `/api/monte-carlo/results/{run_id}`)
    ↓
    → Group by year
    → Compute percentiles
    → Render forecast cone + histogram
```

---

## Debugging Checklist

1. **No metrics being sampled?**
   - Check: `metricDists` not empty in logs
   - Check: At least one metric has `"Include": true` on MC page

2. **Wrong formula being evaluated?**
   - Check: `formulaRows` in logs contains your formula
   - Check: Formula has correct inputs (match metric IDs)
   - Check: `outputName` matches formula output name

3. **Outputs are base values only (no variation)?**
   - Check: Distribution parameters (minChange, maxChange) are not zero
   - Check: `changeType` is "multiplicative" or "additive"

4. **Empty results after run?**
   - Check: Supabase table `monte_carlo_iterations` has rows
   - Check: `output_name` value exists in `outputs` column
   - Check: Frontend can access Supabase (CORS, credentials)

5. **Unexpected percentiles or distribution?**
   - Check: Distribution type (normal vs. uniform) is correct
   - Check: Confidence level (if normal) makes sense
   - Remember: One sample per metric per iteration (applied uniformly to all periods)

---

## Files

- **`monte_carlo.py`** — Deprecated legacy code (reference only, do not use)
- **`monte_carlo_db.py`** — Active simulation engine with dynamic formulas ✅
- **`main.py`** `/api/monte-carlo/run` — Frontend entry point
- **`calculator.py`** `run_calculations()` — Formula evaluation engine
- **Frontend**: `MonteCarlo.jsx`, `api.js` `runMonteCarloRun()`

---

## Best Practices

1. **Always enable at least one metric** on the MC page
2. **Define formulas in Model Setup** before running simulations
3. **Select an output** from the dropdown
4. **Use realistic distributions** (90% confidence, min/max bounds)
5. **Check backend logs** if results seem wrong
6. **Test with small sample size first** (100 iterations) before 10k+
