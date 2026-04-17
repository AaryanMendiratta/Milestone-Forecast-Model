# Scenario Save/Load Functionality

## Overview

The Scenario Save/Load feature allows users to save their current configuration (Model Setup and ACE inputs) and load them later. All scenarios are stored in Supabase.

## Features

- **Save Scenarios**: Save all model settings and configurations with a custom name and description
- **Load Scenarios**: View all saved scenarios and restore them instantly
- **Delete Scenarios**: Remove scenarios you no longer need
- **Timestamp Tracking**: See when each scenario was created

## What Gets Saved

When you save a scenario, the following data is preserved:

- **Segments**: Primary and secondary attributes with tags
- **Timeline**: Date range and granularity settings
- **ACE Configuration**: Feature toggles (endpoint weighting, biomarker stratification, etc.)
- **Scoring Weights**: Efficacy, safety, market access, competitive intensity weights
- **Endpoints**: All endpoint definitions and metadata
- **Monte Carlo Parameters**: Simulation distribution settings
- **Configured Metrics**: Custom metrics configuration
- **Current Step**: Which page you were on

## Setup

### 1. Database Migration

Run the SQL migration in your Supabase dashboard to create the `scenarios` table:

```bash
# In Supabase SQL Editor, run:
supabase_scenarios_migration.sql
```

Or manually execute in Supabase SQL Editor:

```sql
CREATE TABLE scenarios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scenario_name TEXT NOT NULL,
  description TEXT,
  scenario_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);
```

### 2. Environment Variables

Ensure your `.env` file (backend) has:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

And your frontend `.env` has:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Install Supabase Python Client (Backend)

```bash
pip install supabase
```

## Usage

### Saving a Scenario

1. Configure your model setup and ACE settings as desired
2. Click the **Save Scenario** button in the top-left toolbar
3. Enter a scenario name and optional description
4. Click **Save**

### Loading a Scenario

1. Click the **Load Scenario** button in the top-left toolbar
2. Select a scenario from the list
3. All settings will be restored instantly

### Deleting a Scenario

1. Click **Load Scenario**
2. Find the scenario you want to delete
3. Click the **Delete** button next to it

## API Endpoints

### POST `/api/scenarios/save`
Save a new scenario to Supabase.

**Request:**
```json
{
  "scenario_name": "Q1 2024 Forecast",
  "description": "Initial forecast with conservative estimates",
  "scenario_data": {
    "segments": [...],
    "timeline": {...},
    "aceConfig": {...},
    "scoringWeights": {...},
    "endpoints": [...],
    "monteCarloParams": {...},
    "configuredMetrics": [...],
    "currentStep": 1
  }
}
```

**Response:**
```json
{
  "status": "ok",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Scenario 'Q1 2024 Forecast' saved successfully"
}
```

### GET `/api/scenarios/list`
Get list of all saved scenarios.

**Response:**
```json
{
  "status": "ok",
  "scenarios": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "scenario_name": "Q1 2024 Forecast",
      "description": "Initial forecast with conservative estimates",
      "created_at": "2024-04-15T10:30:00Z"
    }
  ]
}
```

### GET `/api/scenarios/{id}`
Load a specific scenario.

**Response:**
```json
{
  "status": "ok",
  "scenario": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "scenario_name": "Q1 2024 Forecast",
    "description": "Initial forecast with conservative estimates",
    "scenario_data": {...},
    "created_at": "2024-04-15T10:30:00Z"
  }
}
```

### DELETE `/api/scenarios/{id}`
Delete a scenario.

**Response:**
```json
{
  "status": "ok",
  "message": "Scenario deleted successfully"
}
```

## Frontend Components

### `scenarioManager.js`
Core API functions for scenario management:
- `saveScenario(name, description, data)`
- `loadScenarioList()`
- `loadScenario(id)`
- `deleteScenario(id)`

### `scenariotoolbar.jsx`
React components:
- `ScenarioToolbar()` - Main toolbar with Save/Load buttons
- `SaveScenarioModal()` - Modal for entering scenario details
- `LoadScenarioModal()` - Modal for selecting and loading scenarios

## Troubleshooting

### "Supabase is not configured"
- Check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in frontend `.env`
- Verify Supabase project is properly initialized

### Backend returns 500 error
- Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set in backend `.env`
- Check that the `scenarios` table exists in Supabase
- Verify the supabase Python package is installed: `pip install supabase`

### "Scenario not found"
- The scenario might have been deleted
- Try refreshing the Load Scenario modal

## Security Notes

The current implementation does **not require authentication**. All users can:
- View all scenarios
- Save new scenarios
- Delete any scenario

For production use, consider:
- Adding user authentication
- Implementing row-level security (RLS) policies based on user_id
- Adding user_id column to track ownership
