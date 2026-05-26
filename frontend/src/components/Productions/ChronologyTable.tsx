'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaArrowUpRightFromSquare,
  FaCheck,
  FaListCheck,
  FaRotateLeft,
  FaTrash,
  FaXmark,
} from 'react-icons/fa6';
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_NAMES,
  type HighlightColor,
  isHighlightColor,
} from './chronologyHighlights';

interface ChronologyEntry {
  /** @deprecated use sourceUrl. Still accepted for backward compatibility. */
  source?: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  date: string;
  description: string;
  details?: string | null;
  sourceTraceId?: string;
  sourceEdgeId?: string;
  highlight?: HighlightColor | null;
}

interface ColumnWidths {
  source?: number;
  date?: number;
  description?: number;
  details?: number;
}

interface ChronologyData {
  entries: ChronologyEntry[];
  columnWidths?: ColumnWidths;
}

interface ChronologyTableProps {
  data: ChronologyData;
  onColumnResize?: (widths: ColumnWidths) => void;
  onEntryEdit?: (index: number, entry: ChronologyEntry) => void;
  onRowHighlight?: (indexes: number[], color: HighlightColor | null) => void;
  onRowsDelete?: (indexes: number[]) => void;
}

// Mirror of backend default in chronology.ts. Keep in sync.
const DEFAULT_WIDTHS: Required<ColumnWidths> = {
  source: 18,
  date: 14,
  description: 40,
  details: 28,
};
const COL_KEYS: (keyof ColumnWidths)[] = ['source', 'date', 'description', 'details'];
const MIN_PCT = 5;
const MAX_PCT = 80;

export function ChronologyTable({
  data,
  onColumnResize,
  onEntryEdit,
  onRowHighlight,
  onRowsDelete,
}: ChronologyTableProps) {
  const persisted: Required<ColumnWidths> = {
    ...DEFAULT_WIDTHS,
    ...(data.columnWidths ?? {}),
  };
  const entryCount = data.entries.length;
  const selectionEnabled = !!(onRowHighlight || onRowsDelete);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  // Prune indexes that fall off the end (e.g. after an external delete).
  useEffect(() => {
    setSelected((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const i of prev) {
        if (i < entryCount) next.add(i);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [entryCount]);

  const toggleSelectMode = useCallback(() => {
    setSelectMode((m) => {
      if (m) setSelected(new Set());
      return !m;
    });
  }, []);

  const toggleRow = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(Array.from({ length: entryCount }, (_, i) => i)));
  }, [entryCount]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const sortedSelected = useMemo(
    () => Array.from(selected).sort((a, b) => a - b),
    [selected],
  );

  const handleBulkHighlight = useCallback(
    (color: HighlightColor | null) => {
      if (!onRowHighlight || sortedSelected.length === 0) return;
      onRowHighlight(sortedSelected, color);
    },
    [onRowHighlight, sortedSelected],
  );

  const handleBulkDelete = useCallback(() => {
    if (!onRowsDelete || sortedSelected.length === 0) return;
    onRowsDelete(sortedSelected);
    setSelected(new Set());
  }, [onRowsDelete, sortedSelected]);
  // Local override that takes effect during a drag — snappy UI without waiting
  // for the network. Cleared once props reflect the saved state.
  const [drag, setDrag] = useState<Required<ColumnWidths> | null>(null);
  const widths = drag ?? persisted;
  const tableRef = useRef<HTMLTableElement>(null);

  const [activeHandle, setActiveHandle] = useState<number | null>(null);

  // Drop the drag override once the saved widths catch up. Compares by value
  // because parent passes a new object each render.
  useEffect(() => {
    if (!drag) return;
    if (
      drag.source === persisted.source &&
      drag.date === persisted.date &&
      drag.description === persisted.description &&
      drag.details === persisted.details
    ) {
      setDrag(null);
    }
  }, [drag, persisted.source, persisted.date, persisted.description, persisted.details]);

  const startDrag = useCallback(
    (handleIdx: number, e: React.PointerEvent) => {
      e.preventDefault();
      const tableEl = tableRef.current;
      if (!tableEl) return;
      setActiveHandle(handleIdx);
      const tableWidth = tableEl.offsetWidth;
      const startX = e.clientX;
      const aKey = COL_KEYS[handleIdx];
      const bKey = COL_KEYS[handleIdx + 1];
      const startA = widths[aKey];
      const startB = widths[bKey];

      const onMove = (ev: PointerEvent) => {
        const deltaPct = ((ev.clientX - startX) / tableWidth) * 100;
        let newA = startA + deltaPct;
        let newB = startB - deltaPct;
        // Clamp each to [MIN_PCT, MAX_PCT], pushing the slack to the neighbor.
        if (newA < MIN_PCT) {
          newB -= MIN_PCT - newA;
          newA = MIN_PCT;
        }
        if (newB < MIN_PCT) {
          newA -= MIN_PCT - newB;
          newB = MIN_PCT;
        }
        if (newA > MAX_PCT) {
          newB += newA - MAX_PCT;
          newA = MAX_PCT;
        }
        if (newB > MAX_PCT) {
          newA += newB - MAX_PCT;
          newB = MAX_PCT;
        }
        setDrag({
          ...widths,
          [aKey]: round(newA),
          [bKey]: round(newB),
        });
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        setActiveHandle(null);
        // Capture latest drag state via setter.
        setDrag((latest) => {
          if (latest && onColumnResize) onColumnResize(latest);
          return latest;
        });
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [widths, onColumnResize],
  );

  const isCustom =
    persisted.source !== DEFAULT_WIDTHS.source ||
    persisted.date !== DEFAULT_WIDTHS.date ||
    persisted.description !== DEFAULT_WIDTHS.description ||
    persisted.details !== DEFAULT_WIDTHS.details;

  const resetWidths = useCallback(() => {
    if (onColumnResize) onColumnResize(DEFAULT_WIDTHS);
  }, [onColumnResize]);

  const selectedCount = selected.size;
  const allSelected = entryCount > 0 && selectedCount === entryCount;

  return (
    <div>
      {(isCustom && onColumnResize) || selectionEnabled ? (
        <div className="flex justify-end items-center gap-4 mb-4">
          {isCustom && onColumnResize && (
            <button
              onClick={resetWidths}
              className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-gray-200"
              title="Reset column widths to defaults"
            >
              <FaRotateLeft className="w-3 h-3" />
              Reset widths
            </button>
          )}
          {selectionEnabled && entryCount > 0 && (
            <button
              onClick={toggleSelectMode}
              className={`flex items-center gap-1.5 text-xs transition-colors ${
                selectMode ? 'text-brand hover:text-brand/80' : 'text-ink-muted hover:text-gray-200'
              }`}
              title={selectMode ? 'Exit selection mode' : 'Select rows'}
            >
              {selectMode ? <FaXmark className="w-3 h-3" /> : <FaListCheck className="w-3 h-3" />}
              {selectMode ? 'Done' : 'Select rows'}
            </button>
          )}
        </div>
      ) : null}
      {selectMode && selectionEnabled && (
        <div className="mb-3 flex items-center gap-3 px-3 py-2 rounded-md bg-surface-panel border border-line-strong">
          <span className="text-xs text-ink-muted tabular-nums">
            {selectedCount} selected
          </span>
          <button
            onClick={allSelected ? clearSelection : selectAll}
            className="text-xs text-ink-muted hover:text-gray-200"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <div className="flex-1" />
          {onRowHighlight && (
            <div className={`flex items-center gap-1 transition-opacity ${selectedCount === 0 ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
              {HIGHLIGHT_NAMES.map((name) => {
                const c = HIGHLIGHT_COLORS[name];
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handleBulkHighlight(name)}
                    title={`Highlight ${selectedCount} row${selectedCount === 1 ? '' : 's'}: ${c.label}`}
                    aria-label={`Apply ${c.label} highlight`}
                    className="w-5 h-5 rounded-full border border-black/20 hover:scale-110 transition-transform"
                    style={{ background: c.bg }}
                  />
                );
              })}
              <button
                type="button"
                onClick={() => handleBulkHighlight(null)}
                title="Clear highlight"
                aria-label="Clear highlight"
                className="w-5 h-5 rounded-full border border-line-strong flex items-center justify-center text-ink-muted hover:text-ink hover:border-brand transition-colors"
              >
                <FaXmark className="w-2.5 h-2.5" />
              </button>
            </div>
          )}
          {onRowsDelete && (
            <>
              {onRowHighlight && <div className="w-px h-5 bg-line-strong" />}
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={selectedCount === 0}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 disabled:opacity-40 disabled:hover:text-red-400"
                title={`Delete ${selectedCount} row${selectedCount === 1 ? '' : 's'}`}
              >
                <FaTrash className="w-3 h-3" />
                Delete
              </button>
            </>
          )}
        </div>
      )}
      <div className="rounded-lg border border-line-strong overflow-hidden">
        <table ref={tableRef} className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: `${widths.source}%` }} />
            <col style={{ width: `${widths.date}%` }} />
            <col style={{ width: `${widths.description}%` }} />
            <col style={{ width: `${widths.details}%` }} />
          </colgroup>
          <thead>
            <tr className="bg-surface-panel/50 text-left text-ink-muted select-none">
              <ResizableTh label="Source" onResizeStart={(e) => startDrag(0, e)} resizable={!!onColumnResize} active={activeHandle === 0} />
              <ResizableTh label="Date" onResizeStart={(e) => startDrag(1, e)} resizable={!!onColumnResize} active={activeHandle === 1} />
              <ResizableTh label="Description" onResizeStart={(e) => startDrag(2, e)} resizable={!!onColumnResize} active={activeHandle === 2} />
              <ResizableTh label="Details" />
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, i) => {
              const url = entry.sourceUrl ?? entry.source ?? null;
              const label = entry.sourceLabel ?? (url ? deriveSourceLabel(url) : null);
              const hl = isHighlightColor(entry.highlight) ? HIGHLIGHT_COLORS[entry.highlight] : null;
              const rowStyle = hl ? { background: hl.bg, color: hl.fg } : undefined;
              const detailsStyle = hl ? { color: hl.fg } : undefined;
              const isSelected = selected.has(i);
              return (
                <tr
                  key={i}
                  className={`border-t border-line-strong/50 align-top group ${
                    selectMode && isSelected ? 'ring-1 ring-inset ring-brand/60' : ''
                  }`}
                  style={rowStyle}
                >
                  <td className="px-4 py-3 break-all relative">
                    {selectMode ? (
                      <RowCheckbox checked={isSelected} onChange={() => toggleRow(i)} />
                    ) : (
                      onRowHighlight && (
                        <HighlightSwatch
                          active={isHighlightColor(entry.highlight) ? entry.highlight : null}
                          onChange={(c) => onRowHighlight([i], c)}
                        />
                      )
                    )}
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline inline-flex items-center gap-1 text-xs font-mono"
                        style={hl ? { color: hl.fg } : undefined}
                      >
                        <span className={hl ? '' : 'text-brand'}>{label ?? url}</span>
                        <FaArrowUpRightFromSquare className="w-2.5 h-2.5 flex-shrink-0" />
                      </a>
                    ) : (
                      <span className={hl ? '' : 'text-ink-faint'}>N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={hl ? undefined : undefined}>
                    <span className={hl ? '' : 'text-ink-muted'}>
                      {onEntryEdit ? (
                        <EditableCell
                          value={entry.date}
                          onSave={(v) => onEntryEdit(i, { ...entry, date: v })}
                        />
                      ) : (
                        entry.date
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={hl ? '' : 'text-ink-muted'}>
                      {onEntryEdit ? (
                        <EditableCell
                          value={entry.description}
                          multiline
                          onSave={(v) => onEntryEdit(i, { ...entry, description: v })}
                        />
                      ) : (
                        entry.description
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs break-words" style={detailsStyle}>
                    <span className={hl ? '' : 'text-ink-muted'}>
                      {onEntryEdit ? (
                        <EditableCell
                          value={entry.details ?? ''}
                          multiline
                          emptyText="--"
                          onSave={(v) => onEntryEdit(i, { ...entry, details: v || null })}
                        />
                      ) : (
                        entry.details || '--'
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {data.entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-ink-faint">
                  No entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResizableTh({
  label,
  onResizeStart,
  resizable,
  active,
}: {
  label: string;
  onResizeStart?: (e: React.PointerEvent) => void;
  resizable?: boolean;
  active?: boolean;
}) {
  return (
    <th className="relative px-4 py-3">
      {label}
      {resizable && onResizeStart && (
        <span
          onPointerDown={onResizeStart}
          className="group absolute top-0 -right-1.5 z-10 h-full w-3 flex items-center justify-center cursor-col-resize"
          title="Drag to resize column"
        >
          {/* The visible grip — always present, brighter on hover, brightest while dragging. */}
          <span
            className={`block w-0.5 rounded-full transition-all ${
              active
                ? 'bg-brand h-6 w-1'
                : 'bg-surface-raised h-4 group-hover:bg-brand/90 group-hover:h-6 group-hover:w-1'
            }`}
          />
        </span>
      )}
    </th>
  );
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function EditableCell({
  value,
  multiline,
  onSave,
  emptyText,
}: {
  value: string;
  multiline?: boolean;
  onSave: (newValue: string) => void;
  emptyText?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      // Place cursor at end of text rather than selecting all — feels less destructive.
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  const cancel = () => {
    setEditing(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'Enter') {
      // Single-line: Enter commits. Multiline: only Cmd/Ctrl+Enter commits;
      // bare Enter inserts a newline.
      if (!multiline || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        commit();
      }
    }
  };

  if (editing) {
    const sharedProps = {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: onKey,
      className:
        'w-full bg-surface text-gray-100 px-2 py-1 rounded border border-brand focus:outline-none focus:ring-1 focus:ring-brand',
    };
    return multiline ? (
      <textarea
        {...sharedProps}
        ref={(el) => {
          inputRef.current = el;
        }}
        rows={3}
        className={`${sharedProps.className} resize-y min-h-[60px]`}
      />
    ) : (
      <input
        {...sharedProps}
        ref={(el) => {
          inputRef.current = el;
        }}
      />
    );
  }

  const isEmpty = !value;
  return (
    <div
      onClick={startEdit}
      className="cursor-text rounded -mx-1 -my-0.5 px-1 py-0.5 hover:bg-surface-panel/60 hover:outline hover:outline-1 hover:outline-line-strong transition-colors whitespace-pre-wrap"
      title="Click to edit"
    >
      {isEmpty ? <span className="text-ink-faint italic">{emptyText ?? 'click to add'}</span> : value}
    </div>
  );
}

function RowCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      title={checked ? 'Deselect row' : 'Select row'}
      className={`absolute left-1 top-1/2 -translate-y-1/2 z-10 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
        checked
          ? 'bg-brand border-brand text-white'
          : 'bg-surface border-line-strong hover:border-brand'
      }`}
    >
      {checked && <FaCheck className="w-2 h-2" />}
    </button>
  );
}

function HighlightSwatch({
  active,
  onChange,
}: {
  active: HighlightColor | null;
  onChange: (color: HighlightColor | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeColor = active ? HIGHLIGHT_COLORS[active] : null;

  return (
    <div ref={rootRef} className="absolute left-1 top-1/2 -translate-y-1/2 z-10">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={active ? `Highlight: ${activeColor!.label}` : 'Highlight row'}
        aria-label={active ? `Change row highlight (current: ${activeColor!.label})` : 'Highlight row'}
        className={`w-3 h-3 rounded-full border transition-opacity ${
          active
            ? 'opacity-100 border-black/20'
            : 'opacity-0 group-hover:opacity-100 border-line-strong hover:border-brand'
        }`}
        style={active ? { background: activeColor!.bg } : undefined}
      />
      {open && (
        <div
          className="absolute left-0 top-5 z-20 flex items-center gap-1 p-1.5 rounded-md bg-surface-panel border border-line-strong shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {HIGHLIGHT_NAMES.map((name) => {
            const c = HIGHLIGHT_COLORS[name];
            const isActive = active === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => { onChange(name); setOpen(false); }}
                title={c.label}
                aria-label={c.label}
                className={`w-5 h-5 rounded-full border transition-transform hover:scale-110 ${
                  isActive ? 'border-brand ring-1 ring-brand' : 'border-black/20'
                }`}
                style={{ background: c.bg }}
              />
            );
          })}
          <div className="w-px h-5 bg-line-strong mx-0.5" />
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            title="Clear highlight"
            aria-label="Clear highlight"
            className="w-5 h-5 rounded-full border border-line-strong flex items-center justify-center text-ink-muted hover:text-ink hover:border-brand transition-colors"
          >
            <FaXmark className="w-2.5 h-2.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function deriveSourceLabel(url: string): string {
  const matches = url.match(/0x[a-fA-F0-9]{8,}/g);
  if (matches && matches.length > 0) {
    return matches[matches.length - 1].slice(0, 6) + '…';
  }
  try {
    const u = new URL(url);
    const tail = u.pathname + u.search;
    return tail.length > 30 ? u.host + tail.slice(0, 30) + '…' : u.host + tail;
  } catch {
    return url.length > 32 ? url.slice(0, 32) + '…' : url;
  }
}
