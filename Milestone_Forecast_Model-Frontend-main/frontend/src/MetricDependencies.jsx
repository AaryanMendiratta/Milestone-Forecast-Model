import { useState, useEffect } from 'react';
import { useApp, Modal, FormField } from './App.jsx';
import { toast } from 'sonner';

const OPERATORS_LIST = [
  { id: 'add',           icon: 'add',        name: 'Add',           symbol: '+' },
  { id: 'subtract',      icon: 'remove',     name: 'Subtract',      symbol: '−' },
  { id: 'multiply',      icon: 'close',      name: 'Multiply',      symbol: '×' },
  { id: 'divide',        icon: 'division',   name: 'Divide',        symbol: '÷' },
  { id: 'reverse-array', icon: 'swap_horiz', name: 'Reverse Array', symbol: '⊛' },
  { id: 'equal',         icon: 'equals',     name: 'Equal',         symbol: '=' },
];

// Metric Detail Modal
function MetricDetailModal({ open, onClose, metric, segments, onSaveConfig, selectedSegmentIds = [] }) {
  const [selectedAttributes, setSelectedAttributes] = useState(() => {
    // Initialize with previously selected segment IDs
    const initial = {};
    selectedSegmentIds.forEach(id => {
      initial[id] = true;
    });
    return initial;
  });

  // Re-sync checkbox state whenever the modal opens or selectedSegmentIds changes
  useEffect(() => {
    if (open) {
      const initial = {};
      selectedSegmentIds.forEach(id => {
        initial[id] = true;
      });
      setSelectedAttributes(initial);
    }
  }, [open, selectedSegmentIds]);

  const primarySegs = segments.filter(s => s.type === 'Primary Attribute');
  const secondarySegs = segments.filter(s => s.type === 'Secondary Attribute');

  const handleAttributeToggle = (segId) => {
    setSelectedAttributes(prev => ({
      ...prev,
      [segId]: !prev[segId]
    }));
  };

  const handleConfirm = () => {
    const selectedSegmentIds = Object.keys(selectedAttributes).filter(k => selectedAttributes[k]);
    onSaveConfig(metric.id, {
      granularity: 'annual',
      selectedSegments: selectedSegmentIds,
    });
    toast.success(`Metric "${metric.name}" configured successfully`);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Configure: ${metric.name}`}
      actions={
        <>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 py-[9px] px-[18px] rounded-sm text-[13px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="inline-flex items-center gap-1.5 py-[9px] px-[18px] rounded-sm text-[13px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground shadow-red hover:opacity-90 transition-all duration-150"
          >
            Apply
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.8px] mb-3">
            Segment Attributes (Select Primary, Secondary, or Both)
          </div>

          {primarySegs.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-bold text-primary mb-2">Primary Attributes</div>
              <div className="flex flex-col gap-2 pl-3 border-l-2 border-primary-light">
                {primarySegs.map(seg => (
                  <div key={seg.id}>
                    <label className="flex items-center gap-2 cursor-pointer mb-1">
                      <input
                        type="checkbox"
                        checked={selectedAttributes[seg.id] || false}
                        onChange={() => handleAttributeToggle(seg.id)}
                        className="w-4 h-4 rounded cursor-pointer"
                      />
                      <span className="text-xs font-semibold text-text">{seg.name}</span>
                    </label>
                    {seg.tags && seg.tags.length > 0 && (
                      <div className="ml-5 flex flex-wrap gap-1">
                        {seg.tags.map(tag => (
                          <span key={tag} className="inline-block px-2 py-0.5 bg-primary-light text-primary text-[9px] rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {secondarySegs.length > 0 && (
            <div>
              <div className="text-xs font-bold text-secondary mb-2">Secondary Attributes</div>
              <div className="flex flex-col gap-2 pl-3 border-l-2 border-secondary-light">
                {secondarySegs.map(seg => (
                  <div key={seg.id}>
                    <label className="flex items-center gap-2 cursor-pointer mb-1">
                      <input
                        type="checkbox"
                        checked={selectedAttributes[seg.id] || false}
                        onChange={() => handleAttributeToggle(seg.id)}
                        className="w-4 h-4 rounded cursor-pointer"
                      />
                      <span className="text-xs font-semibold text-text">{seg.name}</span>
                    </label>
                    {seg.tags && seg.tags.length > 0 && (
                      <div className="ml-5 flex flex-wrap gap-1">
                        {seg.tags.map(tag => (
                          <span key={tag} className="inline-block px-2 py-0.5 bg-secondary-light text-secondary text-[9px] rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {primarySegs.length === 0 && secondarySegs.length === 0 && (
            <div className="text-xs text-text-muted italic">No segments added in Forecast Segments</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Metric Configuration Component
function MetricConfig({ metric, metricConfigs, onConfigChange, segments, onOpenAttributeModal, onDelete, onRename }) {
  const config = metricConfigs[metric.id] || { inputType: '', segmentAttribute: '', valueType: '', inputValue: '', inputError: '', selectedSegments: [] };
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(metric.name);

  const handleRenameConfirm = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== metric.name) onRename(metric.id, trimmed);
    setIsRenaming(false);
  };
  // Validate percentage input
  const validatePercentage = (value) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      return { isValid: false, error: 'Please enter a valid number' };
    }
    if (numValue > 100) {
      return { isValid: false, error: 'Percentage cannot exceed 100%' };
    }
    if (numValue < 0) {
      return { isValid: false, error: 'Percentage cannot be negative' };
    }
    return { isValid: true, error: '' };
  };

  const handleInputValueChange = (value) => {
    const newConfig = { ...config, inputValue: value };
    
    if (config.valueType === 'percentage') {
      const validation = validatePercentage(value);
      newConfig.inputError = validation.error;
    } else {
      newConfig.inputError = '';
    }
    
    onConfigChange(metric.id, newConfig);
  };

  return (
    <div className="bg-card rounded-lg border border-border-light p-4 mb-4">
      <div className="flex items-start gap-2 mb-4">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${metric.bg} border ${metric.borderColor}`}>
          <span className={`mi text-[14px] ${metric.color}`}>{metric.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameConfirm(); if (e.key === 'Escape') setIsRenaming(false); }}
                className="text-[12px] font-bold border border-primary rounded px-1.5 py-0.5 outline-none bg-card text-text w-full"
              />
              <button onClick={handleRenameConfirm} className="text-primary hover:text-primary-dark ml-0.5" title="Confirm"><span className="mi text-[14px]">check</span></button>
              <button onClick={() => setIsRenaming(false)} className="text-text-muted hover:text-text" title="Cancel"><span className="mi text-[14px]">close</span></button>
            </div>
          ) : (
            <div className="flex items-center gap-1 group">
              <div className="text-[12px] font-bold text-text">{metric.name}</div>
              <button
                onClick={() => { setRenameValue(metric.name); setIsRenaming(true); }}
                title="Rename"
                className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded hover:bg-surface-mid text-text-muted hover:text-primary"
              >
                <span className="mi text-[12px]">edit</span>
              </button>
            </div>
          )}
          <div className="text-[9px] text-text-muted">{metric.desc}</div>
        </div>
        <button
          onClick={() => onDelete(metric.id, metric.name)}
          title="Delete metric"
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors"
        >
          <span className="mi text-[16px]">delete</span>
        </button>
      </div>

      {/* Horizontal Layout for All Inputs */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* Input Type Dropdown */}
        <div>
          <label className="text-[10px] font-bold text-text-muted uppercase tracking-[0.5px] block mb-1.5">Input Type</label>
          <select
            value={config.inputType}
            onChange={(e) => {
              const newType = e.target.value;
              // Reset type-specific fields when switching input type to avoid stale data
              const cleaned = {
                granularity: config.granularity,
                selectedSegments: config.selectedSegments,
                inputType: newType,
                valueType: config.valueType,
                inputValue: '',
                inputError: '',
              };
              if (newType === 'uptake-curve') {
                cleaned.peakValue = '';
                cleaned.segmentPeakValues = {};
                cleaned.segmentMonthsToPeak = {};
                cleaned.segmentDiffusionConstant = {};
              }
              onConfigChange(metric.id, cleaned);
            }}
            className="w-full px-3 py-2 border border-border rounded-sm text-[11px] font-semibold bg-card text-text outline-none focus:border-primary"
          >
            <option value="">Select input type</option>
            <option value="single-input">Single Input</option>
            <option value="annual">Annual</option>
            <option value="uptake-curve">Uptake Curve</option>
          </select>
        </div>

        {/* Value Type Dropdown - Only Show if NOT Uptake Curve */}
        {config.inputType !== 'uptake-curve' && (
          <div>
            <label className="text-[10px] font-bold text-text-muted uppercase tracking-[0.5px] block mb-1.5">Value Type</label>
            <select
              value={config.valueType}
              onChange={(e) => onConfigChange(metric.id, { ...config, valueType: e.target.value, inputValue: '', inputError: '' })}
              className="w-full px-3 py-2 border border-border rounded-sm text-[11px] font-semibold bg-card text-text outline-none focus:border-primary"
            >
              <option value="">Select value type</option>
              <option value="numeric">Numeric</option>
              <option value="percentage">Percentage (%)</option>
            </select>
          </div>
        )}

        {/* Segment Attribute Button */}
        <div>
          <label className="text-[10px] font-bold text-text-muted uppercase tracking-[0.5px] block mb-1.5">Segment Attributes</label>
          <button
            onClick={() => onOpenAttributeModal(metric)}
            className="w-full px-3 py-2 border border-border rounded-sm text-[11px] font-semibold bg-card text-text outline-none focus:border-primary hover:border-primary transition-colors text-left flex justify-between items-center"
          >
            <span>{config.selectedSegments && config.selectedSegments.length > 0 ? `${config.selectedSegments.length} selected` : 'Select...'}</span>
            <span className="mi text-[14px]">edit</span>
          </button>
        </div>
      </div>

      {/* Selected Attributes Tags */}
      {config.selectedSegments && config.selectedSegments.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1">
          {segments
            .filter(s => config.selectedSegments.includes(s.id))
            .map(s => (
              <span key={s.id} className={`inline-block px-2 py-0.5 text-[9px] rounded ${
                s.type === 'Primary Attribute' 
                  ? 'bg-primary-light text-primary' 
                  : 'bg-secondary-light text-secondary'
              }`}>
                {s.name}
              </span>
            ))}
        </div>
      )}

      {/* Single Input: values are entered per-segment on the ACE page */}
      {config.inputType === 'single-input' && (
        <div className="mt-2 px-3 py-2 bg-surface-low rounded-sm border border-border-light text-[10px] text-text-muted flex items-center gap-1.5">
          <span className="mi text-[13px]">info</span>
          Single input values (one per segment) are entered on the ACE page in the same layout as Annual input.
        </div>
      )}

      {/* Uptake Curve: params are entered on the ACE page */}
      {config.inputType === 'uptake-curve' && (
        <div className="mt-2 px-3 py-2 bg-surface-low rounded-sm border border-border-light text-[10px] text-text-muted flex items-center gap-1.5">
          <span className="mi text-[13px]">info</span>
          Uptake curve parameters (Months to Peak, Diffusion Constant, Peak Value) are configured on the ACE page.
        </div>
      )}
    </div>
  );
}

// Formula Row Component
function FormulaRow({ rowId, formulaData, onMetricChange, onOperatorChange, onOutputNameChange, onRemove, availableMetrics, operatorsList }) {
  const items = formulaData.items || [];
  const isComplete = formulaData.isComplete || false;

  return (
    <div className="bg-card rounded-lg border border-border-light p-4 mb-3">
      <div className="flex items-center gap-2 flex-nowrap overflow-x-auto">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2">
            {/* Input/Output Metric Dropdown */}
            <select
              value={item.metricId || ''}
              onChange={(e) => {
                const metric = availableMetrics.find(m => m.id === e.target.value);
                onMetricChange(rowId, idx, metric);
              }}
              className="px-3 py-2 border border-border rounded-sm text-[11px] font-bold bg-card text-text outline-none focus:border-primary"
            >
              <option value="">Select metric</option>
              {availableMetrics.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>

            {/* Operator Dropdown (except after last item if it's output) */}
            {idx < items.length - 1 && (
              <select
                value={item.operator || ''}
                onChange={(e) => onOperatorChange(rowId, idx, e.target.value)}
                className="px-3 py-2 border border-border rounded-sm text-[11px] font-bold bg-card text-text outline-none focus:border-primary"
              >
                <option value="">Operator</option>
                {operatorsList.filter(op => op.id !== 'equal').map(op => (
                  <option key={op.id} value={op.id}>{op.symbol} {op.name}</option>
                ))}
              </select>
            )}

            {/* Equal operator and output name input */}
            {idx === items.length - 1 && (
              <>
                <select
                  value={item.operator || ''}
                  onChange={(e) => onOperatorChange(rowId, idx, e.target.value)}
                  className="px-3 py-2 border border-border rounded-sm text-[11px] font-bold bg-card text-text outline-none focus:border-primary"
                >
                  <option value="">Operator</option>
                  {operatorsList.map(op => (
                    <option key={op.id} value={op.id}>{op.symbol} {op.name}</option>
                  ))}
                </select>

                {item.operator === 'equal' && (
                  <input
                    type="text"
                    value={item.outputName || ''}
                    onChange={(e) => onOutputNameChange(rowId, e.target.value)}
                    placeholder="Output name"
                    className="px-3 py-2 border border-border rounded-sm text-[11px] font-bold bg-card text-text outline-none focus:border-primary min-w-[150px]"
                  />
                )}
              </>
            )}
          </div>
        ))}

        {/* Add Input Button */}
        {items.length > 0 && items[items.length - 1].operator !== 'equal' && (
          <button
            onClick={() => onMetricChange(rowId, items.length, null)}
            className="px-3 py-2 text-xs font-bold text-primary border border-dashed border-primary rounded-sm hover:bg-primary-light transition-colors"
          >
            + Add Input
          </button>
        )}

        {/* Remove Row Button */}
        <button
          onClick={() => onRemove(rowId)}
          className="ml-auto px-3 py-2 text-xs font-bold text-primary hover:text-primary-dark transition-colors"
          title="Remove row"
        >
          <span className="mi text-[16px]">close</span>
        </button>
      </div>

      {/* Reverse-array usage note */}
      {items.some(item => item.operator === 'reverse-array') && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800 leading-snug">
          <span className="mi text-[15px] flex-shrink-0 mt-px">info</span>
          <span>
            <strong>Reverse Array (⊛):</strong> For reverse array functionality, the <strong>first input</strong> is the metric on which this operation is applied.
          </span>
        </div>
      )}
    </div>
  );
}



export default function MetricDependencies() {
  const { segments, setConfiguredMetrics, metricsState, setMetricsState, metricData, setMetricData } = useApp();
  
  // Initialize from context only (no hardcoded fallback metrics)
  const [metrics, setMetrics] = useState(() => {
    if (metricsState.metrics && metricsState.metrics.length > 0) {
      return metricsState.metrics;
    }
    return [];
  });
  const [metricConfigs, setMetricConfigs] = useState(() => metricsState.metricConfigs || {});
  const [formulaRows, setFormulaRows] = useState(() => {
    const saved = metricsState.formulaRows;
    return saved && saved.length > 0 ? saved : [
      { id: `row-${Date.now()}`, items: [{ metricId: null, operator: null, outputName: '' }], isComplete: false }
    ];
  });
  
  const [draggedItem, setDraggedItem] = useState(null);
  const [showAddMetric, setShowAddMetric] = useState(false);
  const [newMetricName, setNewMetricName] = useState('');
  const [selectedMetricDetail, setSelectedMetricDetail] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Persist metrics and formula rows to context whenever they change
  useEffect(() => {
    console.log('[MetricDependencies] Saving to metricsState - formulaRows:', formulaRows);
    setMetricsState({
      metrics,
      metricConfigs,
      formulaRows,
    });
  }, [metrics, metricConfigs, formulaRows, setMetricsState]);

  const handleSaveMetricConfig = (metricId, config) => {
    setMetricConfigs(prev => {
      const prevConfig = prev[metricId] || {};
      // When inputType changes, do a full replace so stale type-specific fields
      // (segmentPeakValues, monthsToPeak, etc.) from the old type don't persist
      if (config.inputType && config.inputType !== prevConfig.inputType) {
        // Also clear the is-uptake-curve flag from metricData when switching away from uptake-curve
        if (prevConfig.inputType === 'uptake-curve' && config.inputType !== 'uptake-curve') {
          setMetricData(md => ({ ...md, [`${metricId}--is-uptake-curve`]: false }));
        }
        return { ...prev, [metricId]: config };
      }
      return { ...prev, [metricId]: { ...prevConfig, ...config } };
    });
  };

  const handleOpenAttributeModal = (metric) => {
    setSelectedMetricDetail(metric);
    setDetailModalOpen(true);
  };

  const handleDragStart = (e, item, type) => {
    setDraggedItem({ item, type });
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleAddMetric = () => {
    if (!newMetricName.trim()) {
      toast.error('Please enter a metric name');
      return;
    }
    const newMetric = {
      id: `metric-${Date.now()}`,
      name: newMetricName,
      desc: 'Custom metric',
      icon: 'analytics',
      color: 'text-primary',
      bg: 'bg-primary-mid',
      borderColor: 'border-l-primary',
    };
    setMetrics([...metrics, newMetric]);
    setNewMetricName('');
    setShowAddMetric(false);
    toast.success(`Metric "${newMetricName}" added`);
  };

  const handleDeleteMetric = (metricId, metricName) => {
    setMetrics(prev => prev.filter(m => m.id !== metricId));
    setMetricConfigs(prev => {
      const updated = { ...prev };
      delete updated[metricId];
      return updated;
    });
    toast.success(`Metric "${metricName}" deleted`);
  };

  const handleRenameMetric = (metricId, newName) => {
    setMetrics(prev => prev.map(m => m.id === metricId ? { ...m, name: newName } : m));
    toast.success(`Metric renamed to "${newName}"`);
  };

  const handleMetricClick = (metric) => {
    setSelectedMetricDetail(metric);
    setDetailModalOpen(true);
  };

  // Formula Row Handlers
  const handleMetricChange = (rowId, itemIndex, metric) => {
    setFormulaRows(prev => prev.map(row => {
      if (row.id === rowId) {
        const newItems = [...row.items];
        if (!newItems[itemIndex]) {
          newItems[itemIndex] = { metricId: null, operator: null, outputName: '' };
        }
        // Store only the metric ID to avoid serialization issues
        newItems[itemIndex] = { ...newItems[itemIndex], metricId: metric?.id };
        return { ...row, items: newItems };
      }
      return row;
    }));
  };

  const handleOperatorChange = (rowId, itemIndex, operatorId) => {
    setFormulaRows(prev => prev.map(row => {
      if (row.id === rowId) {
        const newItems = [...row.items];
        if (!newItems[itemIndex]) {
          newItems[itemIndex] = { metricId: null, operator: null, outputName: '' };
        }
        newItems[itemIndex] = { ...newItems[itemIndex], operator: operatorId };
        
        // isComplete is true only if the last item has operator 'equal' AND has an outputName
        const lastItem = newItems[newItems.length - 1];
        const isComplete = lastItem.operator === 'equal' && !!lastItem.outputName;
        return { ...row, items: newItems, isComplete };
      }
      return row;
    }));
  };

  const handleOutputNameChange = (rowId, outputName) => {
    setFormulaRows(prev => prev.map(row => {
      if (row.id === rowId) {
        const newItems = [...row.items];
        if (newItems[newItems.length - 1]) {
          newItems[newItems.length - 1] = { ...newItems[newItems.length - 1], outputName };
        }
        // isComplete is true only if the last item has operator 'equal' AND has an outputName
        const lastItem = newItems[newItems.length - 1];
        const isComplete = lastItem.operator === 'equal' && !!outputName;
        return { ...row, items: newItems, isComplete };
      }
      return row;
    }));
  };

  const handleRemoveRow = (rowId) => {
    setFormulaRows(prev => prev.filter(row => row.id !== rowId));
    toast('Formula row removed');
  };

  const handleAddFormulaRow = () => {
    setFormulaRows(prev => [...prev, {
      id: `row-${Date.now()}`,
      items: [{ metricId: null, operator: null, outputName: '' }],
      isComplete: false
    }]);
  };

  const getAvailableMetrics = () => {
    const baseMetrics = metrics;
    const outputMetrics = formulaRows
      .filter(row => row.isComplete && row.items[row.items.length - 1]?.outputName)
      .map((row, idx) => ({
        id: `output-${row.id}`,
        name: row.items[row.items.length - 1].outputName,
        desc: 'Formula output',
        icon: 'assessment',
        color: 'text-secondary',
        bg: 'bg-secondary/10',
        borderColor: 'border-l-secondary',
      }));
    return [...baseMetrics, ...outputMetrics];
  };

  return (
    <div className="bg-surface-low rounded-lg border border-border-light p-4">
      {/* Inputs Definition Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-text flex items-center gap-2">
            <span className="mi text-[16px] text-primary">bar_chart</span> Inputs Definition
          </div>
          <button
            onClick={() => setShowAddMetric(!showAddMetric)}
            className="text-xs font-bold text-primary hover:text-primary-dark transition-colors"
          >
            + Add
          </button>
        </div>

        {showAddMetric && (
          <div className="bg-card rounded-lg p-3 mb-3 border border-primary-light">
            <input
              type="text"
              value={newMetricName}
              onChange={(e) => setNewMetricName(e.target.value)}
              placeholder="Metric name..."
              className="w-full py-2 px-2 border border-border rounded text-xs mb-2 outline-none focus:border-primary"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddMetric}
                className="flex-1 py-1.5 px-2 bg-primary text-primary-foreground text-xs font-bold rounded hover:opacity-90"
              >
                Add
              </button>
              <button
                onClick={() => setShowAddMetric(false)}
                className="flex-1 py-1.5 px-2 bg-surface-highest text-text-soft text-xs font-bold rounded hover:bg-surface-mid"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {metrics.map(metric => (
            <MetricConfig
              key={metric.id}
              metric={metric}
              metricConfigs={metricConfigs}
              segments={segments}
              onConfigChange={handleSaveMetricConfig}
              onOpenAttributeModal={handleOpenAttributeModal}
              onDelete={handleDeleteMetric}
              onRename={handleRenameMetric}
            />
          ))}
        </div>
      </div>

      {/* Formula Builder Section */}
      <div>
        <div className="text-xs font-bold text-text flex items-center gap-2 mb-3">
          <span className="mi text-[16px] text-primary">hub</span> Formula Builder
        </div>

        <div className="bg-card rounded-lg border border-border-light p-4 mb-3">
          <div className="text-[9px] text-text-muted mb-3">
            Use dropdowns to build formulas. Format: Input → Operator → Input → ... → = → Output name
          </div>

          {formulaRows.map((row) => (
            <FormulaRow
              key={row.id}
              rowId={row.id}
              formulaData={row}
              onMetricChange={handleMetricChange}
              onOperatorChange={handleOperatorChange}
              onOutputNameChange={handleOutputNameChange}
              onRemove={handleRemoveRow}
              availableMetrics={getAvailableMetrics()}
              operatorsList={OPERATORS_LIST}
            />
          ))}

          <button
            onClick={handleAddFormulaRow}
            className="py-2 px-3 text-xs font-bold text-primary hover:text-primary-dark transition-colors border border-dashed border-primary rounded-lg w-full"
          >
            + Add Formula Row
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-between items-center mt-4 pt-3 border-t border-border-light">
        <button
          onClick={() => {
            setFormulaRows([
              { id: `row-${Date.now()}`, items: [{ metricId: null, operator: null, outputName: '' }], isComplete: false }
            ]);
            toast('Formulas reset');
          }}
          className="inline-flex items-center gap-1.5 py-[8px] px-[16px] rounded-sm text-[12px] font-bold border-[1.5px] border-border text-text-soft bg-transparent hover:border-primary hover:text-primary transition-all duration-150"
        >
          <span className="mi text-[14px]">restart_alt</span> Reset
        </button>
        <button
          onClick={() => {
            // Validate all metrics - check for percentage errors
            const metricsWithErrors = Object.entries(metricConfigs).filter(
              ([_, config]) => config.inputError
            );

            if (metricsWithErrors.length > 0) {
              toast.error(`Please fix ${metricsWithErrors.length} metric validation error(s) before proceeding`);
              return;
            }

            const metricsConfig = metrics.map(m => ({
              id: m.id,
              name: m.name,
              icon: m.icon,
              color: m.color,
              rgbColor: m.rgbColor,
              granularity: metricConfigs[m.id]?.granularity || 'monthly',
              selectedSegments: metricConfigs[m.id]?.selectedSegments || [],
            }));
            setConfiguredMetrics(metricsConfig);
            toast.success('Metrics saved!');
          }}
          className="inline-flex items-center gap-1.5 py-[8px] px-[16px] rounded-sm text-[12px] font-bold bg-gradient-to-br from-primary to-primary-dark text-primary-foreground shadow-red hover:opacity-90 transition-all duration-150 border-none cursor-pointer"
        >
          <span className="mi text-[14px]">check_circle</span> Create Model
        </button>
      </div>

      {/* Metric Detail Modal */}
      {selectedMetricDetail && (
        <MetricDetailModal
          open={detailModalOpen}
          onClose={() => {
            setDetailModalOpen(false);
            setSelectedMetricDetail(null);
          }}
          metric={selectedMetricDetail}
          segments={segments}
          selectedSegmentIds={metricConfigs[selectedMetricDetail.id]?.selectedSegments || []}
          onSaveConfig={handleSaveMetricConfig}
        />
      )}
    </div>
  );
}
