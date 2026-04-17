# Scenario Feature - Quick Reference

## User Guide

### Saving a Scenario
1. **Configure your model** - Set up Model Setup and ACE pages as desired
2. **Click "Save Scenario"** - Top-left button with save icon
3. **Enter scenario name** - Give it a meaningful name (e.g., "Q1 Conservative")
4. **Optional: Add description** - Notes about this scenario
5. **Click Save** - Scenario is now stored in Supabase
6. **See success message** - Green toast confirmation

### Loading a Scenario
1. **Click "Load Scenario"** - Top-left button with folder icon
2. **Browse saved scenarios** - Shows name, description, and creation date
3. **Click a scenario** - Instantly restores all settings
4. **See confirmation** - Green toast shows scenario name
5. **All inputs restored** - Model Setup and ACE pages updated

### Deleting a Scenario
1. **Click "Load Scenario"** - Open scenario browser
2. **Find the scenario** - Scroll to see all scenarios
3. **Click "Delete" button** - Red delete button on the right
4. **Confirm deletion** - Confirm in the popup
5. **Scenario removed** - Disappears from list

---

## Technical Reference

### Data Stored in Each Scenario

```json
{
  "segments": [...],           // Primary/Secondary attributes
  "timeline": {...},           // Date range and granularity
  "aceConfig": {...},          // Feature toggles
  "scoringWeights": {...},     // Weights for calculations
  "endpoints": [...],          // Endpoint definitions
  "monteCarloParams": {...},   // Simulation settings
  "configuredMetrics": [...],  // Custom metrics
  "currentStep": 1             // UI state (which page)
}
```

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/scenarios/save` | Save new scenario |
| GET | `/api/scenarios/list` | Get all scenarios |
| GET | `/api/scenarios/{id}` | Load specific scenario |
| DELETE | `/api/scenarios/{id}` | Delete scenario |

### Environment Variables Required

**Frontend** (`.env`):
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxxx
```

**Backend** (`.env`):
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=xxxx
```

---

## Component Structure

```
App.jsx
├── Topbar()
│   └── ScenarioToolbar()
│       ├── Save button
│       └── Load button
│           ├── SaveScenarioModal
│           │   ├── Name input
│           │   └── Description textarea
│           └── LoadScenarioModal
│               ├── Scenarios list
│               └── Delete buttons

scenarioManager.js
├── saveScenario()
├── loadScenarioList()
├── loadScenario()
└── deleteScenario()
```

---

## Common Use Cases

### Use Case 1: Multiple Forecasts
Save different forecast scenarios:
- "Base Case 2024"
- "Optimistic 2024"
- "Pessimistic 2024"

Then switch between them for comparison.

### Use Case 2: Team Collaboration
Team members save their configurations:
- Each person has their own scenarios
- Can load and iterate on others' work
- Track changes by creation timestamp

### Use Case 3: Version Control
Save versions of your forecast:
- "v1_initial_estimate"
- "v2_after_peer_review"
- "v3_final_approved"

Then revert to any version quickly.

### Use Case 4: Client Presentations
Create presentation-ready scenarios:
- "Client_Conservative"
- "Client_Mid_Range"
- "Client_Optimistic"

Pre-configure and save, then load during demo.

---

## Limitations & Notes

✅ **Supported**:
- Save unlimited scenarios
- All model settings preserved
- Load any scenario instantly
- Delete unused scenarios
- Works offline (after load)

⚠️ **Current Limitations**:
- No authentication (anyone can see/delete)
- No scenario comparison view
- No scenario versioning/history
- No scenario sharing with specific users
- No scenario templates/cloning

**Future Enhancements**:
- User authentication and private scenarios
- Scenario comparison tool
- Export/import scenarios
- Scenario templates
- Batch scenario operations

---

## Troubleshooting

### Button Not Showing
- Check browser console (F12)
- Verify App.jsx has the import
- Restart dev server
- Clear browser cache

### Save Fails
- Check backend logs
- Verify Supabase connection
- Check SUPABASE_SERVICE_KEY is correct
- Ensure scenarios table exists

### Load Shows No Scenarios
- Database might be empty
- Check Supabase dashboard
- Verify table has correct name ("scenarios")
- Try saving a new scenario

### Settings Not Restoring
- Check browser console for errors
- Verify scenario_data isn't corrupted
- Try deleting and re-saving
- Check Supabase for invalid JSON

---

## Support Resources

📖 Full Docs: `SCENARIO_SETUP.md`
🚀 Quick Start: `INTEGRATION_CHECKLIST.md`
📋 Overview: `IMPLEMENTATION_SUMMARY.md`
💻 Code: `scenarioManager.js`, `scenariotoolbar.jsx`
🛠️ API: `backend/main.py`
🗄️ Database: `supabase_scenarios_migration.sql`
