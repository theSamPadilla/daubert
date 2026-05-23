'use client';

import { useState, useCallback } from 'react';
import { FaCaretDown, FaCaretRight, FaArrowRotateLeft } from 'react-icons/fa6';
import { BRAND_SERIES_COLORS } from '@/lib/chartPalette';

interface ChartDataset {
  label?: string;
  data?: unknown[];
  hidden?: boolean;
  colorOverride?: string;
  borderWidth?: number;
  // line-only
  tension?: number;
  pointRadius?: number;
  fill?: boolean;
  borderDash?: number[];
  // bar-only
  borderRadius?: number;
  stack?: string;
  [k: string]: unknown;
}

interface ChartData {
  chartType: string;
  datasets: ChartDataset[];
  labels: string[];
  options?: Record<string, unknown>;
  height?: number;
}

interface Patch {
  datasets?: ChartDataset[];
  labels?: string[];
  options?: Record<string, unknown>;
}

interface Props {
  data: ChartData;
  onChange: (patch: Patch) => void;
}

const BORDER_DASH_OPTIONS: { label: string; value: number[] }[] = [
  { label: 'Solid', value: [] },
  { label: 'Dashed', value: [6, 4] },
  { label: 'Dotted', value: [2, 3] },
  { label: 'Long dash', value: [12, 6] },
];

function dashLabel(dash: number[] | undefined): string {
  if (!dash || dash.length === 0) return 'Solid';
  const match = BORDER_DASH_OPTIONS.find(
    (o) => o.value.length === dash.length && o.value.every((v, i) => v === dash[i]),
  );
  return match?.label ?? 'Custom';
}

// Shared input/select/textarea styling — kept terse to use everywhere.
const INPUT_CLASS =
  'w-full h-7 px-2 text-xs bg-surface text-ink border border-line-strong rounded focus:outline-none focus:border-brand placeholder:text-ink-faint';
const TEXTAREA_CLASS =
  'w-full px-2 py-1.5 text-xs bg-surface text-ink border border-line-strong rounded focus:outline-none focus:border-brand font-mono leading-tight resize-y placeholder:text-ink-faint';

export function ChartDatasetEditor({ data, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);

  const updateDataset = useCallback(
    (i: number, patch: Partial<ChartDataset>) => {
      const next = data.datasets.map((d, idx) => {
        if (idx !== i) return d;
        const merged: ChartDataset = { ...d, ...patch };
        for (const k of Object.keys(patch)) {
          if (merged[k] === undefined) delete merged[k];
        }
        return merged;
      });
      onChange({ datasets: next });
    },
    [data.datasets, onChange],
  );

  const updateTitle = useCallback(
    (title: string) => {
      const opts: Record<string, unknown> = { ...(data.options ?? {}) };
      const plugins: Record<string, unknown> = { ...((opts.plugins as Record<string, unknown>) ?? {}) };
      const trimmed = title.trim();
      plugins.title = trimmed ? { display: true, text: title } : { display: false, text: '' };
      opts.plugins = plugins;
      onChange({ options: opts });
    },
    [data.options, onChange],
  );

  const currentTitle =
    (((data.options as Record<string, unknown> | undefined)?.plugins as Record<string, unknown> | undefined)
      ?.title as Record<string, unknown> | undefined)?.text as string | undefined ?? '';

  const isLine = data.chartType === 'line';
  const isBar = data.chartType === 'bar';

  return (
    <div className="mt-3 mx-3 rounded-md border border-line-strong bg-surface-panel">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 h-9 flex items-center justify-between text-left text-xs font-medium text-ink hover:bg-surface-raised/50 rounded-md transition-colors"
      >
        <span className="flex items-center gap-2">
          {expanded ? (
            <FaCaretDown className="w-3 h-3 text-ink-muted" />
          ) : (
            <FaCaretRight className="w-3 h-3 text-ink-muted" />
          )}
          Edit chart
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          {data.datasets.length} series · {data.labels.length} labels
        </span>
      </button>

      {expanded && (
        <div className="border-t border-line-strong p-3 space-y-4">
          {/* Chart-level: title + labels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Chart title">
              <input
                type="text"
                value={currentTitle}
                onChange={(e) => updateTitle(e.target.value)}
                placeholder="Untitled chart"
                className={`${INPUT_CLASS} h-8`}
              />
            </Field>
            <Field label="Labels (one per line)">
              <textarea
                value={data.labels.join('\n')}
                onChange={(e) => onChange({ labels: e.target.value.split('\n') })}
                rows={Math.min(6, Math.max(3, data.labels.length))}
                className={TEXTAREA_CLASS}
              />
            </Field>
          </div>

          {/* Per-dataset cards */}
          <div className="space-y-2">
            {data.datasets.map((ds, i) => {
              const brandColor = BRAND_SERIES_COLORS[i % BRAND_SERIES_COLORS.length];
              const effectiveColor = ds.colorOverride ?? brandColor;
              const isCustom = typeof ds.colorOverride === 'string';
              return (
                <div
                  key={i}
                  className="rounded-md border border-line-strong bg-surface-raised/40 p-2.5 space-y-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="color"
                      value={effectiveColor}
                      onChange={(e) => updateDataset(i, { colorOverride: e.target.value })}
                      className="w-7 h-7 rounded border border-line-strong cursor-pointer bg-surface shrink-0"
                      title="Series color"
                    />
                    {isCustom && (
                      <button
                        onClick={() => updateDataset(i, { colorOverride: undefined })}
                        title="Reset to brand palette"
                        className="h-7 w-7 flex items-center justify-center text-ink-muted hover:text-ink border border-line-strong rounded bg-surface hover:bg-surface-panel transition-colors shrink-0"
                      >
                        <FaArrowRotateLeft className="w-3 h-3" />
                      </button>
                    )}
                    <input
                      type="text"
                      value={ds.label ?? ''}
                      onChange={(e) => updateDataset(i, { label: e.target.value })}
                      placeholder={`Series ${i + 1}`}
                      className={`${INPUT_CLASS} flex-1 min-w-[8rem]`}
                    />
                    <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={!!ds.hidden}
                        onChange={(e) => updateDataset(i, { hidden: e.target.checked })}
                        className="accent-brand cursor-pointer"
                      />
                      Hidden
                    </label>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Field label="Border width" tight>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={ds.borderWidth ?? ''}
                        onChange={(e) =>
                          updateDataset(i, {
                            borderWidth: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                        placeholder="auto"
                        className={INPUT_CLASS}
                      />
                    </Field>

                    {isLine && (
                      <>
                        <Field label={`Tension ${(ds.tension ?? 0).toFixed(2)}`} tight>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={ds.tension ?? 0}
                            onChange={(e) => updateDataset(i, { tension: Number(e.target.value) })}
                            className="w-full h-7 accent-brand cursor-pointer"
                          />
                        </Field>
                        <Field label="Point radius" tight>
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={ds.pointRadius ?? ''}
                            onChange={(e) =>
                              updateDataset(i, {
                                pointRadius:
                                  e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                            placeholder="auto"
                            className={INPUT_CLASS}
                          />
                        </Field>
                        <Field label="Line style" tight>
                          <select
                            value={dashLabel(ds.borderDash)}
                            onChange={(e) => {
                              const opt = BORDER_DASH_OPTIONS.find((o) => o.label === e.target.value);
                              updateDataset(i, {
                                borderDash: opt && opt.value.length > 0 ? opt.value : undefined,
                              });
                            }}
                            className={INPUT_CLASS}
                          >
                            {BORDER_DASH_OPTIONS.map((o) => (
                              <option key={o.label} className="bg-surface text-ink">
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Fill area" tight>
                          <label className="flex items-center gap-1.5 text-xs text-ink-muted h-7 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!ds.fill}
                              onChange={(e) => updateDataset(i, { fill: e.target.checked })}
                              className="accent-brand cursor-pointer"
                            />
                            Fill below line
                          </label>
                        </Field>
                      </>
                    )}

                    {isBar && (
                      <>
                        <Field label="Bar radius" tight>
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={ds.borderRadius ?? ''}
                            onChange={(e) =>
                              updateDataset(i, {
                                borderRadius:
                                  e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                            placeholder="auto"
                            className={INPUT_CLASS}
                          />
                        </Field>
                        <Field label="Stack group" tight>
                          <input
                            type="text"
                            value={ds.stack ?? ''}
                            onChange={(e) =>
                              updateDataset(i, {
                                stack: e.target.value === '' ? undefined : e.target.value,
                              })
                            }
                            placeholder="none"
                            className={INPUT_CLASS}
                          />
                        </Field>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  tight,
}: {
  label: string;
  children: React.ReactNode;
  tight?: boolean;
}) {
  return (
    <label className={`flex flex-col ${tight ? 'gap-1' : 'gap-1.5'}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
