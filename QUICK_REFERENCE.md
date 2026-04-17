# Monte Carlo Quick Reference

## The Problem
❌ Hardcoded formula: `value = population * lives * adoption * payer`
❌ Only 4 metrics in temp_vars (hardcoded list)
❌ Output selection ignored

## The Solution
✅ Dynamic formulas from Model Setup
✅ All enabled metrics sampled (not hardcoded)
✅ Output selection drives calculation

## System Overview

```
User                Backend                  Supabase
 │                   │                         │
 ├─ Monte Carlo      │                         │
 │  • Check metrics  │                         │
 │  • Select output  │                         │
 │  • Click "Run"    │                         │
 │                   │                         │
 └──────────────────►│                         │
        POST /api/monte-carlo/run              │
                     │                         │
                   Validate:                   │
                   ✓ Metrics enabled?          │
                   ✓ Formula exists?           │
                   ✓ Output valid?             │
                     │                         │
                   For 10,000 iterations:      │
                   1. Sample inputs            │
                   2. Evaluate formula         │
                   3. Extract output           │
                   4. Store iteration          │
                     │                         │
                     └────────────────────────►│
                        INSERT: temp_vars,     │
                        outputs, total_output  │
                     │                         │
                     │◄──────────────────────┤ run_id
                     │                    
                   Return run_id
                     │
                     │◄──────────────────────
        Fetch results from Supabase
                     │
        Display: Cone, Histogram, Stats
```

## What Each File Does

| File | Purpose | Status |
|------|---------|--------|
| `monte_carlo_db.py` | Simulation engine | ✅ Active |
| `calculator.py` | Formula evaluation | ✅ Correct |
| `main.py` `/api/monte-carlo/run` | API endpoint | ✅ Enhanced |
| `monte_carlo.py` | Legacy code | ⚠️ Deprecated |

## Data Flow

### Frontend Sends:
```javascript
{
  outputName: "TRx",           // User selected
  metricDists: {               // Only enabled metrics
    "m-1": { ... },
    "m-2": { ... }
  },
  formulaRows: [ ... ],        // From Model Setup
  configuredMetrics: [ ... ],
  metricData: { ... },
  // ... more
}
```

### Backend Processes (per iteration):
```
1. temp_vars ← Sample all enabled metrics
2. sampled_data ← Apply changes to base values
3. formula_outputs ← Evaluate formulas
4. output ← Extract selected output (e.g., TRx)
5. Store: temp_vars, outputs, total_output
```

### Frontend Receives:
```javascript
{
  run_id: "uuid",
  simulations_count: 10000
}
// Then fetches iterations from Supabase
```

## Key Concepts

### metric_dists
**What**: Enabled metrics with distributions
**Example**:
```
{
  "metric-lives": { distType: "normal", ... },
  "metric-adoption": { distType: "uniform", ... }
}
```
**Frontend sends**: ONLY enabled metrics (filtered)
**Backend uses**: To determine which metrics to vary

### temp_vars
**What**: All sampled values in an iteration
**Should contain**: One entry per enabled_metric × segment × period
**Example**:
```
{
  "temp_Lives (m-1)-Oncology-Jan-2024": 52341,
  "temp_Adoption (m-2)-Oncology-Jan-2024": 0.45,
  "temp_Lives (m-1)-Cardio-Jan-2024": 31200,
  ...
}
```
**NOT**: 4 hardcoded metrics

### outputs
**What**: Selected output result
**Contains**: One value per segment × year
**Example**:
```
{
  "Oncology--2024": 125000,    // TRx for Oncology 2024
  "Cardio--2024": 87500        // TRx for Cardio 2024
}
```

## Troubleshooting

| Problem | Check | Solution |
|---------|-------|----------|
| Only 4 metrics in temp_vars | Are >4 metrics enabled? | Enable more metrics on MC page |
| "Output not found" | Does formula exist? | Create in Model Setup → Formula Builder |
| No data | Did simulation complete? | Check backend logs for "MC run complete" |
| Wrong formula | Is formula in Model Setup? | Update formula definition |
| Empty metric_dists | Are any metrics checked? | Check "Include = Yes" for metrics |

## Backend Logs to Check

```
=== MONTE CARLO RUN ===
Output selected: TRx
Simulations: 10000
Enabled metrics (metric_dists keys): ['metric-1', 'metric-2']
Formula rows count: 3
✓ MC run complete: run_id=xyz, iterations=10000
```

Look for:
- ✅ "MC run complete" = success
- ⚠️ "metric_dists is EMPTY" = no metrics enabled
- ❌ "Output 'X' not found" = formula not defined
- ❌ "No formula rows" = no formulas in Model Setup

## How to Use

### 1. Model Setup
- Define formula (e.g., TRx = Lives × Adoption × Payer)
- Save

### 2. Monte Carlo Page
- Check metrics: ☑ Lives, ☑ Adoption, ☑ Payer
- Select Output: TRx
- Click "Run Simulation"

### 3. Results
- Cone shows per-year percentiles
- Histogram shows distribution
- Summary shows statistics

## Files to Read

1. **Start Here**: `MONTE_CARLO_ARCHITECTURE.md`
   - Complete flow explanation
   - Database schema
   - Debugging matrix

2. **Implementation**: `backend/IMPLEMENTATION_GUIDE.md`
   - Code flow details
   - Variable explanations
   - What each file does

3. **Code Comments**:
   - `monte_carlo_db.py` line 206+ (main function)
   - `main.py` line 264+ (validation)

## Success Criteria

✅ temp_vars has >4 entries (varies by config)
✅ temp_vars contains enabled metrics
✅ outputs match selected formula
✅ Results vary (not constant)
✅ Cone/histogram renders
✅ No errors in logs

## Common Gotchas

1. **Forgot to enable metrics** → metric_dists empty
2. **Forgot to define formula** → "not found" error
3. **Didn't select output** → validation error
4. **Using old endpoint** → hardcoded results
5. **Stale page load** → formula_rows outdated

## Questions?

Check:
1. `MONTE_CARLO_ARCHITECTURE.md` (architecture)
2. `backend/IMPLEMENTATION_GUIDE.md` (code details)
3. Backend logs (validation messages)
4. Supabase tables (iteration data)
