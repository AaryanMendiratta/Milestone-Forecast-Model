"""
main.py — FastAPI application for Clinical Architect backend.

Endpoints:
  GET  /api/health               — liveness check
  POST /api/save                 — persist full app state to ace_data.json
  GET  /api/load                 — load persisted app state from ace_data.json
  POST /api/calculate            — run formula calculations and return outputs
  POST /api/monte-carlo          — DEPRECATED: legacy in-memory Monte Carlo (do not use)
  POST /api/monte-carlo/run      — ACTIVE: DB-backed Monte Carlo with dynamic formulas ✅
  GET  /api/monte-carlo/latest-run — latest Monte Carlo run metadata
  POST /api/scenarios/save       — save scenario to Supabase
  GET  /api/scenarios/list       — list all scenarios
  GET  /api/scenarios/{id}       — load specific scenario
  DELETE /api/scenarios/{id}     — delete scenario

IMPORTANT: /api/monte-carlo/run is the ONLY Monte Carlo endpoint you should use.
It supports:
  • Dynamic input sampling (only enabled metrics are varied)
  • Formula builder integration (formulas defined in Model Setup)
  • Multiple outputs (selected via dropdown)
  • Full persistence to Supabase with temp_vars for all sampled values
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any
import json
import os
import uuid

try:
    from dotenv import load_dotenv
    import pathlib
    load_dotenv(dotenv_path=pathlib.Path(__file__).parent / ".env", override=True)
except ImportError:
    pass  # python-dotenv not installed; env vars must be set in the environment

from .calculator import run_calculations, generate_uptake_curve
from .db import get_client
from .monte_carlo import run_monte_carlo

app = FastAPI(title="Clinical Architect API", version="1.0.0")

# ── CORS ──────────────────────────────────────────────────────────────────────
# Always allow localhost dev origins.
# Additional origins can be supplied via the ALLOWED_ORIGINS env var
# (comma-separated) — useful for Vercel preview/production URLs.
_default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "https://milestone-forecast-model-frontend-1qbd-be634b30x.vercel.app",
    "https://milestone-forecast-model-frontend-1qbd-be634b30x.vercel.app/",
]
_extra = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
_allowed_origins = list(dict.fromkeys(_default_origins + _extra))  # deduplicate, preserve order

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    # Allow all *.vercel.app preview deployments
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)

DATA_FILE = "ace_data.json"


# ─── Pydantic models ──────────────────────────────────────────────────────────

class AppState(BaseModel):
    segments: list[Any]
    timeline: dict[str, Any]
    configuredMetrics: list[Any]
    metricData: dict[str, Any]
    metricsState: dict[str, Any]


class CalculateRequest(BaseModel):
    """
    Payload sent from the Calculations page.

    formulaRows      — from metricsState.formulaRows (built in Model Setup)
    metricData       — the flat dict of values entered in the ACE page
    segments         — list of segment objects with id/name/type/tags
    timeline         — { fromMonth, fromYear, toMonth, toYear, granularity }
    metricConfigs    — metricsState.metricConfigs (inputType, inputValue per metric)
    configuredMetrics— the list of configured metric objects (id, selectedSegments, ...)
    """
    formulaRows: list[Any]
    metricData: dict[str, Any]
    segments: list[Any]
    timeline: dict[str, Any]
    metricConfigs: dict[str, Any] = {}
    configuredMetrics: list[Any] = []


class UptakeCurveRequest(BaseModel):
    months_to_peak: float
    diffusion_constant: float
    peak_value: float
    from_year: int
    to_year: int


class MonteCarloInputDistribution(BaseModel):
    metricId: str
    metricName: str
    enabled: bool = True
    distributionType: str = "uniform"
    changeType: str = "additive"
    minChange: float = -20
    maxChange: float = 20
    stdDev: float = 10
    confidenceLevel: float = 90


class MonteCarloYearValue(BaseModel):
    year: int
    base: float


class MonteCarloRequest(BaseModel):
    simulations: int = 10000
    baseForecastByYear: list[MonteCarloYearValue]
    inputDistributions: list[MonteCarloInputDistribution]


class MonteCarloRunRequest(BaseModel):
    """Payload for the DB-backed Monte Carlo endpoint."""
    simulations: int = 10000
    metricData: dict[str, Any]
    formulaRows: list[Any]
    segments: list[Any]
    timeline: dict[str, Any]
    metricConfigs: dict[str, Any] = {}
    configuredMetrics: list[Any] = []
    metricDists: dict[str, Any] = {}   # { metricId: { distType, minChange, maxChange, sd } }
    outputName: str = ""


class ScenarioSaveRequest(BaseModel):
    """Payload for saving a scenario to Supabase."""
    scenario_name: str
    description: str | None = None
    scenario_data: dict[str, Any]

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/debug-calculate")
def debug_calculate(req: MonteCarloRunRequest):
    """Debug endpoint: runs ONE calculation iteration and returns raw values."""
    from .calculator import run_calculations, calculate_for_period, generate_timeline

    timeline_annual = {**req.timeline, 'granularity': 'annual'}
    periods = generate_timeline(timeline_annual)

    results = run_calculations(
        formula_rows=req.formulaRows,
        metric_data=req.metricData,
        segments=req.segments,
        timeline=req.timeline,
        metric_configs=req.metricConfigs,
        configured_metrics=req.configuredMetrics,
    )

    # Show raw metricData values for first 30 keys
    md_sample = {k: v for k, v in list(req.metricData.items())[:40]}
    mc_sample = {k: {
        "inputType": v.get("inputType"),
        "valueType": v.get("valueType"),
        "segmentPeakValues": v.get("segmentPeakValues"),
        "inputValue": v.get("inputValue"),
    } for k, v in req.metricConfigs.items()}

    return {
        "status": "ok",
        "metricData_sample": md_sample,
        "metricConfigs": mc_sample,
        "calculation_outputs": [
            {
                "outputName": o["outputName"],
                "outputData": dict(list(o["outputData"].items())[:20])
            }
            for o in results
        ]
    }


@app.post("/api/save")
def save_data(state: AppState):
    """Persist full application state to a local JSON file."""
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(state.model_dump(), f, indent=2)
    return {"status": "saved", "message": "Data saved successfully"}


@app.get("/api/load")
def load_data():
    """Load previously saved application state."""
    if not os.path.exists(DATA_FILE):
        return {"status": "no_data", "data": None}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {"status": "ok", "data": data}


@app.post("/api/calculate")
def calculate(req: CalculateRequest):
    """
    Run the formula engine on the supplied data and return all outputs.

    Each output in the response looks like:
      {
        "outputName":   "Patient Cohort",
        "formulaRowId": "row-1234567890",
        "outputData": {
          "Oncology-US – Northeast-2024": 42500.0,
          "Oncology-EU – Central-2024":   31200.0,
          ...
        }
      }

    Outputs are returned in formula-row order so the UI can display them in
    the same sequence the user defined them.  Chained formulas (where one
    output is used as input to a later row) are handled automatically.
    """
    outputs = run_calculations(
        formula_rows=req.formulaRows,
        metric_data=req.metricData,
        segments=req.segments,
        timeline=req.timeline,
        metric_configs=req.metricConfigs,
        configured_metrics=req.configuredMetrics,
    )
    return {"status": "ok", "outputs": outputs}


@app.post("/api/uptake-curve")
def uptake_curve(req: UptakeCurveRequest):
    curve = generate_uptake_curve(
        months_to_peak=req.months_to_peak,
        diffusion_constant=req.diffusion_constant,
        peak_value=req.peak_value,
        from_year=req.from_year,
        to_year=req.to_year,
    )
    return {
        "status": "ok",
        "years_to_peak": max(1, round(req.months_to_peak / 12)),
        "curve": {str(year): value for year, value in curve.items()},
    }


@app.post("/api/monte-carlo")
def monte_carlo(req: MonteCarloRequest):
    result = run_monte_carlo(
        simulations=req.simulations,
        base_forecast_by_year=[{"year": y.year, "base": y.base} for y in req.baseForecastByYear],
        input_distributions=[d.model_dump() for d in req.inputDistributions],
    )
    return {"status": "ok", **result}


@app.post("/api/monte-carlo/run")
def monte_carlo_run(req: MonteCarloRunRequest):
    """
    DB-backed Monte Carlo simulation.

    Creates a new simulation run, writes every iteration to Supabase, and
    returns the run_id so the frontend can fetch only that run's results.
    
    IMPORTANT: metricDists should contain ONLY enabled metrics (those with
    "Include = Yes" on the Monte Carlo page). The frontend filters before sending.
    If metricDists is empty, no inputs will be varied → outputs = base only.
    """
    import logging
    logger = logging.getLogger("uvicorn.error")
    
    # ─── VALIDATION ──────────────────────────────────────────────────────────
    logger.info("=== MONTE CARLO RUN ===")
    logger.info(f"Output selected: {req.outputName}")
    logger.info(f"Simulations: {req.simulations}")
    logger.info(f"Enabled metrics (metric_dists keys): {list(req.metricDists.keys())}")
    logger.info(f"Formula rows count: {len(req.formulaRows)}")
    logger.info(f"Configured metrics: {[m.get('id') for m in req.configuredMetrics]}")
    
    if not req.metricDists:
        logger.warning("⚠️  metric_dists is EMPTY! No metrics will be varied.")
        logger.warning("   Frontend should send enabled metrics with distributions.")
        logger.warning("   Check that you have set 'Include = Yes' for at least one metric.")
    
    if not req.formulaRows:
        raise HTTPException(status_code=400, detail="No formula rows provided. Configure formulas in Model Setup first.")
    
    if not req.outputName:
        raise HTTPException(status_code=400, detail="No output selected. Choose an output from the Monte Carlo dropdown.")
    
    # Validate that the selected output exists in formula rows
    def _extract_output_name(row: dict) -> str | None:
        items = row.get("items") or []
        if not items:
            return None
        return (items[-1] or {}).get("outputName")

    available = [name for name in (_extract_output_name(r) for r in req.formulaRows) if name]
    if req.outputName not in available:
        raise HTTPException(
            status_code=400,
            detail=f"Output '{req.outputName}' not found in formulas. Available: {available}"
        )
    
    # ─── EXECUTION ───────────────────────────────────────────────────────────
    try:
        from .monte_carlo_db import run_monte_carlo_db
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=f"monte_carlo_db module error: {exc}")

    try:
        result = run_monte_carlo_db(
            simulations=req.simulations,
            metric_data=req.metricData,
            formula_rows=req.formulaRows,
            segments=req.segments,
            timeline=req.timeline,
            metric_configs=req.metricConfigs,
            configured_metrics=req.configuredMetrics,
            metric_dists=req.metricDists,
            output_name=req.outputName,
        )
        logger.info(f"✓ MC run complete: run_id={result['run_id']}, iterations={result['simulations_count']}")
    except RuntimeError as exc:
        logger.error(f"Runtime error: {exc}")
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        import traceback
        logger.error(f"Error: {type(exc).__name__}: {exc}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")

    return {"status": "ok", **result}


# ─── Scenario Endpoints ─────────────────────────────────────────────────────

def _get_supabase():
    try:
        return get_client()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.get("/api/monte-carlo/results/{run_id}")
def monte_carlo_results(run_id: str):
    """Fetch Monte Carlo iteration rows from Supabase via the backend."""
    supabase = _get_supabase()
    rows: list[dict] = []
    page_size = 1000
    last_iteration = 0
    max_rows = 200000

    while True:
        result = (
            supabase.table("monte_carlo_iterations")
            .select("iteration,total_output,outputs")
            .eq("run_id", run_id)
            .gt("iteration", last_iteration)
            .order("iteration")
            .limit(page_size)
            .execute()
        )
        batch = result.data or []
        if not batch:
            break
        rows.extend(batch)
        next_iteration = batch[-1].get("iteration")
        if not isinstance(next_iteration, int):
            try:
                next_iteration = int(next_iteration)
            except (TypeError, ValueError):
                break
        if next_iteration <= last_iteration:
            break
        last_iteration = next_iteration
        if len(rows) >= max_rows:
            rows = rows[:max_rows]
            break
        if len(batch) < page_size:
            break

    return {"status": "ok", "rows": rows}


@app.get("/api/monte-carlo/latest-run")
def monte_carlo_latest_run():
    """Return the latest Monte Carlo run metadata."""
    supabase = _get_supabase()
    result = (
        supabase.table("monte_carlo_runs")
        .select("id,created_at,simulation_count,output_name")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    runs = result.data or []
    return {"status": "ok", "run": runs[0] if runs else None}


@app.post("/api/scenarios/save")
def save_scenario(req: ScenarioSaveRequest):
    """Save a scenario to Supabase."""
    supabase = _get_supabase()
    scenario_id = str(uuid.uuid4())
    data = {
        "id": scenario_id,
        "scenario_name": req.scenario_name,
        "description": req.description,
        "scenario_data": req.scenario_data,
    }
    try:
        supabase.table("scenarios").insert(data).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error saving scenario: {exc}")

    return {
        "status": "ok",
        "id": scenario_id,
        "message": f"Scenario '{req.scenario_name}' saved successfully"
    }


@app.get("/api/scenarios/list")
def list_scenarios():
    """Get list of all saved scenarios."""
    supabase = _get_supabase()
    result = supabase.table("scenarios").select(
        "id,scenario_name,description,created_at"
    ).order("created_at", desc=True).execute()
    return {
        "status": "ok",
        "scenarios": result.data or []
    }


@app.get("/api/scenarios/{scenario_id}")
def load_scenario(scenario_id: str):
    """Load a specific scenario by ID."""
    supabase = _get_supabase()
    result = supabase.table("scenarios").select(
        "id,scenario_name,description,scenario_data,created_at"
    ).eq("id", scenario_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {
        "status": "ok",
        "scenario": result.data
    }


@app.delete("/api/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str):
    """Delete a scenario by ID."""
    supabase = _get_supabase()
    supabase.table("scenarios").delete().eq("id", scenario_id).execute()
    return {
        "status": "ok",
        "message": "Scenario deleted successfully"
    }
