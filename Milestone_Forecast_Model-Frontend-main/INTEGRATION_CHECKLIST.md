# Scenario Save/Load - Integration Checklist

Complete these steps to activate the feature:

## Phase 1: Database Setup (5 min)
- [ ] Go to Supabase Dashboard
- [ ] Open SQL Editor
- [ ] Copy all SQL from `supabase_scenarios_migration.sql`
- [ ] Paste and execute
- [ ] Verify `scenarios` table appears in Tables list

## Phase 2: Environment Configuration (5 min)
- [ ] Get `SUPABASE_URL` from Supabase dashboard → Settings → General
- [ ] Get `SUPABASE_SERVICE_KEY` from Supabase dashboard → Settings → API
- [ ] Add to backend `.env`:
  ```
  SUPABASE_URL=your_url_here
  SUPABASE_SERVICE_KEY=your_key_here
  ```
- [ ] Verify frontend already has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

## Phase 3: Backend Dependencies (2 min)
- [ ] Terminal: `pip install supabase`
- [ ] Verify: `python -c "import supabase; print('OK')"`

## Phase 4: Frontend Restart (1 min)
- [ ] Stop dev server (if running)
- [ ] `npm run dev` from frontend directory
- [ ] Wait for compilation to complete

## Phase 5: Testing (5 min)
- [ ] Open app in browser
- [ ] Check topbar for Save/Load buttons ✓
- [ ] Fill in some ACE page inputs
- [ ] Click "Save Scenario"
- [ ] Enter scenario name: "Test Scenario"
- [ ] Click Save
- [ ] Should see success toast ✓
- [ ] Click "Load Scenario"
- [ ] Should see your saved scenario in list ✓
- [ ] Click on it
- [ ] Verify settings are restored ✓
- [ ] Delete the test scenario

## Phase 6: Production Consideration (Optional)
- [ ] Review SCENARIO_SETUP.md Security Notes section
- [ ] Consider adding authentication for production
- [ ] Test with multiple scenarios
- [ ] Test with large configurations

## Common Issues & Fixes

### Issue: "Supabase is not configured" error
**Solution**: 
- Check frontend .env has `VITE_SUPABASE_URL` set
- Check backend .env has `SUPABASE_URL` set
- Restart dev server after env changes

### Issue: Backend returns 500 error when saving
**Solution**:
- Verify `supabase` package installed: `pip install supabase`
- Check `SUPABASE_SERVICE_KEY` is correct
- Verify `scenarios` table exists in Supabase

### Issue: Can't see Save/Load buttons
**Solution**:
- Check App.jsx has ScenarioToolbar import
- Clear browser cache
- Restart dev server
- Check browser console for errors

### Issue: Scenario saves but doesn't load
**Solution**:
- Check browser console for error messages
- Verify Supabase RLS policies are set correctly
- Try deleting and recreating the scenarios table

## Files Modified/Created

✓ Frontend:
  - frontend/src/scenarioManager.js (NEW)
  - frontend/src/scenariotoolbar.jsx (CREATED)
  - frontend/src/App.jsx (MODIFIED - added import + ScenarioToolbar in Topbar)

✓ Backend:
  - backend/main.py (MODIFIED - added imports, model, endpoints)

✓ Database:
  - supabase_scenarios_migration.sql (NEW - run this in Supabase)

✓ Documentation:
  - SCENARIO_SETUP.md (setup guide)
  - IMPLEMENTATION_SUMMARY.md (overview)
  - INTEGRATION_CHECKLIST.md (this file)

## Support

Stuck? Check these:
1. SCENARIO_SETUP.md - Full documentation
2. IMPLEMENTATION_SUMMARY.md - Feature overview
3. Browser Developer Tools (F12) - Check console for errors
4. Backend logs - Check for API errors
5. Supabase Dashboard - Verify table exists and has data

Happy forecasting! 🚀
