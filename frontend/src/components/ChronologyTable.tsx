'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FaArrowUpRightFromSquare, FaRotateLeft } from 'react-icons/fa6';

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
}

interface ColumnWidths {
  source?: number;
  date?: number;
  description?: number;
  details?: number;
}

interface ChronologyData {
  title?: string;
  entries: ChronologyEntry[];
  columnWidths?: ColumnWidths;
}

interface ChronologyTableProps {
  data: ChronologyData;
  onColumnResize?: (widths: ColumnWidths) => void;
  onEntryEdit?: (index: number, entry: ChronologyEntry) => void;
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

export function ChronologyTable({ data, onColumnResize, onEntryEdit }: ChronologyTableProps) {
  const persisted: Required<ColumnWidths> = {
    ...DEFAULT_WIDTHS,
    ...(data.columnWidths ?? {}),
  };
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

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        {data.title ? (
          <h2 className="text-xl font-bold text-white">{data.title}</h2>
        ) : (
          <span />
        )}
        {isCustom && onColumnResize && (
          <button
            onClick={resetWidths}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200"
            title="Reset column widths to defaults"
          >
            <FaRotateLeft className="w-3 h-3" />
            Reset widths
          </button>
        )}
      </div>
      <div className="rounded-lg border border-gray-700 overflow-hidden">
        <table ref={tableRef} className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: `${widths.source}%` }} />
            <col style={{ width: `${widths.date}%` }} />
            <col style={{ width: `${widths.description}%` }} />
            <col style={{ width: `${widths.details}%` }} />
          </colgroup>
          <thead>
            <tr className="bg-gray-800/50 text-left text-gray-400 select-none">
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
              return (
                <tr key={i} className="border-t border-gray-700/50 align-top">
                  <td className="px-4 py-3 break-all">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 text-xs font-mono"
                      >
                        {label ?? url}
                        <FaArrowUpRightFromSquare className="w-2.5 h-2.5 flex-shrink-0" />
                      </a>
                    ) : (
                      <span className="text-gray-500">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                    {onEntryEdit ? (
                      <EditableCell
                        value={entry.date}
                        onSave={(v) => onEntryEdit(i, { ...entry, date: v })}
                      />
                    ) : (
                      entry.date
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    {onEntryEdit ? (
                      <EditableCell
                        value={entry.description}
                        multiline
                        onSave={(v) => onEntryEdit(i, { ...entry, description: v })}
                      />
                    ) : (
                      entry.description
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs break-words">
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
                  </td>
                </tr>
              );
            })}
            {data.entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
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
                ? 'bg-blue-400 h-6 w-1'
                : 'bg-gray-500 h-4 group-hover:bg-blue-400 group-hover:h-6 group-hover:w-1'
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
        'w-full bg-gray-900 text-gray-100 px-2 py-1 rounded border border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400',
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
      className="cursor-text rounded -mx-1 -my-0.5 px-1 py-0.5 hover:bg-gray-800/60 hover:outline hover:outline-1 hover:outline-gray-600 transition-colors whitespace-pre-wrap"
      title="Click to edit"
    >
      {isEmpty ? <span className="text-gray-600 italic">{emptyText ?? 'click to add'}</span> : value}
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
