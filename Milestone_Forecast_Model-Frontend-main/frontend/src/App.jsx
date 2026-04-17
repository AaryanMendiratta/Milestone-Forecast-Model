import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Toaster } from 'sonner';
import { toast } from 'sonner';
import { saveToBackend as apiSave, loadFromBackend as apiLoad } from './api.js';
import ModelSetup from './ModelSetup.jsx';
import Ace from './Ace.jsx';
import Calculations from './Calculations.jsx';
import ExecutiveSummary from './ExecutiveSummary.jsx';
import MonteCarlo from './MonteCarlo.jsx';
import { ScenarioToolbar } from './scenariotoolbar.jsx';
import './App.css';

// ─── Types / Defaults ───────────────────────────────────────────────

const defaultSegments = [];

const defaultEndpoints = [];
const STORAGE_SCHEMA_VERSION = 'hard-reset-v1';

// ─── Context ────────────────────────────────────────────────────────

const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

function AppProvider({ children }) {
  // One-time hard reset for stale persisted data from older schemas.
  if (localStorage.getItem('milestone_storage_schema') !== STORAGE_SCHEMA_VERSION) {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('milestone_storage_schema', STORAGE_SCHEMA_VERSION);
  }

  // Helper: localStorage-only load (no defaultData rehydration)
  function load(key, fallback) {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return JSON.parse(saved);
    } catch {}
    return fallback;
  }
  function loadStr(key, fallback) {
    const saved = localStorage.getItem(key);
    if (saved !== null) return saved;
    return fallback;
  }

  // Initialize from localStorage or use defaults
  const [currentPage, setCurrentPage] = useState('model-setup');
  const [currentStep, setCurrentStep] = useState(() => {
    const saved = localStorage.getItem('milestone_currentStep');
    if (saved !== null) return parseInt(saved, 10);
    return 1;
  });
  const [segments, setSegments] = useState(() => load('milestone_segments', defaultSegments));
  const [timeline, setTimeline] = useState(() =>
    load('milestone_timeline', { fromMonth: 'Jan', fromYear: 2024, toMonth: 'Dec', toYear: 2029, granularity: 'monthly' })
  );
  const [aceConfig, setAceConfig] = useState(() =>
    load('milestone_aceConfig', { primaryEndpointWeighting: true, biomarkerStratification: true, placeboAdjusted: false, rweIntegration: true, safetyDampening: false })
  );
  const [scoringWeights, setScoringWeights] = useState(() =>
    load('milestone_scoringWeights', { efficacy: 65, safety: 20, marketAccess: 15, competitiveIntensity: 30 })
  );
  const [endpoints, setEndpoints] = useState(() => load('milestone_endpoints', defaultEndpoints));
  const [monteCarloParams, setMonteCarloParams] = useState(() =>
    load('milestone_monteCarloParams', { marketShareVariance: 12, launchTiming: 3, priceErosionRate: 8, patientPopGrowth: 4, distributionType: 'normal' })
  );
  const [monteCarloOutputName, setMonteCarloOutputName] = useState(() =>
    loadStr('milestone_monteCarloOutputName', '')
  );
  const [configuredMetrics, setConfiguredMetrics] = useState(() => {
    const rgbColorMap = {
      'population': 'rgb(244, 63, 94)',
      'market-share': 'rgb(168, 85, 247)',
      'treatment-rate': 'rgb(121, 49, 0)',
      'cost-per-patient': 'rgb(107, 114, 128)',
    };
    const raw = (() => {
      const saved = localStorage.getItem('milestone_configuredMetrics');
      if (saved !== null) return JSON.parse(saved);
      return [];
    })();
    // Migration: add rgbColor if missing
    const metrics = raw.map(m => ({
      ...m,
      rgbColor: m.rgbColor || rgbColorMap[m.id] || 'rgb(192, 0, 0)'
    }));
    localStorage.setItem('milestone_configuredMetrics', JSON.stringify(metrics));
    return metrics;
  });
  const [metricData, setMetricData] = useState(() => load('milestone_metricData', {}));
  const [metricsState, setMetricsState] = useState(() => {
    const raw = (() => {
      const saved = localStorage.getItem('milestone_metricsState');
      if (saved !== null) return JSON.parse(saved);
      return { metrics: [], formulaRows: [], metricConfigs: {} };
    })();
    // Migration: Convert old metric objects to metricId in formula items
    if (raw.formulaRows && raw.formulaRows.length > 0) {
      raw.formulaRows = raw.formulaRows.map(row => ({
        ...row,
        items: (row.items || []).map(item => {
          let metricId = item.metricId;
          if (!metricId && item.metric) {
            if (typeof item.metric === 'object' && item.metric.id) metricId = item.metric.id;
          }
          return { ...item, metricId, metric: undefined };
        })
      }));
      localStorage.setItem('milestone_metricsState', JSON.stringify(raw));
    }
    return raw;
  });
  const [selectedOutputIdx, setSelectedOutputIdx] = useState(() => {
    const saved = localStorage.getItem('milestone_selectedOutputIdx');
    if (saved !== null) return parseInt(saved, 10);
    return 0;
  });

  const addSegment = useCallback((name, type) => {
    setSegments(prev => [...prev, { id: `seg-${Date.now()}`, name, type, tags: [] }]);
  }, []);
  const removeSegment = useCallback((id) => {
    setSegments(prev => prev.filter(s => s.id !== id));
  }, []);
  const addTag = useCallback((segmentId, tag) => {
    setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, tags: [...s.tags, tag] } : s));
  }, []);
  const removeTag = useCallback((segmentId, tag) => {
    setSegments(prev => prev.map(s => s.id === segmentId ? { ...s, tags: s.tags.filter(t => t !== tag) } : s));
  }, []);
  const renameSegment = useCallback((id, name) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, name } : s));
  }, []);
  const duplicateSegment = useCallback((id) => {
    setSegments(prev => {
      const seg = prev.find(s => s.id === id);
      if (!seg) return prev;
      return [...prev, { ...seg, id: `seg-${Date.now()}`, name: `${seg.name} (Copy)` }];
    });
  }, []);
  const advanceStep = useCallback(() => {
    setCurrentStep(prev => Math.min(prev + 1, 4));
  }, []);

  // Persist currentStep
  useEffect(() => {
    localStorage.setItem('milestone_currentStep', currentStep.toString());
  }, [currentStep]);

  // Persist segments
  useEffect(() => {
    localStorage.setItem('milestone_segments', JSON.stringify(segments));
  }, [segments]);

  // Persist timeline
  useEffect(() => {
    localStorage.setItem('milestone_timeline', JSON.stringify(timeline));
  }, [timeline]);

  // Persist aceConfig
  useEffect(() => {
    localStorage.setItem('milestone_aceConfig', JSON.stringify(aceConfig));
  }, [aceConfig]);

  // Persist scoringWeights
  useEffect(() => {
    localStorage.setItem('milestone_scoringWeights', JSON.stringify(scoringWeights));
  }, [scoringWeights]);

  // Persist endpoints
  useEffect(() => {
    localStorage.setItem('milestone_endpoints', JSON.stringify(endpoints));
  }, [endpoints]);

  // Persist monteCarloParams
  useEffect(() => {
    localStorage.setItem('milestone_monteCarloParams', JSON.stringify(monteCarloParams));
  }, [monteCarloParams]);

  // Persist monteCarloOutputName
  useEffect(() => {
    localStorage.setItem('milestone_monteCarloOutputName', monteCarloOutputName);
  }, [monteCarloOutputName]);

  // Persist configuredMetrics
  useEffect(() => {
    localStorage.setItem('milestone_configuredMetrics', JSON.stringify(configuredMetrics));
  }, [configuredMetrics]);

  // Persist metricData
  useEffect(() => {
    localStorage.setItem('milestone_metricData', JSON.stringify(metricData));
  }, [metricData]);

  // Persist metricsState
  useEffect(() => {
    localStorage.setItem('milestone_metricsState', JSON.stringify(metricsState));
  }, [metricsState]);

  // Persist selectedOutputIdx
  useEffect(() => {
    localStorage.setItem('milestone_selectedOutputIdx', selectedOutputIdx.toString());
  }, [selectedOutputIdx]);

  // Export current state as a downloadable defaultData.js file
  const exportDefaults = useCallback(() => {
    const data = {
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
    };
    const fileContent = `// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT APP DATA — auto-generated on ${new Date().toISOString()}
//
// HOW TO UPDATE:
//   1. Configure everything in the app exactly as you want the defaults to look.
//   2. Click the "Save as Defaults" button in the top-right of the app.
//   3. A file named \`defaultData.js\` will be downloaded.
//   4. Replace this file (frontend/src/defaultData.js) with the downloaded file.
//   5. Redeploy — new users will now see your pre-configured data.
// ─────────────────────────────────────────────────────────────────────────────

const defaultData = ${JSON.stringify(data, null, 2)};

export default defaultData;
`;
    const blob = new Blob([fileContent], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'defaultData.js';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('defaultData.js downloaded — replace frontend/src/defaultData.js and redeploy');
  }, [currentStep, segments, timeline, aceConfig, scoringWeights, endpoints, monteCarloParams, monteCarloOutputName, configuredMetrics, metricData, metricsState, selectedOutputIdx]);

  // Save full state to Python backend
  const saveToBackend = useCallback(async () => {
    await apiSave({ segments, timeline, configuredMetrics, metricData, metricsState });
  }, [segments, timeline, configuredMetrics, metricData, metricsState]);

  // Load full state from Python backend and populate all React state
  const loadFromBackend = useCallback(async () => {
    const result = await apiLoad();
    if (result.status === 'no_data' || !result.data) return false;
    const d = result.data;
    if (d.segments) setSegments(d.segments);
    if (d.timeline) setTimeline(d.timeline);
    if (d.configuredMetrics) setConfiguredMetrics(d.configuredMetrics);
    if (d.metricData) setMetricData(d.metricData);
    if (d.metricsState) setMetricsState(d.metricsState);
    return true;
  }, []);

  // Function to reset all data
  const resetAllData = useCallback(() => {
    localStorage.clear();
    sessionStorage.clear();
    setCurrentPage('model-setup');
    setCurrentStep(1);
    setSegments([]);
    setTimeline({ fromMonth: 'Jan', fromYear: 2024, toMonth: 'Dec', toYear: 2029, granularity: 'monthly' });
    setAceConfig({ primaryEndpointWeighting: true, biomarkerStratification: true, placeboAdjusted: false, rweIntegration: true, safetyDampening: false });
    setScoringWeights({ efficacy: 65, safety: 20, marketAccess: 15, competitiveIntensity: 30 });
    setEndpoints([]);
    setMonteCarloParams({ marketShareVariance: 12, launchTiming: 3, priceErosionRate: 8, patientPopGrowth: 4, distributionType: 'normal' });
    setMonteCarloOutputName('');
    setConfiguredMetrics([]);
    setMetricData({});
    setMetricsState({ metrics: [], formulaRows: [], metricConfigs: {} });
    setSelectedOutputIdx(0);
  }, []);

  return (
    <AppContext.Provider value={{
      currentPage, setCurrentPage, currentStep, setCurrentStep, advanceStep,
      segments, setSegments, addSegment, removeSegment, addTag, removeTag, renameSegment, duplicateSegment,
      timeline, setTimeline, aceConfig, setAceConfig,
      scoringWeights, setScoringWeights, endpoints, setEndpoints,
      monteCarloParams, setMonteCarloParams,
      monteCarloOutputName, setMonteCarloOutputName,
      configuredMetrics, setConfiguredMetrics,
      metricData, setMetricData,
      metricsState, setMetricsState,
      selectedOutputIdx, setSelectedOutputIdx,
      resetAllData,
      saveToBackend, loadFromBackend, exportDefaults,
    }}>
      {children}
    </AppContext.Provider>
  );
}

// ─── Modal Component ────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, actions }) {
  const backdropRef = useRef(null);
  useEffect(() => {
    const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={backdropRef} className="fixed inset-0 bg-[rgba(15,18,24,0.4)] backdrop-blur-[3px] z-[200] flex items-center justify-center"
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}>
      <div className="bg-card rounded-lg p-7 w-[440px] max-w-[95vw] shadow-lg animate-modal-in">
        <h2 className="text-[16px] font-extrabold text-text mb-[18px]">{title}</h2>
        {children}
        {actions && <div className="flex justify-end gap-[10px] mt-5">{actions}</div>}
      </div>
    </div>
  );
}

export function FormField({ label, children }) {
  return (
    <div className="mb-4">
      <label className="text-[10px] font-bold text-text-muted uppercase tracking-[0.8px] block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export function FormInput({ className = '', ...props }) {
  return <input className={`w-full py-[10px] px-3 border-[1.5px] border-border rounded-sm text-[13px] outline-none transition-colors bg-card text-text focus:border-primary ${className}`} {...props} />;
}

export function FormSelect({ className = '', children, ...props }) {
  return <select className={`w-full py-[10px] px-3 border-[1.5px] border-border rounded-sm text-[13px] outline-none bg-card text-text cursor-pointer focus:border-primary ${className}`} {...props}>{children}</select>;
}

// ─── New Simulation Modal ───────────────────────────────────────────

function NewSimulationModal({ open, onClose }) {
  const [name, setName] = useState('');
  const [copyFrom, setCopyFrom] = useState('Blank');
  const handleCreate = () => {
    const simName = name.trim() || 'New Simulation';
    onClose(); setName('');
    toast(`Simulation "${simName}" created`);
  };
  return (
    <Modal open={open} onClose={onClose} title="New Simulation" actions={<>
      <button onClick={onClose} className="inline-flex items-center gap-1.5 py-[9px] px-[18px] rounded-sm text-[13px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150">Cancel</button>
      <button onClick={handleCreate} className="inline-flex items-center gap-1.5 py-[9px] px-[18px] rounded-sm text-[13px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground shadow-red hover:opacity-90 transition-all duration-150">Create</button>
    </>}>
      <FormField label="Simulation Name"><FormInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Base Case 2025" autoFocus /></FormField>
      <FormField label="Copy From"><FormSelect value={copyFrom} onChange={e => setCopyFrom(e.target.value)}><option>Blank</option><option>Current Configuration</option><option>Last Saved</option></FormSelect></FormField>
    </Modal>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────

const navItems = [
  { id: 'model-setup', icon: 'settings_input_component', label: 'Model Setup' },
  { id: 'ace', icon: 'auto_awesome', label: 'ACE' },
  { id: 'calculations', icon: 'calculate', label: 'Calculations' },
  { id: 'executive-summary', icon: 'summarize', label: 'Executive Summary' },
  { id: 'monte-carlo', icon: 'casino', label: 'Monte Carlo' },
];

function Sidebar() {
  const { currentPage, setCurrentPage } = useApp();
  return (
    <>
      <aside className="w-[270px] min-w-[270px] h-screen bg-surface-low border-r border-border-light flex flex-col p-[18px_12px] gap-5 overflow-y-auto flex-shrink-0 transition-all duration-150">
        <div className="flex flex-row items-center gap-2 px-1">
          <img src="/favicon.jpg" alt="Viscadia" className="h-[32px] w-[32px] object-contain flex-shrink-0 rounded-md" />
          <div className="text-[13px] font-bold leading-tight whitespace-nowrap" style={{ color: 'rgb(192,0,0)' }}>Milestone Forecast Model</div>
        </div>
        <div className="text-[9px] font-bold text-text-muted uppercase tracking-[1.2px] px-[10px]">Workspace</div>
        <nav className="flex flex-col gap-0.5 flex-1">
          {navItems.map(item => (
            <button key={item.id} onClick={() => setCurrentPage(item.id)}
              className={`flex items-center gap-[10px] py-[10px] px-3 rounded-md text-[13px] cursor-pointer transition-all duration-150 relative text-left ${
                currentPage === item.id ? 'bg-card text-primary font-bold shadow-sm translate-x-0.5' : 'text-text-soft hover:bg-black/[0.04] hover:text-text'
              }`}>
              {currentPage === item.id && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] bg-primary rounded-r-[3px]" />}
              <span className="mi text-[18px] flex-shrink-0">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

      </aside>
    </>
  );
}

// ─── Topbar ─────────────────────────────────────────────────────────

function Topbar() {
  const { exportDefaults } = useApp();
  return (
    <header className="flex items-center justify-between px-7 h-14 flex-shrink-0 bg-surface-low border-b border-border-light">
      <ScenarioToolbar />
      <button
        onClick={exportDefaults}
        className="inline-flex items-center gap-1.5 py-[7px] px-[14px] rounded-sm text-[12px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150"
        title="Download current state as defaultData.js to use as deployment defaults"
      >
        <span className="mi text-[15px]">download</span>
        Save as Defaults
      </button>
    </header>
  );
}

// ─── App Layout ─────────────────────────────────────────────────────

function AppLayout({ children }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
        <Topbar />
        <div className="flex-1 overflow-hidden relative">{children}</div>
      </div>
    </div>
  );
}

// ─── Page Router ────────────────────────────────────────────────────

const pages = {
  'model-setup': ModelSetup,
  'ace': Ace,
  'calculations': Calculations,
  'executive-summary': ExecutiveSummary,
  'monte-carlo': MonteCarlo,
};

function Index() {
  const { currentPage } = useApp();
  const PageComponent = pages[currentPage];
  return <AppLayout><PageComponent /></AppLayout>;
}

// ─── App ────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AppProvider>
      <Toaster />
      <Index />
    </AppProvider>
  );
}
