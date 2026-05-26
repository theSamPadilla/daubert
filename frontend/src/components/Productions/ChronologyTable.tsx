'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaArrowUpRightFromSquare,
  FaCheck,
  FaListCheck,
  FaPlus,
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
import {
  type ColumnDef,
  type ChronologyData,
  type ChronologyEntry,
  DEFAULT_COLUMNS,
  getColumns,
} from '@/lib/chronologySchema';
import { AddColumnModal } from './AddColumnModal';

interface ChronologyTableProps {
  data: ChronologyData;
  onColumnResize?: (widths: Record<string, number>) => void;
  onColumnAdd?: (column: ColumnDef, index?: number) => void;
  onColumnRemove?: (key: string) => void;
  onColumnRename?: (key: string, label: string) => void;
  onEntryEdit?: (index: number, entry: ChronologyEntry) => void;
  onRowHighlight?: (indexes: number[], color: HighlightColor | null) => void;
  onRowsDelete?: (indexes: number[]) => void;
}

const MIN_PCT = 5;
const MAX_PCT = 80;

export function ChronologyTable({
  data,
  onColumnResize,
  onColumnAdd,
  onColumnRemove,
  onColumnRename,
  onEntryEdit,
  onRowHighlight,
  onRowsDelete,
}: ChronologyTableProps) {
  const columns = getColumns(data);
  const entryCount = data.entries.length;
  const selectionEnabled = !!(onRowHighlight || onRowsDelete);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [addColumnOpen, setAddColumnOpen] = useState(false);

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

  // Local drag-overlay: Record<string, number> keyed by column key.
  // Cleared once persisted widths catch up.
  const [drag, setDrag] = useState<Record<string, number> | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [activeHandle, setActiveHandle] = useState<number | null>(null);

  // Resolve effective width for a column: drag overlay → persisted column.width → DEFAULT
  const effectiveWidth = useCallback(
    (col: ColumnDef): number => {
      if (drag && drag[col.key] !== undefined) return drag[col.key];
      return col.width;
    },
    [drag],
  );

  // Drop the drag override once the saved widths catch up. Generalized: compare
  // every column's persisted width against the drag overlay by key.
  useEffect(() => {
    if (!drag) return;
    const allMatch = columns.every((col) => {
      const dragVal = drag[col.key];
      return dragVal === undefined || dragVal === col.width;
    });
    if (allMatch) setDrag(null);
  }, [drag, columns]);

  const startDrag = useCallback(
    (handleIdx: number, e: React.PointerEvent) => {
      e.preventDefault();
      const tableEl = tableRef.current;
      if (!tableEl) return;
      setActiveHandle(handleIdx);
      const tableWidth = tableEl.offsetWidth;
      const startX = e.clientX;
      const aCol = columns[handleIdx];
      const bCol = columns[handleIdx + 1];
      const aKey = aCol.key;
      const bKey = bCol.key;
      const startA = drag?.[aKey] ?? aCol.width;
      const startB = drag?.[bKey] ?? bCol.width;

      const onMove = (ev: PointerEvent) => {
        const deltaPct = ((ev.clientX - startX) / tableWidth) * 100;
        let newA = startA + deltaPct;
        let newB = startB - deltaPct;
        // Clamp each to [MIN_PCT, MAX_PCT], pushing slack to neighbor.
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
        setDrag((prev) => ({
          ...(prev ?? {}),
          [aKey]: round(newA),
          [bKey]: round(newB),
        }));
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        setActiveHandle(null);
        setDrag((latest) => {
          if (latest && onColumnResize) {
            const patch: Record<string, number> = {};
            if (latest[aKey] !== undefined) patch[aKey] = latest[aKey];
            if (latest[bKey] !== undefined) patch[bKey] = latest[bKey];
            onColumnResize(patch);
          }
          return latest;
        });
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [columns, drag, onColumnResize],
  );

  // isCustom: true if ANY column's current width differs from its DEFAULT counterpart.
  const defaultWidthMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of DEFAULT_COLUMNS) m[c.key] = c.width;
    return m;
  }, []);

  const isCustom = useMemo(
    () => columns.some((col) => col.width !== (defaultWidthMap[col.key] ?? col.width)),
    [columns, defaultWidthMap],
  );

  const resetWidths = useCallback(() => {
    if (!onColumnResize) return;
    const resets: Record<string, number> = {};
    for (const col of columns) {
      const def = defaultWidthMap[col.key];
      if (def !== undefined) resets[col.key] = def;
    }
    if (Object.keys(resets).length > 0) onColumnResize(resets);
  }, [columns, defaultWidthMap, onColumnResize]);

  const selectedCount = selected.size;
  const allSelected = entryCount > 0 && selectedCount === entryCount;

  const showToolbar = !!onColumnAdd || (isCustom && !!onColumnResize) || selectionEnabled;

  return (
    <div>
      {showToolbar && (
        <div className="mb-3 flex items-center justify-between gap-4 px-3 py-2 rounded-md bg-surface-panel/60 border border-line-strong">
          <div className="flex items-center gap-3">
            {onColumnAdd && (
              <button
                type="button"
                onClick={() => setAddColumnOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-brand transition-colors"
                title="Add a custom column"
              >
                <FaPlus className="w-3 h-3" />
                Add column
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            {isCustom && onColumnResize && (
              <button
                onClick={resetWidths}
                className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-gray-200 transition-colors"
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
        </div>
      )}
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
            {columns.map((col) => (
              <col key={col.key} style={{ width: `${effectiveWidth(col)}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-surface-panel/50 text-left text-ink-muted select-none">
              {columns.map((col, i) => (
                <ResizableTh
                  key={col.key}
                  column={col}
                  onResizeStart={
                    i < columns.length - 1 && onColumnResize
                      ? (e) => startDrag(i, e)
                      : undefined
                  }
                  active={activeHandle === i}
                  onRename={
                    onColumnRename && col.kind === 'text'
                      ? (label) => onColumnRename(col.key, label)
                      : undefined
                  }
                  onRemove={
                    onColumnRemove && columns.length > 1 && col.kind === 'text'
                      ? () => onColumnRemove(col.key)
                      : undefined
                  }
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, i) => {
              const hl = isHighlightColor(entry.highlight)
                ? HIGHLIGHT_COLORS[entry.highlight as HighlightColor]
                : null;
              const rowStyle = hl ? { background: hl.bg, color: hl.fg } : undefined;
              const isSelected = selected.has(i);
              return (
                <tr
                  key={i}
                  className={`border-t border-line-strong/50 align-top group ${
                    selectMode && isSelected ? 'ring-1 ring-inset ring-brand/60' : ''
                  }`}
                  style={rowStyle}
                >
                  {columns.map((col, ci) => (
                    <Cell
                      key={col.key}
                      column={col}
                      entry={entry}
                      isFirst={ci === 0}
                      hl={hl}
                      editable={!!onEntryEdit && col.kind === 'text'}
                      onEdit={
                        onEntryEdit
                          ? (value) => onEntryEdit(i, { ...entry, [col.key]: value || null })
                          : undefined
                      }
                      onRowHighlight={onRowHighlight ? (c) => onRowHighlight([i], c) : undefined}
                      selectMode={selectMode}
                      isSelected={isSelected}
                      toggleRow={() => toggleRow(i)}
                    />
                  ))}
                </tr>
              );
            })}
            {data.entries.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-ink-faint">
                  No entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AddColumnModal
        open={addColumnOpen}
        existingColumns={columns}
        onAdd={(col, index) => {
          onColumnAdd?.(col, index);
          setAddColumnOpen(false);
        }}
        onCancel={() => setAddColumnOpen(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cell dispatcher
// ---------------------------------------------------------------------------

interface CellProps {
  column: ColumnDef;
  entry: ChronologyEntry;
  isFirst: boolean;
  hl: { bg: string; fg: string; label: string } | null;
  editable: boolean;
  onEdit?: (value: string) => void;
  onRowHighlight?: (color: HighlightColor | null) => void;
  selectMode: boolean;
  isSelected: boolean;
  toggleRow: () => void;
}

function Cell({
  column,
  entry,
  isFirst,
  hl,
  editable,
  onEdit,
  onRowHighlight,
  selectMode,
  isSelected,
  toggleRow,
}: CellProps) {
  const isDetails = column.key === 'details';

  if (column.kind === 'link') {
    // Source column (kind=link): render anchor + highlight/select affordance
    const srcVal = entry.source as { url: string | null; label: string | null } | null | undefined;
    const url = srcVal?.url ?? null;
    const label = srcVal?.label ?? (url ? deriveSourceLabel(url) : null);
    return (
      <td className="px-4 py-3 break-all relative">
        {isFirst && (
          selectMode ? (
            <RowCheckbox checked={isSelected} onChange={toggleRow} />
          ) : (
            onRowHighlight && (
              <HighlightSwatch
                active={isHighlightColor(entry.highlight) ? (entry.highlight as HighlightColor) : null}
                onChange={onRowHighlight}
              />
            )
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
    );
  }

  // text column
  const rawValue = entry[column.key];
  const strValue = typeof rawValue === 'string' ? rawValue : '';

  return (
    <td
      className={`px-4 py-3 ${isDetails ? 'text-xs break-words' : ''} relative`}
      style={hl && isDetails ? { color: hl.fg } : undefined}
    >
      {/* Highlight/select swatch on first text column when source column is absent */}
      {isFirst && (
        selectMode ? (
          <RowCheckbox checked={isSelected} onChange={toggleRow} />
        ) : (
          onRowHighlight && (
            <HighlightSwatch
              active={isHighlightColor(entry.highlight) ? (entry.highlight as HighlightColor) : null}
              onChange={onRowHighlight}
            />
          )
        )
      )}
      <span className={hl ? '' : 'text-ink-muted'}>
        {editable && onEdit ? (
          <EditableCell
            value={strValue}
            multiline={isDetails || column.key === 'description'}
            emptyText={isDetails ? '--' : undefined}
            onSave={(v) => onEdit(isDetails ? (v || '') : v)}
          />
        ) : (
          strValue || (isDetails ? '--' : strValue)
        )}
      </span>
    </td>
  );
}

// ---------------------------------------------------------------------------
// ResizableTh — with optional inline rename + remove affordances
// ---------------------------------------------------------------------------

function ResizableTh({
  column,
  onResizeStart,
  active,
  onRename,
  onRemove,
}: {
  column: ColumnDef;
  onResizeStart?: (e: React.PointerEvent) => void;
  active?: boolean;
  onRename?: (newLabel: string) => void;
  onRemove?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const startRename = () => {
    if (!onRename) return;
    setDraft(column.label);
    setEditing(true);
  };

  const commitRename = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== column.label && onRename) onRename(trimmed);
  };

  const cancelRename = () => setEditing(false);

  return (
    <th className="relative px-4 py-3 group/th">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
            if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
          }}
          className="w-full bg-surface text-gray-100 px-1 py-0.5 rounded border border-brand focus:outline-none focus:ring-1 focus:ring-brand text-xs font-normal"
        />
      ) : (
        <span
          className={onRename ? 'cursor-pointer hover:text-gray-200 transition-colors' : ''}
          onClick={onRename ? startRename : undefined}
          title={onRename ? 'Click to rename' : undefined}
        >
          {column.label}
        </span>
      )}
      {/* Remove button — hover-revealed, only when onRemove provided */}
      {onRemove && !editing && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title={`Remove "${column.label}" column`}
          className="absolute top-1/2 -translate-y-1/2 right-5 z-10 opacity-0 group-hover/th:opacity-100 transition-opacity text-ink-faint hover:text-red-400 w-4 h-4 flex items-center justify-center"
        >
          <FaXmark className="w-2.5 h-2.5" />
        </button>
      )}
      {/* Resize grip */}
      {onResizeStart && (
        <span
          onPointerDown={onResizeStart}
          className="group/grip absolute top-0 -right-1.5 z-10 h-full w-3 flex items-center justify-center cursor-col-resize"
          title="Drag to resize column"
        >
          <span
            className={`block w-0.5 rounded-full transition-all ${
              active
                ? 'bg-brand h-6 w-1'
                : 'bg-surface-raised h-4 group-hover/grip:bg-brand/90 group-hover/grip:h-6 group-hover/grip:w-1'
            }`}
          />
        </span>
      )}
    </th>
  );
}

// ---------------------------------------------------------------------------
// Helpers (unchanged from original)
// ---------------------------------------------------------------------------

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
        ref={(el) => { inputRef.current = el; }}
        rows={3}
        className={`${sharedProps.className} resize-y min-h-[60px]`}
      />
    ) : (
      <input
        {...sharedProps}
        ref={(el) => { inputRef.current = el; }}
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
