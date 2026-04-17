import { useState, useRef, useEffect } from 'react';
import { useApp, Modal, FormField, FormInput, FormSelect } from './App.jsx';
import MetricDependencies from './MetricDependencies.jsx';
import { toast } from 'sonner';

// ─── Add Segment Modal ──────────────────────────────────────────────

function AddSegmentModal({ open, onClose }) {
  const { addSegment } = useApp();
  const [name, setName] = useState('');
  const [type, setType] = useState('Primary Attribute');
  const handleAdd = () => {
    if (!name.trim()) { toast.error('Please enter a name'); return; }
    addSegment(name.trim(), type);
    toast(`"${name.trim()}" segment added`);
    setName(''); onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add New Segment" actions={<>
      <button onClick={onClose} className="inline-flex items-center gap-1.5 py-[9px] px-[18px] rounded-sm text-[13px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150">Cancel</button>
      <button onClick={handleAdd} className="inline-flex items-center gap-1.5 py-[9px] px-[18px] rounded-sm text-[13px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground shadow-red hover:opacity-90 transition-all duration-150">Add Segment</button>
    </>}>
      <FormField label="Attribute Name"><FormInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Product Line" autoFocus /></FormField>
      <FormField label="Type"><FormSelect value={type} onChange={e => setType(e.target.value)}><option>Primary Attribute</option><option>Secondary Attribute</option></FormSelect></FormField>
    </Modal>
  );
}

// ─── Add Sub-Segment Modal ──────────────────────────────────────────

function AddSubSegmentModal({ open, onClose, segmentId }) {
  const { addTag } = useApp();
  const [name, setName] = useState('');
  const handleAdd = () => {
    if (!name.trim()) { toast.error('Please enter a name'); return; }
    addTag(segmentId, name.trim());
    toast(`"${name.trim()}" added`);
    setName(''); onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add Sub-segment" actions={<>
      <button onClick={onClose} className="inline-flex items-center gap-1.5 py-[9px] px-[18px] rounded-sm text-[13px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150">Cancel</button>
      <button onClick={handleAdd} className="inline-flex items-center gap-1.5 py-[9px] px-[18px] rounded-sm text-[13px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground shadow-red hover:opacity-90 transition-all duration-150">Add</button>
    </>}>
      <FormField label="Sub-segment Name"><FormInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Asia Pacific" autoFocus /></FormField>
    </Modal>
  );
}

// ─── Date Picker Modal ──────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function DatePickerModal({ open, onClose, target, currentYear, onConfirm }) {
  const [year, setYear] = useState(currentYear);
  const handleConfirm = () => { onConfirm(year); toast(`Date updated to ${year}`); onClose(); };
  return (
    <Modal open={open} onClose={onClose} title={target === 'from' ? 'Set Start Year' : 'Set End Year'} actions={<>
      <button onClick={onClose} className="inline-flex items-center gap-1.5 py-[9px] px-[18px] rounded-sm text-[13px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150">Cancel</button>
      <button onClick={handleConfirm} className="inline-flex items-center gap-1.5 py-[9px] px-[18px] rounded-sm text-[13px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground shadow-red hover:opacity-90 transition-all duration-150">Set Year</button>
    </>}>
      <div>
        <FormField label="Year"><FormInput type="number" min={2020} max={2040} value={year} onChange={e => setYear(Number(e.target.value))} /></FormField>
      </div>
    </Modal>
  );
}

// ─── Stepper ────────────────────────────────────────────────────────

function Stepper({ currentStep }) {
  const steps = ['Segments', 'Timeline', 'Metrics', 'Review'];
  return (
    <div className="flex items-center gap-0 pb-0.5">
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === currentStep;
        const isDone = stepNum < currentStep;
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-[5px]">
              <div className={`w-[30px] h-[30px] rounded-full flex items-center justify-center font-bold text-xs transition-all duration-150 ${
                isActive ? 'bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(189,48,43,0.35)]' :
                isDone ? 'bg-primary-light text-primary border-2 border-primary' :
                'bg-surface-highest text-text-muted'
              }`}>{stepNum}</div>
              <div className={`text-[9px] font-bold whitespace-nowrap ${isActive || isDone ? 'text-primary' : 'text-text-muted'}`}>{label}</div>
            </div>
            {i < steps.length - 1 && <div className={`w-8 h-0.5 mb-5 ${isDone ? 'bg-primary' : 'bg-border-light'}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Segment Block ──────────────────────────────────────────────────

function SegmentBlock({ segment, onAddSub, onContextMenu }) {
  const { removeTag } = useApp();
  return (
    <div className="bg-card rounded-lg shadow-sm p-4">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="text-[9px] font-bold text-text-muted uppercase tracking-[1px]">{segment.type}</div>
          <div className="font-bold text-sm mt-0.5">{segment.name}</div>
        </div>
        <button onClick={onContextMenu} className="bg-transparent border-none cursor-pointer text-text-muted p-0.5">
          <span className="mi text-[18px]">more_vert</span>
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {segment.tags.map(tag => (
          <div key={tag} className="group inline-flex items-center gap-1.5 bg-surface-low border border-border-light py-2 px-3.5 rounded-[7px] text-[13px] font-medium hover:border-primary hover:bg-primary-light transition-all duration-150">
            {tag}
            <span className="mi text-[15px] opacity-0 group-hover:opacity-100 cursor-pointer text-text-muted group-hover:text-primary transition-opacity" onClick={() => removeTag(segment.id, tag)}>close</span>
          </div>
        ))}
        <button onClick={onAddSub} className="inline-flex items-center gap-[5px] border-2 border-dashed border-border py-[7px] px-3.5 rounded-[7px] text-xs font-bold text-text-muted cursor-pointer hover:border-primary hover:text-primary hover:bg-primary-light transition-all duration-150 bg-transparent">
          <span className="mi text-[13px]">add</span> Add Sub-segment
        </button>
      </div>
    </div>
  );
}

// ─── Context Menu ───────────────────────────────────────────────────

function ContextMenu({ x, y, onRename, onDuplicate, onDelete, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);
  return (
    <div ref={ref} className="fixed bg-card rounded-lg shadow-lg z-[300] min-w-[160px] overflow-hidden border border-border-light animate-modal-in" style={{ top: y + 4, left: x - 140 }}>
      <button onClick={onRename} className="w-full py-[10px] px-4 text-[13px] cursor-pointer flex items-center gap-[9px] hover:bg-surface-low transition-colors bg-transparent border-none text-left">
        <span className="mi text-[16px]">edit</span> Rename
      </button>
      <button onClick={onDuplicate} className="w-full py-[10px] px-4 text-[13px] cursor-pointer flex items-center gap-[9px] hover:bg-surface-low transition-colors bg-transparent border-none text-left">
        <span className="mi text-[16px]">content_copy</span> Duplicate
      </button>
      <button onClick={onDelete} className="w-full py-[10px] px-4 text-[13px] cursor-pointer flex items-center gap-[9px] text-primary hover:bg-primary-light transition-colors bg-transparent border-none text-left">
        <span className="mi text-[16px]">delete</span> Delete Segment
      </button>
    </div>
  );
}

// ─── Metrics ────────────────────────────────────────────────────────

// Metrics moved to MetricDependencies.jsx

// ─── Model Setup Page ───────────────────────────────────────────────

export default function ModelSetup() {
  const { segments, currentStep, advanceStep, timeline, setTimeline, renameSegment, duplicateSegment, removeSegment } = useApp();
  const [addSegOpen, setAddSegOpen] = useState(false);
  const [addSubOpen, setAddSubOpen] = useState(null);
  const [dateModalTarget, setDateModalTarget] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null);

  const totalTags = segments.reduce((sum, s) => sum + s.tags.length, 0);
  const dataPoints = totalTags * 12;
  const primarySegments = Math.max(1, Math.ceil(totalTags / 2));

  const handleSaveAndProceed = () => {
    advanceStep();
    toast(`Step ${currentStep} saved — proceeding to step ${currentStep + 1}`);
  };

  const handleReset = () => {
    if (confirm('Reset all configuration? This cannot be undone.')) {
      window.location.reload();
    }
  };

  return (
    <div className="h-full overflow-y-auto p-[26px_28px] flex flex-col gap-[22px]">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-primary mb-1">Model Setup</h1>
          <div>
            <div className="text-[13px] text-text-muted max-w-[520px] leading-relaxed">
            Define segment granularity, model timeline, metrics and calculation frameworks.</div>
          </div>
        </div>
      </div>

      {/* Segments + Timeline */}
      <div className="grid grid-cols-[1fr_320px] gap-[18px]">
        {/* Forecast Segments */}
        <div className="bg-surface-low rounded-lg border border-border-light p-5">
          <div className="flex flex-col gap-1 mb-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-text flex items-center gap-2">
                <span className="mi text-[18px] text-primary">account_tree</span> Forecast Segments
              </div>
              <button onClick={() => setAddSegOpen(true)} className="bg-transparent border-none text-primary text-xs font-bold cursor-pointer inline-flex items-center gap-1 py-1.5 px-2.5 rounded-sm hover:bg-primary-mid transition-all duration-150">
                <span className="mi text-sm">add_circle</span> Add New Segment
              </button>
            </div>
            <div className="text-[10px] text-text-muted leading-relaxed">
              Secondary attributes are nested under each primary attribute value.
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {segments.map(seg => (
              <SegmentBlock key={seg.id} segment={seg} onAddSub={() => setAddSubOpen(seg.id)}
                onContextMenu={(e) => { e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, segId: seg.id }); }} />
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-surface-low rounded-lg border border-border-light p-5 flex flex-col gap-[18px]">
          <div className="text-sm font-bold text-text flex items-center gap-2">
            <span className="mi text-[18px] text-primary">calendar_month</span> Forecast Timeline
          </div>
          <div>
            <div className="text-[9px] font-bold text-text-muted uppercase tracking-[1px] mb-2">Forecast Range</div>
            <div className="grid grid-cols-2 gap-2">
              {['from', 'to'].map(target => (
                <div key={target} onClick={() => setDateModalTarget(target)} className="bg-surface-highest rounded-sm p-[11px] cursor-pointer hover:border-primary transition-all duration-150">
                  <div className="text-[9px] text-text-soft mb-[3px]">{target === 'from' ? 'From' : 'To'}</div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[13px]">
                      {target === 'from' 
                        ? `${timeline.fromYear}`
                        : `${timeline.toYear}`
                      }
                    </span>
                    <span className="mi text-sm text-text-muted">event</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-auto"></div>
        </div>
      </div>

      {/* Metrics */}
      <MetricDependencies />

      {/* Modals */}
      <AddSegmentModal open={addSegOpen} onClose={() => setAddSegOpen(false)} />
      {addSubOpen && <AddSubSegmentModal open={!!addSubOpen} onClose={() => setAddSubOpen(null)} segmentId={addSubOpen} />}
      {dateModalTarget && (
        <DatePickerModal open={!!dateModalTarget} onClose={() => setDateModalTarget(null)} target={dateModalTarget}
          currentYear={dateModalTarget === 'from' ? timeline.fromYear : timeline.toYear}
          onConfirm={(year) => {
            if (dateModalTarget === 'from') setTimeline(prev => ({ ...prev, fromYear: year }));
            else setTimeline(prev => ({ ...prev, toYear: year }));
          }} />
      )}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y}
          onRename={() => { const n = prompt('New name:'); if (n) renameSegment(ctxMenu.segId, n); setCtxMenu(null); }}
          onDuplicate={() => { duplicateSegment(ctxMenu.segId); setCtxMenu(null); }}
          onDelete={() => { removeSegment(ctxMenu.segId); setCtxMenu(null); }}
          onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}
