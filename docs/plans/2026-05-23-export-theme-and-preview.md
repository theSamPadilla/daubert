# Export Theme + Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a light/dark theme toggle and a live preview pane to graph and chart exports, plus a per-item theme picker in the exhibit builder. Default theme is dark.

**Architecture:** Themes are a frontend concern only — the backend embeds whatever PNG it receives. We factor today's hard-coded dark styling out of `cytoscapeStyle.ts`/`useCytoscape.ts`/`chartPalette.ts` into a single `EXPORT_THEMES` palette keyed by `'dark' | 'light'`. The export pipelines (`exportPngDataUrl` for graph, themed Chart.js options for chart) accept a `theme` parameter. The `ExportModal` is redesigned side-by-side: controls left, async preview right, cached per theme. The exhibit builder gets a per-item theme picker that drives PNG generation at export time.

**Tech Stack:** Next.js 14 (App Router), React 18, Cytoscape.js, Chart.js + react-chartjs-2, Jest. No backend changes.

---

## Git rules for this plan

- **NEVER** commit during task execution. Each task ends with `git status` so the user can review.
- **NEVER** add `Co-Authored-By` trailers.
- The user commits when they're satisfied.

## Atomized Changes

| #  | File | Action | Purpose |
|----|------|--------|---------|
| 1  | `frontend/src/lib/exportTheme.ts` | Create | Single source of truth for `ExportTheme` type and dark/light palettes (PNG bg, edge label colors, pill colors, parent opacity, etc.) |
| 2  | `frontend/src/lib/exportTheme.test.ts` | Create | Lock palette values + assert dark ≠ light to prevent silent regressions |
| 3  | `frontend/src/hooks/useCytoscape.ts` | Modify | `exportPngDataUrl` accepts `theme`; theme-aware overrides during the bump pass |
| 4  | `frontend/src/components/Graph/GraphCanvas.tsx` | Modify | Re-expose themed `exportPngDataUrl` and `exportImage` via imperative handle |
| 5  | `frontend/src/components/Common/ExportPreview.tsx` | Create | Reusable async preview pane with per-theme caching |
| 6  | `frontend/src/components/Common/ExportModal.tsx` | Modify | Side-by-side layout; theme toggle in controls; preview pane for graph/chart kinds |
| 7  | `frontend/src/app/cases/[caseId]/investigations/page.tsx` | Modify | Pass themed generator + receive themed export call |
| 8  | `frontend/src/lib/chartPalette.ts` | Modify | Export `getBrandChartOptions(theme)` returning theme-aware Chart.js options |
| 9  | `frontend/src/components/Productions/ChartViewer.tsx` | Modify | Accept `theme` prop and apply themed options |
| 10 | `frontend/src/hooks/useChartSnapshot.ts` | Modify | Snapshot accepts `theme`, passes it to the hidden `ChartViewer` |
| 11 | `frontend/src/components/Productions/ProductionViewer.tsx` | Modify | Pass themed generator to `ExportModal` for chart productions |
| 12 | `frontend/src/components/Productions/ExhibitBuilder.tsx` | Modify | Per-item theme picker (no preview); pass theme to snapshot calls at export time |
| 13 | `frontend/src/hooks/useGraphSnapshot.ts` | Modify | `snapshot` accepts `theme`, threads it to the hidden `GraphCanvas.exportPngDataUrl` call |

**13 atomic changes. No backend changes.**

---

## What the developer needs to know

- The export pipeline today is dark-only and the styling is split between (a) `frontend/src/hooks/cytoscapeStyle.ts` (the live stylesheet) and (b) the `cy.batch()` bump pass inside `frontend/src/hooks/useCytoscape.ts:exportPngDataUrl` (applied during export only). We do **not** touch the in-app stylesheet — the app is dark-only. The light theme is purely an export-time override.
- `cy.png({ full: true, scale: 1.5, bg: '#0B1220' })` is the canvas capture call we need to thread `theme` through. `bg` becomes `palette.pngBackground`.
- `useChartSnapshot.ts` mounts a hidden `<ChartViewer>` off-screen and reads the canvas. We pass `theme` to that hidden mount.
- The chart palette is in `frontend/src/lib/chartPalette.ts`. `BRAND_SERIES_COLORS` (the actual series colors) stay identical across themes — only axis/grid/legend/tick chrome changes.
- Test framework is Jest (`npm test` from `frontend/`). One existing test: `frontend/src/hooks/cytoscapeSync.test.ts`. Add new tests next to source files using the same convention.
- **Cytoscape `:parent` overrides** during the bump pass are done by iterating `cy.nodes(':parent')` and calling `.style()` on each — same pattern as the existing per-node bump.
- The user explicitly does **not** want commits during execution. End each task with `git status`, no `git add` or `git commit`.

---

## Task 1: Theme module — palette and type

**Files:**
- Create: `frontend/src/lib/exportTheme.ts`

**Step 1: Write the file**

```typescript
// frontend/src/lib/exportTheme.ts

export type ExportTheme = 'dark' | 'light';

export interface ExportThemePalette {
  // PNG canvas background (cy.png bg parameter)
  pngBackground: string;

  // Edge label
  edgeLabelColor: string;
  edgeLabelBgColor: string;

  // Compound (trace group) parent
  parentBackgroundOpacity: number;
  parentBorderOpacity: number;
}

export const EXPORT_THEMES: Record<ExportTheme, ExportThemePalette> = {
  dark: {
    pngBackground: '#0B1220',
    edgeLabelColor: '#d1d5db',
    edgeLabelBgColor: '#111827',
    parentBackgroundOpacity: 0.07,
    parentBorderOpacity: 0.45,
  },
  light: {
    pngBackground: '#ffffff',
    edgeLabelColor: '#374151',
    edgeLabelBgColor: '#f3f4f6',
    parentBackgroundOpacity: 0.15,
    parentBorderOpacity: 0.7,
  },
};
```

**Step 2: Type-check**

Run from `frontend/`: `npx tsc --noEmit`
Expected: exit 0

**Step 3: `git status`**

---

## Task 2: Theme palette tests

**Files:**
- Create: `frontend/src/lib/exportTheme.test.ts`

**Step 1: Write the test**

```typescript
// frontend/src/lib/exportTheme.test.ts
import { EXPORT_THEMES } from './exportTheme';

describe('EXPORT_THEMES', () => {
  it('has both dark and light palettes', () => {
    expect(EXPORT_THEMES.dark).toBeDefined();
    expect(EXPORT_THEMES.light).toBeDefined();
  });

  it('dark and light differ on every styled token', () => {
    const d = EXPORT_THEMES.dark;
    const l = EXPORT_THEMES.light;
    expect(d.pngBackground).not.toBe(l.pngBackground);
    expect(d.edgeLabelColor).not.toBe(l.edgeLabelColor);
    expect(d.edgeLabelBgColor).not.toBe(l.edgeLabelBgColor);
    expect(d.parentBackgroundOpacity).not.toBe(l.parentBackgroundOpacity);
    expect(d.parentBorderOpacity).not.toBe(l.parentBorderOpacity);
  });

  it('dark palette matches current export defaults', () => {
    // If these values change, exports of saved investigations will shift.
    // Bumping these requires a visual review.
    expect(EXPORT_THEMES.dark.pngBackground).toBe('#0B1220');
    expect(EXPORT_THEMES.dark.edgeLabelColor).toBe('#d1d5db');
    expect(EXPORT_THEMES.dark.edgeLabelBgColor).toBe('#111827');
  });
});
```

**Step 2: Run the test**

Run from `frontend/`: `npx jest src/lib/exportTheme.test.ts`
Expected: 3 passed.

**Step 3: `git status`**

---

## Task 3: Thread `theme` into graph `exportPngDataUrl`

**Files:**
- Modify: `frontend/src/hooks/useCytoscape.ts`

**Context:** Today the function takes no arguments and is hard-coded to dark (`bg: '#0B1220'`). After this task, it accepts `theme: ExportTheme` defaulting to `'dark'` and applies theme-specific overrides to edges and parent compound nodes during the existing batch.

**Step 1: Edit the imports**

Add at the top of the file (next to existing imports):

```typescript
import { EXPORT_THEMES, type ExportTheme } from '@/lib/exportTheme';
```

**Step 2: Update the function signature and body**

Locate `const exportPngDataUrl = useCallback(async (): Promise<string> => {` (around line 151).

Change the signature to:

```typescript
const exportPngDataUrl = useCallback(async (theme: ExportTheme = 'dark'): Promise<string> => {
  const cy = cyRef.current;
  if (!cy) throw new Error('Cytoscape not initialized');
  const palette = EXPORT_THEMES[theme];
```

Inside the `cy.batch(() => { ... })` for edges, **add** the theme color/bg overrides to the existing `e.style({...})` call:

```typescript
e.style({
  'font-size': '14px',
  'font-weight': 'normal',
  'line-height': 1.5,
  'text-background-padding': '5px',
  'text-margin-y': -14,
  'color': palette.edgeLabelColor,
  'text-background-color': palette.edgeLabelBgColor,
});
```

In the same `cy.batch()`, **add a third forEach** for parent compounds. **Use a separate `styledParentIds` array** so the restore pass doesn't strip parent-only bypasses from leaf nodes (and vice-versa):

```typescript
const styledParentIds: string[] = [];
// ...
cy.nodes(':parent').forEach((p) => {
  p.style({
    'background-opacity': palette.parentBackgroundOpacity,
    'border-opacity': palette.parentBorderOpacity,
  });
  styledParentIds.push(p.id());
});
```

Update the restore block with **three separate loops** — one per styled set, each stripping only the props that group actually had bumped:

```typescript
styledEdgeIds.forEach((id) => {
  cy.getElementById(id).removeStyle(
    'font-size font-weight line-height text-background-padding text-margin-y color text-background-color'
  );
});
styledNodeIds.forEach((id) => {
  cy.getElementById(id).removeStyle('font-size line-height');
});
styledParentIds.forEach((id) => {
  cy.getElementById(id).removeStyle('background-opacity border-opacity');
});
```

Note: Cytoscape's `removeStyle()` accepts space-separated property lists (undocumented but it's the existing pattern in this file). Don't "fix" the spacing — it works.

Update the cy.png call (keep scale at 2 — we lost the memory pressure when graph PDF moved to pdf-lib):

```typescript
dataUrl = cy.png({ full: true, scale: 2, bg: palette.pngBackground });
```

**Step 3: Update `exportImage`**

Change signature to thread theme through:

```typescript
const exportImage = useCallback(
  async (format: 'png' | 'pdf', filename = 'graph', theme: ExportTheme = 'dark') => {
    const dataUrl = await exportPngDataUrl(theme);
    // ... unchanged body
  },
  [exportPngDataUrl],
);
```

**Step 4: Type-check**

Run from `frontend/`: `npx tsc --noEmit`
Expected: exit 0.

**Step 5: `git status`**

---

## Task 4: Re-expose themed export via `GraphCanvas`

**Files:**
- Modify: `frontend/src/components/Graph/GraphCanvas.tsx`

**Step 1: Edit the handle type**

```typescript
import type { ExportTheme } from '@/lib/exportTheme';

export interface GraphCanvasHandle {
  unselectAll: () => void;
  exportImage: (format: 'png' | 'pdf', filename?: string, theme?: ExportTheme) => Promise<void>;
  exportPngDataUrl: (theme?: ExportTheme) => Promise<string>;
  setEdgeArc: (edgeId: string, delta: number | null) => void;
}
```

The implementation body remains unchanged — `useCytoscape` already returns the themed functions; `useImperativeHandle` just forwards them.

**Step 2: Type-check**

Run from `frontend/`: `npx tsc --noEmit`
Expected: exit 0.

**Step 3: `git status`**

---

## Task 5: `ExportPreview` component

**Files:**
- Create: `frontend/src/components/Common/ExportPreview.tsx`

**Context:** A reusable preview pane. Caller passes an async `generate(theme)` function; component invokes it, displays the resulting PNG, and caches per-theme so toggling is instant after first render.

**Step 1: Write the component**

```typescript
'use client';
import { useEffect, useRef, useState } from 'react';
import { FaSpinner } from 'react-icons/fa6';
import type { ExportTheme } from '@/lib/exportTheme';

interface Props {
  theme: ExportTheme;
  generate: (theme: ExportTheme) => Promise<string>;
}

export function ExportPreview({ theme, generate }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Partial<Record<ExportTheme, string>>>({});
  const reqIdRef = useRef(0);

  useEffect(() => {
    const cached = cacheRef.current[theme];
    if (cached) {
      setDataUrl(cached);
      setError(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    generate(theme)
      .then((url) => {
        if (reqId !== reqIdRef.current) return; // stale
        cacheRef.current[theme] = url;
        setDataUrl(url);
      })
      .catch((err) => {
        if (reqId !== reqIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Preview failed');
      })
      .finally(() => {
        if (reqId !== reqIdRef.current) return;
        setLoading(false);
      });
  }, [theme, generate]);

  return (
    <div className="flex h-full w-full items-center justify-center rounded border border-line-strong bg-surface overflow-hidden">
      {loading && (
        <div className="flex flex-col items-center gap-2 text-ink-muted text-xs">
          <FaSpinner className="animate-spin" />
          <span>Rendering preview…</span>
        </div>
      )}
      {!loading && error && (
        <div className="px-4 text-center text-xs text-red-300">Preview failed: {error}</div>
      )}
      {!loading && !error && dataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="Export preview" className="max-h-full max-w-full object-contain" />
      )}
    </div>
  );
}
```

**Step 2: Type-check**

Run from `frontend/`: `npx tsc --noEmit`
Expected: exit 0.

**Step 3: Write a cache-hit test**

Create `frontend/src/components/Common/ExportPreview.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { ExportPreview } from './ExportPreview';

describe('ExportPreview', () => {
  it('caches per-theme — generate is invoked once per theme even when re-rendered with same theme', async () => {
    const generate = jest.fn().mockResolvedValue('data:image/png;base64,xxx');
    const { rerender } = render(<ExportPreview theme="dark" generate={generate} />);
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    rerender(<ExportPreview theme="dark" generate={generate} />);
    await waitFor(() => screen.getByAltText('Export preview'));
    expect(generate).toHaveBeenCalledTimes(1); // cache hit, no re-call
  });
});
```

If `@testing-library/react` isn't installed, install it: `npm i -D @testing-library/react @testing-library/dom` from `frontend/`. If the project already has it, skip.

Run: `npx jest src/components/Common/ExportPreview.test.tsx`
Expected: 1 passed.

**Step 4: `git status`**

---

## Task 6: Redesign `ExportModal` — side-by-side + theme toggle

**Files:**
- Modify: `frontend/src/components/Common/ExportModal.tsx`

**Context:** The modal becomes wider (~960px). Left column = existing filename/format controls + a new theme segmented toggle. Right column = `ExportPreview` for `graph`/`chart` kinds only; for other kinds the right column is empty (or the modal stays narrow).

**Step 1: Update the props**

Add optional `previewGenerate` prop. When provided AND `kind` is `graph` or `chart`, the modal renders the preview pane. The `onExport` callback signature gains a `theme` parameter.

```typescript
import type { ExportTheme } from '@/lib/exportTheme';
import { ExportPreview } from './ExportPreview';

// ...

interface Props {
  open: boolean;
  onClose: () => void;
  kind: ExportKind;
  defaultFilename: string;
  onExport: (format: ExportFormat, filename: string, theme: ExportTheme) => Promise<void>;
  previewGenerate?: (theme: ExportTheme) => Promise<string>;
}
```

**Step 2: Add theme state**

Inside the component, alongside existing state:

```typescript
const [theme, setTheme] = useState<ExportTheme>('dark');

useEffect(() => {
  if (open) {
    setFormat(formats[0]);
    setStem(sanitize(defaultFilename));
    setError(null);
    setBusy(false);
    setTheme('dark'); // reset to dark each open (per-session)
  }
}, [open, kind, defaultFilename]);
```

**Step 3: Pass theme to `onExport`**

```typescript
const submit = async () => {
  setBusy(true);
  setError(null);
  try {
    await onExport(format, sanitize(stem), theme);
    onClose();
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Export failed');
  } finally {
    setBusy(false);
  }
};
```

**Step 4: Layout — side-by-side when preview is available**

Replace the existing outer panel with:

```tsx
const showPreview = !!previewGenerate && (kind === 'graph' || kind === 'chart');

return (
  <div
    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
  >
    <div className={`bg-surface-panel rounded-lg p-6 ${showPreview ? 'w-[960px] h-[620px]' : 'w-[460px]'}`}>
      <h3 className="text-sm font-semibold text-ink-muted uppercase mb-5">{title}</h3>

      <div className={showPreview ? 'grid grid-cols-[440px_1fr] gap-6 h-[calc(100%-60px)]' : ''}>
        <div className={showPreview ? 'flex flex-col' : ''}>
          {/* existing filename + format controls go here, unchanged */}

          {/* new theme toggle, shown only when preview is available */}
          {showPreview && (
            <>
              <label className="block text-xs text-ink-muted mb-2">Theme</label>
              <div className="flex gap-2 mb-5">
                {(['dark', 'light'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    disabled={busy}
                    className={`flex-1 px-3 py-2 rounded text-sm transition-colors ${
                      theme === t ? 'bg-brand text-white' : 'bg-surface-raised hover:bg-surface-raised/80 text-ink-muted'
                    }`}
                  >
                    {t === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </>
          )}

          {error && (/* unchanged error pill */)}

          <div className="flex justify-end gap-2 mt-auto">
            {/* unchanged cancel + export buttons */}
          </div>
        </div>

        {showPreview && (
          <ExportPreview theme={theme} generate={previewGenerate!} />
        )}
      </div>
    </div>
  </div>
);
```

When `showPreview` is false (report/chronology/exhibit callers), the modal stays narrow at 460px with the original layout — only the `previewGenerate` prop is omitted by those callers.

**Step 5: Type-check**

Run from `frontend/`: `npx tsc --noEmit`
Expected: exit 0.

**Notes for the implementer:**
- Keep the existing inline error pill behavior intact.
- The `mt-auto` on the button row + flex column on the controls column makes buttons stick to the bottom of the panel for visual balance.
- `previewGenerate` is intentionally optional so non-preview callers (productions report, exhibit) compile without changes.

**Step 6: `git status`**

---

## Task 7: Wire graph export — investigations page

**Files:**
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Context:** The existing `onExport` callback ignores theme; the `ExportModal` for graph kind didn't pass `previewGenerate`. Add both.

**Step 1: Memoize the preview generator**

`ExportPreview` re-runs its effect whenever the `generate` prop's identity changes. Wrap in `useCallback` so the same investigation produces a stable generator and the cache works:

```tsx
const previewGenerate = useCallback(async (theme: ExportTheme) => {
  if (!graphRef.current) throw new Error('Graph not ready');
  return graphRef.current.exportPngDataUrl(theme);
}, []); // graphRef.current is a ref, not a dep
```

Add the import:

```typescript
import type { ExportTheme } from '@/lib/exportTheme';
```

**Step 2: Update the `ExportModal` usage**

```tsx
<ExportModal
  open={exportModalOpen}
  onClose={() => setExportModalOpen(false)}
  kind="graph"
  defaultFilename={investigation?.name ?? 'graph'}
  previewGenerate={previewGenerate}
  onExport={async (format, filename, theme) => {
    if (format !== 'png' && format !== 'pdf') return;
    try {
      await graphRef.current?.exportImage(format, filename, theme);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    }
  }}
/>
```

**Step 2: Type-check + run app**

Run from `frontend/`: `npx tsc --noEmit`
Expected: exit 0.

**Step 3: Manual smoke test**

Run `npm run fe` from repo root, open an investigation, click Export. Verify:
- Preview pane appears (dark by default).
- Toggling Light re-renders preview within ~1s.
- PNG export with Light produces a white-background PNG with dark edge labels.
- PDF export with Light produces a one-page PDF with the light-themed graph.

**Step 4: `git status`**

---

## Task 8: Chart palette — themed options

**Files:**
- Modify: `frontend/src/lib/chartPalette.ts`

**Context:** Today `BRAND_CHART_OPTIONS` is a single dark-only constant. Replace it with a function `getBrandChartOptions(theme)`. Keep `BRAND_SERIES_COLORS` and `applyBrandColors` identical.

**Step 1: Replace the constant with a function**

Delete the `BRAND_CHART_OPTIONS` export. Add:

```typescript
import type { ExportTheme } from './exportTheme';

const CHART_CHROME_BY_THEME: Record<ExportTheme, {
  legend: string;
  tick: string;
  grid: string;
}> = {
  dark: {
    legend: BRAND_PALETTE.inkMuted,
    tick: BRAND_PALETTE.inkFaint,
    grid: BRAND_PALETTE.line,
  },
  light: {
    legend: '#374151',
    tick: '#6b7280',
    grid: '#e5e7eb',
  },
};

export function getBrandChartOptions(theme: ExportTheme = 'dark') {
  const c = CHART_CHROME_BY_THEME[theme];
  return {
    plugins: {
      legend: {
        labels: {
          color: c.legend,
          font: { family: FONT_SANS, size: 11 },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: c.tick, font: { family: FONT_MONO, size: 10 } },
        grid: { color: c.grid },
      },
      y: {
        ticks: { color: c.tick, font: { family: FONT_MONO, size: 10 } },
        grid: { color: c.grid },
      },
    },
  };
}
```

Note: no `as const`. The original constant had `as const` because it was a static value; now that it's a function return, `as const` would make the nested objects readonly tuples and break the spread merge in `ChartViewer`.

**Step 2: Write a test**

Append to (or create) `frontend/src/lib/chartPalette.test.ts`:

```typescript
import { getBrandChartOptions } from './chartPalette';

describe('getBrandChartOptions', () => {
  it('dark and light produce different chrome colors', () => {
    const d = getBrandChartOptions('dark');
    const l = getBrandChartOptions('light');
    expect(d.scales.x.grid.color).not.toBe(l.scales.x.grid.color);
    expect(d.scales.x.ticks.color).not.toBe(l.scales.x.ticks.color);
    expect(d.plugins.legend.labels.color).not.toBe(l.plugins.legend.labels.color);
  });

  it('light grid color is bright (contrasts against white bg)', () => {
    const l = getBrandChartOptions('light');
    expect(l.scales.x.grid.color).toBe('#e5e7eb');
  });
});
```

Run: `npx jest src/lib/chartPalette.test.ts`
Expected: 2 passed.

**Step 3: Update callers**

Run from `frontend/`: `grep -rn "BRAND_CHART_OPTIONS" src/`

Expected: exactly one match in `ChartViewer.tsx`. Task 9 updates it. For now, the type-check will be red — that's expected until Task 9 lands. **Don't run `tsc` between Task 8 and Task 9** — those are intentionally a paired change.

**Step 4: `git status`**

---

## Task 9: `ChartViewer` accepts `theme` prop

**Files:**
- Modify: `frontend/src/components/Productions/ChartViewer.tsx`

**Step 1: Update the import**

Change:

```typescript
import { applyBrandColors, BRAND_CHART_OPTIONS } from '@/lib/chartPalette';
```

to:

```typescript
import { applyBrandColors, getBrandChartOptions } from '@/lib/chartPalette';
import type { ExportTheme } from '@/lib/exportTheme';
```

**Step 2: Add `theme` prop**

In the `ChartViewer` props interface, add `theme?: ExportTheme`. Default to `'dark'`. Inside the component, replace `BRAND_CHART_OPTIONS` with `getBrandChartOptions(theme)`. The merged options block passed to the chart becomes:

```typescript
const options = {
  ...getBrandChartOptions(theme),
  ...(data.options ?? {}),
};
```

(If options are merged differently in the existing file, preserve that structure but swap the constant for the call.)

**Step 3: Type-check**

Run from `frontend/`: `npx tsc --noEmit`
Expected: exit 0.

**Step 4: `git status`**

---

## Task 10: `useChartSnapshot` accepts `theme` and `height`

**Files:**
- Modify: `frontend/src/hooks/useChartSnapshot.ts`

**Context:** Today the off-screen container is fixed at `width:1000px;height:600px`. We need callers to control the height so a user-resized chart in `ProductionViewer` (Q2 decision) exports at the size they see. Width stays fixed at 1000 — Chart.js handles aspect changes within that.

**Step 1: Update signature**

```typescript
import type { ExportTheme } from '@/lib/exportTheme';

// ...

const snapshot = useCallback(async (
  chartData: any,
  theme: ExportTheme = 'dark',
  height: number = 600,
): Promise<string> => {
  // ... existing teardown unchanged
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:-10000px;top:0;width:1000px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(el);
  // ... existing body unchanged until the render call
  rootRef.current!.render(createElement(ChartViewer, { data: snapshotData, theme }));
  // ...
```

**Step 2: Type-check**

Run from `frontend/`: `npx tsc --noEmit`
Expected: exit 0.

**Step 3: `git status`**

---

## Task 11: Wire chart export — `ProductionViewer`

**Files:**
- Modify: `frontend/src/components/Productions/ProductionViewer.tsx`

**Context:** For chart productions, plumb `previewGenerate` and pass `theme` through to the canvas snapshot. The live `<ChartViewer>` in the page remains dark — only export-time snapshots get themed.

**Step 1: Import `useChartSnapshot`**

```typescript
import { useChartSnapshot } from '@/hooks/useChartSnapshot';
```

Inside the component, near other hooks:

```typescript
const { snapshot: snapshotChart, dispose: disposeChart } = useChartSnapshot();
useEffect(() => () => disposeChart(), [disposeChart]);
```

**Step 2: Update `handleExport` to accept theme and use snapshot with user's height**

The user's current chart height in the viewer is `liveChartHeight ?? storedChartHeight` (existing pattern at line 105 / 299). Pass it to `snapshotChart` so the export matches what they see.

```typescript
const currentChartHeight = liveChartHeight ?? storedChartHeight;

const handleExport = useCallback(
  async (format: ExportFormat, filename: string, theme: ExportTheme) => {
    if (production.type === 'chart' && format === 'png') {
      const url = await snapshotChart(production.data, theme, currentChartHeight);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.png`;
      a.click();
      return;
    }
    let imageDataUrl: string | undefined;
    if (production.type === 'chart' && format === 'pdf') {
      imageDataUrl = await snapshotChart(production.data, theme, currentChartHeight);
    }
    await apiClient.exportProduction(production.id, format, filename, imageDataUrl);
  },
  [production.id, production.type, production.data, snapshotChart, currentChartHeight],
);
```

Add the import:

```typescript
import type { ExportTheme } from '@/lib/exportTheme';
```

**Step 3: Memoize `previewGenerate` and pass to `ExportModal`**

```tsx
const previewGenerate = useCallback(
  (theme: ExportTheme) => snapshotChart(production.data, theme, currentChartHeight),
  [snapshotChart, production.data, currentChartHeight],
);

// ...

<ExportModal
  open={exportOpen}
  onClose={() => setExportOpen(false)}
  kind={production.type as 'chart' | 'report' | 'chronology'}
  defaultFilename={production.name}
  onExport={handleExport}
  previewGenerate={production.type === 'chart' ? previewGenerate : undefined}
/>
```

**Step 4: Type-check + smoke test**

Run from `frontend/`: `npx tsc --noEmit`
Expected: exit 0.

Then `npm run fe`, open a chart production, click Export. Verify:
- Preview renders.
- Toggling Light re-renders chart with dark axes/grid on white bg.
- Series colors remain identical between themes.

**Step 5: `git status`**

---

## Task 12: Exhibit builder per-item theme picker

**Files:**
- Modify: `frontend/src/components/Productions/ExhibitBuilder.tsx`

**Context:** Each exhibit item that is a graph or chart gets a per-item theme picker (dark/light). No preview pane. At export time, when generating `imageDataUrl` for graph and chart items, the chosen theme is passed to the snapshot calls.

**Step 1: Read the existing item structure**

Run: `grep -n "ItemRef\|_displayType\|items\b" frontend/src/components/Productions/ExhibitBuilder.tsx | head -30`

The actual item-state field for type discrimination is **`_displayType: string`** (NOT `productionType`). Possible values: `'investigation' | 'report' | 'chronology' | 'chart'`. Use this for the picker gate.

Add an optional `theme?: ExportTheme` field to the item state shape. Default to `'dark'` for new items.

**Step 2: Add the picker UI**

In the per-item row render, add a compact two-button toggle for items where `item._displayType === 'investigation'` OR `item._displayType === 'chart'`. Reports and chronologies don't get the toggle.

```tsx
{(item._displayType === 'investigation' || item._displayType === 'chart') && (
  <div className="flex items-center gap-1.5 text-xs">
    <span className="text-ink-faint">Theme:</span>
    {(['dark', 'light'] as const).map((t) => (
      <button
        key={t}
        onClick={() => updateItem(item.id, { theme: t })}
        className={`px-2 py-1 rounded text-[11px] ${
          (item.theme ?? 'dark') === t
            ? 'bg-brand text-white'
            : 'bg-surface-raised hover:bg-surface-raised/80 text-ink-muted'
        }`}
      >
        {t === 'dark' ? 'Dark' : 'Light'}
      </button>
    ))}
  </div>
)}
```

(`updateItem` is whatever existing helper edits an item in the list — use the actual name from the file.)

**Step 3: Pass theme to snapshot calls at export time**

Find where the builder iterates items to produce `imageDataUrl`s before calling `apiClient.exportExhibit`.

- **Graph items:** `await snapshotGraph(investigation, item.theme ?? 'dark')`
- **Chart items:** Need the production's stored chart height. Read it from the loaded production record (likely `production.data.storedChartHeight` or wherever the value persists today — confirm via grep on `storedChartHeight` in `ProductionViewer.tsx` and trace where it's saved). Pass: `await snapshotChart(production.data, item.theme ?? 'dark', production.data.chartHeight ?? 600)`.

**Step 4: Type-check + smoke test**

Run from `frontend/`: `npx tsc --noEmit`
Expected: exit 0.

Then `npm run fe`, build an exhibit with a graph item + a chart item, toggle each item's theme to a different value, export. Verify:
- The exported exhibit PDF shows each item in its chosen theme.
- The graph item respects its theme. The chart item respects its theme and uses the production's saved height.

**Step 5: `git status`**

---

## Task 13: `useGraphSnapshot` accepts `theme`

**Files:**
- Modify: `frontend/src/hooks/useGraphSnapshot.ts`

**Context:** Task 12's exhibit builder change calls `snapshotGraph(investigation, theme)`. The hook today takes only an investigation. Thread `theme` through to the imperative handle's `exportPngDataUrl`.

**Step 1: Update signature**

```typescript
import type { ExportTheme } from '@/lib/exportTheme';

// ...

const snapshot = useCallback(
  async (investigation: Investigation, theme: ExportTheme = 'dark'): Promise<string> => {
    // ... existing teardown + mount unchanged
    // In the tryCapture callback's success branch, change:
    const dataUrl = await handleRef.current.exportPngDataUrl(theme);
    // ... rest unchanged
  },
  [],
);
```

**Step 2: Type-check**

Run from `frontend/`: `npx tsc --noEmit`
Expected: exit 0.

**Step 3: `git status`**

---

## Final verification checklist

**Compilation red windows during execution:**
- Tasks 8 → 9 are a paired change (the renamed export from chartPalette.ts breaks ChartViewer.tsx until both land). Do not run `tsc` between Task 8 and Task 9; run it at the end of Task 9 instead.
- All other tasks should leave the tree in a compiling state.

After all 13 tasks land, run:

```bash
cd /Users/Sam/Work/Incite/dev/daubert/frontend
npx tsc --noEmit
npm test
```

Expected:
- `tsc` exits 0
- Jest passes (the existing `cytoscapeSync.test.ts` + the new `exportTheme.test.ts` should both be green)

Then a manual QA pass:

| Surface | Action | Expected |
|---------|--------|----------|
| Investigation graph export | Open Export, default theme | Dark preview, dark PNG/PDF |
| Investigation graph export | Toggle to Light | Light preview within ~1s, light PNG/PDF on export |
| Chart production export | Open Export, default theme | Dark preview, dark PNG/PDF |
| Chart production export | Toggle to Light | Light preview, light PNG/PDF |
| Report production export | Open Export | Narrow modal, no preview, no theme toggle |
| Exhibit builder | Add graph + chart, set graph to Light and chart to Dark | Per-item picker visible, exhibit PDF contains light graph and dark chart |

`git status` — review the full working-tree diff, do not commit (the user commits when satisfied).
