import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useApp } from './App.jsx';
import {
  saveScenario,
  loadScenarioList,
  loadScenario,
  deleteScenario,
} from './scenarioManager.js';

function Modal({ open, onClose, title, children, actions }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-[rgba(15,18,24,0.4)] backdrop-blur-[3px] z-[200] flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card rounded-lg p-7 w-[520px] max-w-[95vw] shadow-lg animate-modal-in">
        <h2 className="text-[16px] font-extrabold text-text mb-[18px]">{title}</h2>
        {children}
        {actions && <div className="flex justify-end gap-[10px] mt-5">{actions}</div>}
      </div>
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div className="mb-4">
      <label className="text-[10px] font-bold text-text-muted uppercase tracking-[0.8px] block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function ScenarioToolbar() {
  const {
    currentStep, setCurrentStep,
    segments, setSegments,
    timeline, setTimeline,
    aceConfig, setAceConfig,
    scoringWeights, setScoringWeights,
    endpoints, setEndpoints,
    monteCarloParams, setMonteCarloParams,
    monteCarloOutputName, setMonteCarloOutputName,
    configuredMetrics, setConfiguredMetrics,
    metricData, setMetricData,
    metricsState, setMetricsState,
    selectedOutputIdx, setSelectedOutputIdx,
  } = useApp();

  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioDescription, setScenarioDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [scenarios, setScenarios] = useState([]);
  const [activeLoadId, setActiveLoadId] = useState(null);
  const [activeDeleteId, setActiveDeleteId] = useState(null);

  const scenarioPayload = useMemo(() => ({
    currentStep,
    segments,
    timeline,
    aceConfig,
    scoringWeights,
    endpoints,
    monteCarloParams,
    monteCarloOutputName,
    configuredMetrics,
    metricData,
    metricsState,
    selectedOutputIdx,
  }), [
    currentStep, segments, timeline, aceConfig, scoringWeights, endpoints,
    monteCarloParams, monteCarloOutputName, configuredMetrics, metricData,
    metricsState, selectedOutputIdx,
  ]);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await loadScenarioList();
      setScenarios(list);
    } catch (err) {
      toast.error(`Load failed: ${err.message}`);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (loadOpen) refreshList();
  }, [loadOpen, refreshList]);

  const applyScenarioData = useCallback((data) => {
    if (!data) return;
    if (data.currentStep !== undefined) setCurrentStep(data.currentStep);
    if (data.segments) setSegments(data.segments);
    if (data.timeline) setTimeline(data.timeline);
    if (data.aceConfig) setAceConfig(data.aceConfig);
    if (data.scoringWeights) setScoringWeights(data.scoringWeights);
    if (data.endpoints) setEndpoints(data.endpoints);
    if (data.monteCarloParams) setMonteCarloParams(data.monteCarloParams);
    if (data.monteCarloOutputName !== undefined) setMonteCarloOutputName(data.monteCarloOutputName);
    if (data.configuredMetrics) setConfiguredMetrics(data.configuredMetrics);
    if (data.metricData) setMetricData(data.metricData);
    if (data.metricsState) setMetricsState(data.metricsState);
    if (data.selectedOutputIdx !== undefined) setSelectedOutputIdx(data.selectedOutputIdx);
  }, [
    setCurrentStep, setSegments, setTimeline, setAceConfig, setScoringWeights,
    setEndpoints, setMonteCarloParams, setMonteCarloOutputName,
    setConfiguredMetrics, setMetricData, setMetricsState, setSelectedOutputIdx,
  ]);

  const handleSave = async () => {
    const trimmed = scenarioName.trim();
    if (!trimmed) {
      toast.error('Scenario name is required.');
      return;
    }
    setSaving(true);
    try {
      await saveScenario(trimmed, scenarioDescription.trim(), scenarioPayload);
      toast.success(`Scenario '${trimmed}' saved`);
      setScenarioName('');
      setScenarioDescription('');
      setSaveOpen(false);
      if (loadOpen) refreshList();
    } catch (err) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = async (id) => {
    setActiveLoadId(id);
    try {
      const scenario = await loadScenario(id);
      applyScenarioData(scenario?.scenario_data || {});
      toast.success(`Loaded "${scenario?.scenario_name || 'scenario'}"`);
      setLoadOpen(false);
    } catch (err) {
      toast.error(`Load failed: ${err.message}`);
    } finally {
      setActiveLoadId(null);
    }
  };

  const handleDelete = async (id) => {
    setActiveDeleteId(id);
    try {
      await deleteScenario(id);
      toast.success('Scenario deleted');
      refreshList();
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
    } finally {
      setActiveDeleteId(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSaveOpen(true)}
          className="inline-flex items-center gap-1.5 py-[7px] px-[12px] rounded-sm text-[12px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150"
          title="Save current scenario to database"
        >
          <span className="mi text-[15px]">save</span>
          Save Scenario
        </button>
        <button
          onClick={() => setLoadOpen(true)}
          className="inline-flex items-center gap-1.5 py-[7px] px-[12px] rounded-sm text-[12px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150"
          title="Load a saved scenario"
        >
          <span className="mi text-[15px]">folder_open</span>
          Load Scenario
        </button>
      </div>

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save Scenario"
        actions={(
          <>
            <button
              onClick={() => setSaveOpen(false)}
              className="py-[7px] px-[14px] rounded-sm text-[12px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="py-[7px] px-[16px] rounded-sm text-[12px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground shadow-red border-none disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      >
        <FormField label="Scenario Name">
          <input
            type="text"
            value={scenarioName}
            onChange={e => setScenarioName(e.target.value)}
            className="w-full h-9 px-3 rounded-sm text-[12px] font-semibold border-[1.5px] border-border bg-card text-text focus:outline-none focus:border-primary"
            placeholder="e.g. Base Case 2024"
          />
        </FormField>
        <FormField label="Description (Optional)">
          <textarea
            value={scenarioDescription}
            onChange={e => setScenarioDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-sm text-[12px] font-semibold border-[1.5px] border-border bg-card text-text focus:outline-none focus:border-primary resize-none"
            placeholder="Optional notes about this scenario..."
          />
        </FormField>
      </Modal>

      <Modal
        open={loadOpen}
        onClose={() => setLoadOpen(false)}
        title="Load Scenario"
        actions={(
          <button
            onClick={() => setLoadOpen(false)}
            className="py-[7px] px-[14px] rounded-sm text-[12px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150"
          >
            Close
          </button>
        )}
      >
        {loadingList ? (
          <div className="text-[12px] text-text-muted">Loading scenarios…</div>
        ) : scenarios.length === 0 ? (
          <div className="text-[12px] text-text-muted">No saved scenarios yet.</div>
        ) : (
          <div className="space-y-3 max-h-[360px] overflow-y-auto pr-2">
            {scenarios.map(s => (
              <div key={s.id} className="border border-border-light rounded-md p-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-bold text-text">{s.scenario_name}</div>
                  {s.description && <div className="text-[11px] text-text-muted mt-0.5">{s.description}</div>}
                  <div className="text-[10px] text-text-muted mt-1">{formatDate(s.created_at)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleLoad(s.id)}
                    disabled={activeLoadId === s.id}
                    className="py-[6px] px-[10px] rounded-sm text-[11px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground shadow-red border-none disabled:opacity-60"
                  >
                    {activeLoadId === s.id ? 'Loading…' : 'Load'}
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    disabled={activeDeleteId === s.id}
                    className="py-[6px] px-[10px] rounded-sm text-[11px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150 disabled:opacity-60"
                    title="Delete scenario"
                  >
                    <span className="mi text-[14px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

export default ScenarioToolbar;
