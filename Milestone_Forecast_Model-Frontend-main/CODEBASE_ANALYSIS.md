# Frontend Codebase Analysis

## 1. % Symbol Display with Color in Input Fields

### Uptake Curve Peak Value Inputs (Ace.jsx)
**File:** [frontend/src/Ace.jsx](frontend/src/Ace.jsx)

#### Location 1: Input Field with Purple Background
- **Line 260** - Peak value input field:
  ```jsx
  <span className="px-2 text-[11px] font-bold text-purple-600 bg-purple-50 border-l border-border select-none">%</span>
  ```
  - **Color:** Purple-600 text on purple-50 background
  - **Context:** Input for peak value per segment in uptake curve
  - **Part of:** UptakeCurveTable component

#### Location 2: Uptake Curve Results Table
- **Line 293** - % symbol in curve results:
  ```jsx
  <span>{Number(value).toFixed(2)}</span><span className="text-purple-600 font-bold ml-0.5">%</span>
  ```
  - **Color:** Purple-600 text
  - **Context:** Displaying computed uptake curve values in the results table row
  - **Example:** `80.00%` displayed with percentage sign in purple

#### Location 3: MetricDataTable Input Labels
- **Line 402** - % symbol as separate column header/label:
  ```jsx
  <span className="flex items-center justify-start h-9 text-[10px] font-semibold text-text-muted select-none">%</span>
  ```
  - **Color:** text-text-muted (gray color)
  - **Context:** Column header for percentage-type metrics
  - **Part of:** MetricDataTable component (for Annual/Single-input metrics)

#### Location 4: Red Border Styling
- **Line 287** - Red left border in uptake curve segment labels:
  ```jsx
  style={{ borderLeftColor: 'rgb(192,0,0)' }}
  ```
  - **Color:** RGB(192, 0, 0) - Dark Red
  - **Context:** Left border of segment name cells in uptake curve table

---

## 2. Issue Preventing Calculations from Working

### API Call Location
**File:** [frontend/src/Calculations.jsx](frontend/src/Calculations.jsx)
**Lines:** 304-323

### Current API Call Structure:
```javascript
const result = await apiCalculate({
  formulaRows,
  metricData,
  segments,
  timeline,
  metricConfigs,
  configuredMetrics,
});
```

### API Function Definition
**File:** [frontend/src/api.js](frontend/src/api.js)
**Lines:** 32-48

```javascript
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
```

### The Problem:
The calculations use a **fallback mechanism** when backend fails:

**Lines 327-335** in Calculations.jsx:
```javascript
// When any formula uses an uptake-curve metric, always use local calculation
// because the backend doesn't implement per-segment uptake curve key lookup.
const anyFormulaHasUptakeCurve = formulaRows.some(fr =>
  fr.items?.some(item => {
    const id = item.metricId || item.metric?.id;
    return id && metricConfigs[id]?.inputType === 'uptake-curve';
  })
);
```

**Key Issue:** If uptake-curve metrics are used in formulas, the system **bypasses the backend entirely** and uses local calculation because the backend doesn't support per-segment uptake curve lookup.

### Error Handling:
**Lines 305-320** - Try/catch with state management:
```javascript
try {
  const result = await apiCalculate({...});
  setBackendOutputs(result.outputs);
  setUsingBackend(true);
} catch (err) {
  setCalcError(err.message);      // Error stored in state
  setUsingBackend(false);
}
```

### Status Indicators in UI:
**Lines 374-378** - Shows calculation status:
- ✓ "Backend" - if backend calculation successful
- ⚠ "Local fallback" - if backend failed AND uptake curves are used
- 🔄 "Calculating..." - if loading

---

## 3. Uptake Curve Configuration & Peak Value Inputs

### Architecture
**File:** [frontend/src/Ace.jsx](frontend/src/Ace.jsx)
**Component:** `UptakeCurveTable` (Lines 38-170)

### Configuration Parameters:

#### 1. **Months to Peak** (Shared parameter)
- **Line 254** - Input field for months
- **Type:** Number input
- **Range:** 1 to unlimited
- **Used for:** Calculating years to peak (rounds `monthsToPeak / 12`)

#### 2. **Diffusion Constant** (Shared parameter)
- **Line 264** - Slider control (1.0 to 2.0)
- **Step:** 0.01
- **Labels:** 
  - 1.0 = "Slow"
  - 1.5 = "Linear" (default)
  - 2.0 = "Fast"
- **Used for:** Exponential power calculation in uptake curve formula

#### 3. **Peak Value per Segment** (Per-tag inputs)
- **Lines 240-270** - Individual input for each segment tag
- **Type:** Number (0-100)
- **Key Function:** `updateSegmentPeak(tag, value)` at line 91
- **Stored in:** `metricConfigs[metric.id].segmentPeakValues[tag]`
- **Input UI:** Has purple "%" suffix at line 260

### How Peak Values Are Used:

**In `buildAllCurves` callback (Lines 103-145):**
```javascript
const computeLocal = (pv_num) => {
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
```

**Peak Value Formula:**
```
If year_index >= yearsTopeak:  value = peakValue
Else:                          value = peakValue × (yearIndex / yearsTopeak) ^ (1/(diffusionConstant - 0.5))
```

### Storage Mechanism:
- **metricData** stores computed curve values with key: `${metric.id}-${tag}--${year}`
- **Flag for detection:** `${metric.id}--is-uptake-curve` = true
- Facilitates fallback detection even after page reload

---

## 4. Monte Carlo Page Structure

**File:** [frontend/src/MonteCarlo.jsx](frontend/src/MonteCarlo.jsx)

### Page Layout (Top to Bottom):

#### Section 1: Header & Controls
**Lines 217-268**
- Title: "Monte Carlo Simulation"
- Description: "Define forecast variance and run probabilistic simulations..."
- Controls:
  - **Output Metric selector** - dropdown to choose which output to simulate
  - **Simulations count** - input (default: 10,000; range: 100-100,000)
  - **Reset button** - clears simulation state
  - **Run Simulation button** - main action button (disables during run)

#### Section 2: Warning Message (if no outputs)
**Lines 270-275**
- Shows if `enrichedOutputs.length === 0`
- Message: "No outputs found. Configure your metrics and formula in Model Setup first..."

#### Section 3: Two-Column Main Layout
**Lines 277-279** - Grid: `grid-cols-[400px_1fr]`

##### LEFT COLUMN (400px fixed width):
**Input Distributions Section**
- **Lines 282-283**: "Forecast Variance" section header
- **Lines 285-297**: Base Forecast Reference box
  - Shows selected output metric values for each year
  - Displays total sum
- **Lines 299-325**: Distribution Configuration
  - **Distribution Type**: Toggle between Uniform/Normal
  - **Change Type**: Toggle between Additive/Multiplicative
  - **Min/Max Change %**: Input fields (defaults: -20 to +20)
  - **Normal-only inputs** (Lines 318-324):
    - Standard Deviation %
    - Confidence Level % (50-99)

##### RIGHT COLUMN (flex, fills remaining space):
**Output Section**
- **Pre-Run State** (before first simulation):
  - Placeholder box with "No Results Yet" message
  - Instructions to configure and run
  
- **Post-Run State** (after simulation runs):
  - **Stat Cards** (Lines 383-392): 3-column grid
    - Simulations Run count
    - Median output value
    - P90–P10 Range (uncertainty)
  
  - **Two Probability Charts** (Lines 394-423):
    - **Left Chart**: Probability Distribution histogram
    - **Right Chart**: CCDF - Probability of Achieving Thresholds
  
  - **Simulation Summary Table** (Lines 425-460):
    - Statistics displayed: Min, P10, P25, P50, P75, P90, Max, Mean, Std. Dev.
    - 2-column table: Statistic name | Value

### Component Rendering Flow:

1. State Management (Lines 163-206)
   - `enrichedOutputs` - computed from formula rows
   - `selectedOutput` - chosen from dropdown
   - `baseForecastYears` - annual totals from selected output
   - `simulationResults` - stored/loaded from localStorage

2. Simulation Handler (Lines 208-235)
   - Validates existence of forecast data
   - Runs Monte Carlo loop: 10,000x iterations by default
   - Each iteration: Apply independent variance to each year → sum totals
   - Stores results in localStorage

3. Data Display Logic (Lines 237-242)
   - Formats numbers based on `isPercentage` flag
   - Uses `fmtK()` for thousands notation (K/M)

---

## 5. MetricDependencies.jsx Structure

**File:** [frontend/src/MetricDependencies.jsx](frontend/src/MetricDependencies.jsx)

### Main Component Sections:

#### Default Metrics (Lines 1-25)
Four pre-defined metrics exposed in UI:
1. **Population** - Patient Population (icon: groups, color: red rgb(244, 63, 94))
2. **Market-share** - Market Share (icon: pie_chart, color: purple rgb(168, 85, 247))
3. **Treatment-rate** - Treatment Rate (icon: monitor_heart, color: brown rgb(121, 49, 0))
4. **Cost-per-patient** - Cost per Patient (icon: payments, color: gray rgb(107, 114, 128))

#### Operators List (Lines 27-32)
- Add, Subtract, Multiply, Divide, Equal operators with symbols

#### SubComponents:
1. **MetricDetailModal** (Lines 35-102)
   - Allows selecting Primary/Secondary segment attributes for each metric
   - Checkboxes for attribute selection
   - Apply/Cancel buttons

2. **MetricConfig** (Lines 104-253)
   - Horizontal 3-column layout for metric configuration
   - Selectors for: Input Type, Value Type, Segment Attributes
   - Conditional inputs based on type selection

3. **FormulaRow** (Lines 255-325)
   - Dropdowns for metric selection per item
   - Operator selection between metrics
   - Output name input after "equal" operator
   - Add Input button for chaining
   - Remove Row button

#### Main Export Function (Lines 328+)
- State initialization from localStorage/context
- Drag-and-drop metric/operator selection
- Save workflow for configuring metrics and formulas
- Integration with useApp() context

### Key Data Structures:
```javascript
{
  metrics: [{id, name, desc, icon, color, rgbColor, bg, borderColor}],
  metricConfigs: {
    [metricId]: {
      inputType: 'single-input|annual|uptake-curve',
      valueType: 'numeric|percentage',
      selectedSegments: [segmentIds],
      inputValue: string,
      segmentPeakValues: {[tag]: value}, // for uptake-curve only
    }
  },
  formulaRows: [{
    id: string,
    items: [{metricId, operator, outputName}],
    isComplete: boolean
  }]
}
```

---

## Summary Table

| Item | File | Lines | Details |
|------|------|-------|---------|
| % with purple background | Ace.jsx | 260 | `text-purple-600 bg-purple-50` |
| % with purple text | Ace.jsx | 293 | `text-purple-600` in results |
| % with gray text | Ace.jsx | 402 | `text-text-muted` in metric table |
| Red border | Ace.jsx | 287 | `rgb(192,0,0)` |
| API calculate call | Calculations.jsx | 304-316 | POST to `/api/calculate` |
| API error handling | Calculations.jsx | 318-320 | Try/catch with state |
| Uptake curve params | Ace.jsx | 254-270 | Months, Diffusion, Peak per segment |
| Peak value inputs | Ace.jsx | 240-270 | Per-tag number inputs with UI |
| Monte Carlo header | MonteCarlo.jsx | 217-268 | Title, output selector, controls |
| MC distributions | MonteCarlo.jsx | 282-325 | Left-column variance config |
| MC results | MonteCarlo.jsx | 368-460 | Charts and summary table |
| Default metrics | MetricDependencies.jsx | 1-25 | 4 pre-defined metrics with colors |
| Formula builder | MetricDependencies.jsx | 255-325 | Metric/operator selection interface |

