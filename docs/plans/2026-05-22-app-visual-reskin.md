# App Visual Reskin — Brand Alignment with website-daubert

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reskin the dark Daubert app to match the editorial-premium brand of `website-daubert` — navy/teal accents, Inter + JetBrains Mono typography, three-tier surface hierarchy, and mono uppercase section labels — without changing any product behavior.

**Architecture:** Introduce a CSS-variable design-token foundation in `globals.css`, expose those tokens as semantic Tailwind colors/fonts in `tailwind.config.js`, then migrate the highest-visibility surfaces (layout, header, sidebar, chart, chat panel) to use the new tokens. Long-tail hardcoded `gray-*` classes get a mechanical sweep at the end. The chart color story is fixed at the root: the backend prompt stops dictating colors and the frontend palette becomes authoritative. No new components, no behavior changes.

**Tech Stack:** Next.js 14 App Router, Tailwind CSS, `next/font` (Inter + JetBrains Mono), Chart.js, React 18.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `frontend/src/app/globals.css` | Modify | Add brand design tokens (CSS vars) — single source of truth for colors, fonts, surfaces |
| 2 | `frontend/tailwind.config.js` | Modify | Expose semantic Tailwind classes (`bg-surface`, `bg-surface-panel`, `text-ink`, `border-line`, `font-mono`, `text-brand`, `text-accent`) so JSX can adopt the tokens |
| 3 | `frontend/src/app/layout.tsx` | Modify | Load Inter + JetBrains Mono via `next/font`, set body to brand tokens — establishes the type/color baseline app-wide |
| 4 | `frontend/src/components/Header.tsx` | Modify | App header: brand panel surface, mono uppercase case label, tighter scale — first surface user sees |
| 5 | `frontend/src/components/InvestigationsSidebar.tsx` | Modify | Sidebar: section labels in mono caps, brand-soft active state with inset brand rail (no layout shift), no more pure gray |
| 6 | `frontend/src/lib/chartPalette.ts` | Create | Centralized brand palette + Chart.js base options (authoritative — overrides caller-supplied colors) |
| 7 | `backend/src/prompts/investigator.ts` | Modify | Remove instruction telling the LLM to emit `backgroundColor`/`borderColor` — frontend owns chart colors now |
| 8 | `backend/src/skills/productions.md` | Modify | Same rationale: strip color guidance from the production-skill examples |
| 9 | `frontend/src/components/ChartViewer.tsx` | Modify | Strip caller-provided colors and apply brand palette + ink/line/mono token-driven axes |
| 10 | `frontend/src/components/AIChat.tsx` | Modify | Chat panel: surface tokens, mono code chips, scoped `text-white` swap (preserve destructive contrast) |
| 11 | `frontend/src/components/{DetailsPanel, FloatingPanel, SidePanel, StagingPanel, FetchModal, ExportModal, ConfirmDeleteModal, NewPrimaryModal, InvestigationForm, TraceForm, WalletForm, TransactionForm, QuickAddInput, UserMenu, CanvasToolPill, TraceList, Loader, BatchEditPanel, EdgeBatchPanel, ContextMenu, CitationPicker, ChronologyTable, ColorPicker, FetchHistoryPanel, ReportEditor, ScriptsPanel, TagInput, ProductionViewer, ChainSelect}.tsx` | Modify | Mechanical sweep to semantic tokens for visual consistency across the long tail of components |

---

## Brand Token Reference (used by all tasks)

These hex values are derived from `website-daubert/src/app/globals.css`, dark-shifted where needed so they read on a dark canvas. **Do not invent or adjust these — copy them verbatim.**

| Token | Hex | Notes |
|---|---|---|
| `--ink` | `#E6EAF2` | Primary text |
| `--ink-muted` | `#9AA3B2` | Secondary text |
| `--ink-faint` | `#5B6473` | Tertiary text / labels |
| `--surface` | `#0B1220` | Canvas (same hex as website `--color-ink` — intentional symmetry) |
| `--surface-panel` | `#111827` | One tier above canvas (sidebar, header, chat) |
| `--surface-raised` | `#1A2235` | Two tiers above (chips, code blocks, hover-states-on-panel) |
| `--line` | `#1F2937` | Hairline borders |
| `--line-strong` | `#2A364E` | Stronger dividers (section separators) |
| `--brand` | `#4F6FD8` | Lifted website `--color-brand` for dark readability |
| `--brand-soft` | `#1F2A4A` | Active-state background |
| `--accent` | `#2DD4D2` | Lifted website `--color-accent` |

**Naming note:** the color key is `surface` (not `bg`) so classes read as `bg-surface-panel`, `border-surface-raised`, etc. — natural English, no `bg-bg-*` doubling.

---

### Task 1: Add design tokens to `globals.css`

**Files:**
- Modify: `frontend/src/app/globals.css`

**Step 1: Replace file contents**

Replace the entire contents of `frontend/src/app/globals.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    color-scheme: dark;

    --ink: #E6EAF2;
    --ink-muted: #9AA3B2;
    --ink-faint: #5B6473;

    --surface: #0B1220;
    --surface-panel: #111827;
    --surface-raised: #1A2235;

    --line: #1F2937;
    --line-strong: #2A364E;

    --brand: #4F6FD8;
    --brand-soft: #1F2A4A;
    --accent: #2DD4D2;
  }

  html, body {
    background: var(--surface);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }

  ::selection {
    background: var(--brand);
    color: white;
  }
}

@keyframes breathing {
  0%, 100% { opacity: 0.55; transform: scale(0.98); }
  50%      { opacity: 1;    transform: scale(1.02); }
}

@keyframes dotFade {
  0%, 80%, 100% { opacity: 0; }
  40%           { opacity: 1; }
}
```

`color-scheme: dark` themes native form controls and scrollbars. `tabular-nums` matches the website's numeric rhythm. `font-feature-settings` is deliberately omitted — the website doesn't use stylistic sets and we shouldn't either.

**Step 2: Build to confirm no CSS errors**

Run: `cd frontend && npm run build`
Expected: completes without CSS parse errors. (TypeScript may complain about unrelated files — only CSS errors are a blocker for this task.)

**Step 3: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "feat(frontend): add brand design tokens to globals.css"
```

---

### Task 2: Expose tokens as Tailwind semantic classes

**Files:**
- Modify: `frontend/tailwind.config.js`

**Step 1: Replace file contents**

Replace the entire contents of `frontend/tailwind.config.js` with:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
        },
        surface: {
          DEFAULT: 'var(--surface)',
          panel: 'var(--surface-panel)',
          raised: 'var(--surface-raised)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          soft: 'var(--brand-soft)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
```

**Step 2: Build to confirm Tailwind picks up the new classes**

Run: `cd frontend && npm run build`
Expected: build succeeds. The new classes (`bg-surface`, `bg-surface-panel`, `text-ink`, `border-line`, `border-line-strong`, `text-brand`, `bg-brand-soft`, etc.) are now valid Tailwind utilities even though nothing uses them yet.

**Step 3: Commit**

```bash
git add frontend/tailwind.config.js
git commit -m "feat(frontend): expose brand tokens as semantic Tailwind classes"
```

---

### Task 3: Wire Inter + JetBrains Mono and switch body to tokens

**Files:**
- Modify: `frontend/src/app/layout.tsx`

**Step 1: Replace file contents**

Replace the entire contents of `frontend/src/app/layout.tsx` with:

```tsx
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Daubert',
  description: 'The ai platform for tech experts',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="bg-surface text-ink font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

**Step 2: Start the dev server and verify fonts load**

Run (from repo root, in a separate terminal): `npm run fe`
Expected: dev server starts on http://localhost:3001 with no font-loading errors.

**Step 3: Visual check**

Open http://localhost:3001 in a browser. Inspect any text element in DevTools. Expected: `font-family` resolves to a string containing `__Inter_` (Next.js font hash). Body background is `#0B1220`. No console errors.

**Step 4: Commit**

```bash
git add frontend/src/app/layout.tsx
git commit -m "feat(frontend): load Inter + JetBrains Mono and apply brand body tokens"
```

---

### Task 4: Reskin `Header.tsx`

**Files:**
- Modify: `frontend/src/components/Header.tsx`

**Step 1: Replace file contents**

Replace the entire contents of `frontend/src/components/Header.tsx` with:

```tsx
'use client';

import { FaDownload } from 'react-icons/fa6';
import { Investigation, WalletNode, TransactionEdge } from '../types/investigation';
import { QuickAddInput } from './QuickAddInput';

interface HeaderProps {
  investigation: Investigation | null;
  onResolveAddress: (prefill: Partial<WalletNode>) => void;
  onResolveTransaction: (prefill: Partial<TransactionEdge>) => void;
  onExportClick: () => void;
  rightContent?: React.ReactNode;
}

export function Header({
  investigation,
  onResolveAddress,
  onResolveTransaction,
  onExportClick,
  rightContent,
}: HeaderProps) {
  return (
    <header className="bg-surface-panel border-b border-line h-12 px-4 flex items-center justify-between gap-4">
      <div className="flex items-baseline gap-3 shrink-0 min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          Investigation
        </span>
        <h1 className="text-[15px] font-semibold tracking-tight text-ink truncate">
          {investigation?.name || 'Daubert'}
        </h1>
      </div>

      <div className="flex-1 max-w-[640px] min-w-[260px]">
        {investigation && (
          <QuickAddInput
            investigationId={investigation.id}
            onResolveAddress={onResolveAddress}
            onResolveTransaction={onResolveTransaction}
          />
        )}
      </div>

      <div className="flex gap-2 items-center shrink-0">
        <button
          onClick={onExportClick}
          className="px-3 h-8 bg-surface-raised hover:bg-line border border-line hover:border-line-strong text-ink-muted hover:text-ink rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
        >
          <FaDownload size={11} /> Export
        </button>
        {rightContent}
      </div>
    </header>
  );
}
```

**Step 2: Visual check**

Dev server still running. Navigate to any case investigation page. Expected:
- Header height is 48px (was 64px).
- "INVESTIGATION" label in mono uppercase, faint.
- Investigation name in tight semibold ink.
- Export button is surface-raised with hairline border.

**Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: passes.

**Step 4: Commit**

```bash
git add frontend/src/components/Header.tsx
git commit -m "feat(frontend): reskin Header to brand tokens"
```

---

### Task 5: Reskin `InvestigationsSidebar.tsx`

**Files:**
- Modify: `frontend/src/components/InvestigationsSidebar.tsx`

**Critical:** the swap order below matters. The mapping table is sorted longest-string-first so specific patterns are consumed before generic ones, avoiding cross-contamination from `replace_all`. Apply rows top-to-bottom.

**Step 1: Read the current file**

Read `frontend/src/components/InvestigationsSidebar.tsx` in full so the edits have context.

**Step 2: Apply specific (long-context) replacements first**

Apply each of these in order. Each is a single Edit (no `replace_all`):

| # | Old (exact substring) | New |
|---|---|---|
| 5a | `mr-1 shrink-0 transition-colors ${isActive && traces ? 'text-gray-500 hover:text-gray-300' : 'text-gray-600'}` | `mr-1 shrink-0 transition-colors ${isActive && traces ? 'text-ink-faint hover:text-ink-muted' : 'text-ink-faint/60'}` |
| 5b | `px-0.5 text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity` | `px-0.5 text-ink-faint hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity` |
| 5c | `flex items-center ${trace.visible ? 'text-gray-500 hover:text-white' : 'text-gray-700 hover:text-gray-400'}` | `flex items-center ${trace.visible ? 'text-ink-faint hover:text-ink' : 'text-ink-faint/40 hover:text-ink-faint'}` |
| 5d | `flex items-center gap-1.5 pl-3 pr-2 py-1 w-full text-left text-gray-600 hover:text-gray-400 transition-colors` | `flex items-center gap-1.5 pl-3 pr-2 py-1 w-full text-left text-ink-faint/60 hover:text-ink-faint transition-colors` |

**Step 3: Apply generic (short) replacements**

Now run the remaining swaps. Use `replace_all: true` where indicated:

| # | Old | New | `replace_all` |
|---|---|---|---|
| 5e | `w-full bg-gray-800 flex flex-col h-full overflow-hidden` | `w-full bg-surface-panel flex flex-col h-full overflow-hidden` | no |
| 5f | `p-3 border-b border-gray-700 flex items-center gap-2` | `p-3 border-b border-line-strong flex items-center gap-2` | no |
| 5g | `text-gray-400 hover:text-white transition-colors` | `text-ink-faint hover:text-ink transition-colors` | no |
| 5h | `px-3 py-2 flex items-center justify-between border-b border-gray-700` | `px-3 py-2 flex items-center justify-between border-b border-line-strong` | no |
| 5i | `text-xs font-medium text-gray-400 uppercase tracking-wider` | `font-mono text-[10px] text-ink-faint uppercase tracking-[0.14em]` | **yes** |
| 5j | `text-gray-500 hover:text-gray-300 text-xs transition-colors` | `text-ink-faint hover:text-ink text-xs transition-colors` | **yes** |
| 5k | `bg-blue-600/20 text-blue-300` | `bg-brand-soft text-ink shadow-[inset_2px_0_0_var(--brand)]` | **yes** |
| 5l | `hover:bg-gray-700/60 text-gray-300` | `hover:bg-surface-raised text-ink-muted` | no |
| 5m | `hover:bg-gray-700/60 text-gray-400` | `hover:bg-surface-raised text-ink-muted` | **yes** |
| 5n | `ml-3 border-l border-gray-700/70` | `ml-3 border-l border-line` | no |
| 5o | `bg-gray-700 text-white` | `bg-surface-raised text-ink` | no |
| 5p | `hover:bg-gray-700/50 text-gray-400 hover:text-gray-200` | `hover:bg-surface-raised text-ink-muted hover:text-ink` | no |
| 5q | `text-gray-500 text-xs p-3` | `text-ink-faint text-xs p-3` | no |
| 5r | `mt-2 border-t border-gray-700` | `mt-2 border-t border-line-strong` | **yes** |
| 5s | `text-[10px] text-gray-600` | `font-mono text-[10px] text-ink-faint/70 uppercase tracking-wider` | no |
| 5t | `text-gray-600 text-xs px-3 py-1` | `text-ink-faint text-xs px-3 py-1` | no |

**Note on 5k (active row):** the previous version of this plan used a negative-margin trick to position the active rail. That clipped against the sidebar's `overflow-hidden` and was order-dependent. Instead we use `box-shadow` with an inset 2px brand line. Zero layout impact, never clipped, works on any padding.

Leave `text-yellow-500` and `text-green-500` (data-room status colors) as-is — semantic, not chrome. Out of scope for this pass.

**Step 4: Visual check**

Reload the case investigation page. Expected:
- Sidebar background is `surface-panel`.
- Section labels ("INVESTIGATIONS", "PRODUCTIONS", "DATA ROOM") in mono, smaller, wider tracking.
- Active investigation row: `brand-soft` background + a 2px navy rail rendered as an inset shadow on the left. No content shift, no clipping.
- No more `text-blue-300` anywhere in the sidebar.

**Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: passes.

**Step 6: Commit**

```bash
git add frontend/src/components/InvestigationsSidebar.tsx
git commit -m "feat(frontend): reskin InvestigationsSidebar to brand tokens"
```

---

### Task 6: Create centralized chart palette (authoritative)

**Files:**
- Create: `frontend/src/lib/chartPalette.ts`

**Architectural note:** the previous palette draft used `??` so caller-provided colors won. That made the palette a no-op for AI-generated charts (the backend prompt explicitly tells the LLM to emit `backgroundColor`). The fix is two-sided: (a) the prompt stops dictating colors (Tasks 7 + 8), and (b) the palette becomes authoritative and **overrides** any caller-provided color. That's the only way to guarantee brand cohesion across every chart, regardless of who or what produced the dataset.

**Step 1: Create the file**

Write the following to `frontend/src/lib/chartPalette.ts`:

```ts
/**
 * Brand-aligned palette for Chart.js. Hex values mirror the CSS tokens in
 * globals.css; we duplicate them here as JS literals because Chart.js
 * canvas rendering cannot read CSS custom properties.
 *
 * This palette is authoritative: applyBrandColors() overrides any
 * backgroundColor/borderColor the caller supplied. The backend prompt
 * (backend/src/prompts/investigator.ts) no longer dictates colors.
 */

export const BRAND_PALETTE = {
  ink: '#E6EAF2',
  inkMuted: '#9AA3B2',
  inkFaint: '#5B6473',
  line: '#1F2937',
  brand: '#4F6FD8',
  accent: '#2DD4D2',
} as const;

// Ordered series colors. Index 0 is the primary (accent teal — distinct from
// the brand navy used for chrome). Subsequent indices alternate hues with
// enough separation to remain legible on a dark canvas.
export const BRAND_SERIES_COLORS = [
  '#2DD4D2', // accent (teal)
  '#4F6FD8', // brand (navy)
  '#A78BFA', // violet
  '#F472B6', // pink
  '#34D399', // emerald
  '#FBBF24', // amber (last resort)
] as const;

/**
 * Assign brand palette colors to Chart.js datasets, overriding any
 * caller-supplied backgroundColor/borderColor.
 */
export function applyBrandColors<T extends { backgroundColor?: unknown; borderColor?: unknown }>(
  datasets: T[],
): T[] {
  return datasets.map((ds, i) => {
    const color = BRAND_SERIES_COLORS[i % BRAND_SERIES_COLORS.length];
    return {
      ...ds,
      backgroundColor: color,
      borderColor: color,
    };
  });
}

const FONT_SANS = "'Inter', ui-sans-serif, system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * Base Chart.js options block with brand-aligned axes, gridlines, and
 * legend text. Spread this into per-chart options to inherit the look.
 */
export const BRAND_CHART_OPTIONS = {
  plugins: {
    legend: {
      labels: {
        color: BRAND_PALETTE.inkMuted,
        font: { family: FONT_SANS, size: 11 },
      },
    },
  },
  scales: {
    x: {
      ticks: {
        color: BRAND_PALETTE.inkFaint,
        font: { family: FONT_MONO, size: 10 },
      },
      grid: { color: BRAND_PALETTE.line },
    },
    y: {
      ticks: {
        color: BRAND_PALETTE.inkFaint,
        font: { family: FONT_MONO, size: 10 },
      },
      grid: { color: BRAND_PALETTE.line },
    },
  },
} as const;
```

**Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: passes.

**Step 3: Commit**

```bash
git add frontend/src/lib/chartPalette.ts
git commit -m "feat(frontend): add authoritative brand chart palette"
```

---

### Task 7: Strip color guidance from the investigator prompt

**Files:**
- Modify: `backend/src/prompts/investigator.ts`

**Step 1: Read the file**

Open `backend/src/prompts/investigator.ts`. Find the line (around line 48) that begins:

```
- When asked to create a chart, use Chart.js-compatible data: { chartType: "bar"|"line"|"pie"|"doughnut", labels: [...], datasets: [{ label, data, backgroundColor }], ...
```

**Step 2: Edit the schema fragment**

Replace `datasets: [{ label, data, backgroundColor }]` with `datasets: [{ label, data }]` in that line. Also drop any other guidance in the same bullet that tells the model what colors to pick. Do NOT change instructions about chart type, annotations, or options.plugins.annotation.

**Step 3: Verify no remaining color guidance**

Run: `cd backend && grep -n "backgroundColor\|borderColor\|color.*chart\|chart.*color" src/prompts/investigator.ts`
Expected: no matches in dataset/instruction context. (Matches inside unrelated documentation or schemas elsewhere can stay.)

**Step 4: Commit**

```bash
git add backend/src/prompts/investigator.ts
git commit -m "feat(backend): stop dictating chart colors in investigator prompt"
```

---

### Task 8: Strip color examples from the productions skill

**Files:**
- Modify: `backend/src/skills/productions.md`

**Step 1: Read the file**

Open `backend/src/skills/productions.md`. Search for any example dataset that includes `backgroundColor` or `borderColor` (e.g. `"rgba(59, 130, 246, 0.7)"`).

**Step 2: Remove color keys from example datasets**

For every example dataset in the file, delete the `backgroundColor` and `borderColor` properties (and any trailing commas left behind). Leave `label`, `data`, and any other dataset properties intact. If a paragraph explicitly tells the model to pick colors, delete or replace that sentence with: *"Series colors are assigned automatically by the renderer."*

**Step 3: Verify**

Run: `cd backend && grep -n "backgroundColor\|borderColor\|rgba(" src/skills/productions.md`
Expected: no remaining color values in dataset examples.

**Step 4: Commit**

```bash
git add backend/src/skills/productions.md
git commit -m "feat(backend): remove chart color examples from productions skill"
```

---

### Task 9: Wire `ChartViewer.tsx` to brand palette

**Files:**
- Modify: `frontend/src/components/ChartViewer.tsx`

**Step 1: Replace file contents**

Replace the entire contents of `frontend/src/components/ChartViewer.tsx` with:

```tsx
'use client';

import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';
import { applyBrandColors, BRAND_CHART_OPTIONS } from '@/lib/chartPalette';

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend,
  annotationPlugin,
);

interface ChartData {
  chartType: string;
  datasets: any[];
  labels: string[];
  options?: Record<string, unknown>;
}

interface ChartViewerProps {
  data: ChartData;
}

export function ChartViewer({ data }: ChartViewerProps) {
  if (!Array.isArray(data.datasets) || !Array.isArray(data.labels)) {
    return <div className="text-red-400 text-sm">Invalid chart data: datasets and labels must be arrays.</div>;
  }
  const chartData = {
    labels: data.labels,
    datasets: applyBrandColors(data.datasets),
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    ...data.options,
    plugins: {
      ...BRAND_CHART_OPTIONS.plugins,
      ...(data.options?.plugins as any),
    },
    scales: {
      ...BRAND_CHART_OPTIONS.scales,
      ...(data.options?.scales as any),
    },
  };

  switch (data.chartType) {
    case 'bar': return <div className="h-96"><Bar data={chartData} options={options} /></div>;
    case 'line': return <div className="h-96"><Line data={chartData} options={options} /></div>;
    case 'pie': return <div className="h-96"><Pie data={chartData} options={options} /></div>;
    case 'doughnut': return <div className="h-96"><Doughnut data={chartData} options={options} /></div>;
    default: return <div className="text-ink-faint">Unsupported chart type: {data.chartType}</div>;
  }
}
```

**Known limitation:** the options merge is shallow. Nested annotation/legend overrides from the caller will partial-override `BRAND_CHART_OPTIONS`. Acceptable for this pass (the AI is no longer emitting chart-level overrides) — flagged for a future deepMerge follow-up.

**Step 2: Visual check**

Trigger a chart render in the AI chat. Expected:
- Line series renders in teal `#2DD4D2`, not yellow or any other AI-picked color.
- Gridlines are `#1F2937`.
- Axis tick labels render in JetBrains Mono.

**Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: passes.

**Step 4: Commit**

```bash
git add frontend/src/components/ChartViewer.tsx
git commit -m "feat(frontend): wire ChartViewer to authoritative brand palette"
```

---

### Task 10: Reskin `AIChat.tsx` panel chrome

**Files:**
- Modify: `frontend/src/components/AIChat.tsx`

**Scope:** Only the panel chrome (outer container, message bubbles, code blocks, input bar, model selector, conversation list). Do **not** touch any logic, streaming handlers, attachment handling, or markdown rendering.

**Critical scoping rules:**
- The destructive "remove attachment" button at line 260 (`bg-gray-600 hover:bg-red-500 text-white`) must keep `text-white` for legibility on the red hover state. Same for any other class string ending in `bg-red-* text-white`.
- The user-message bubble at line 858 (`bg-blue-600 text-white rounded-2xl rounded-br-md`) does swap to `bg-brand`, and `text-white` should also swap to `text-ink` there (near-white on near-navy reads correctly).
- Therefore: use specific (long-context) `text-white` replacements first, then leave a final scoped pass for the remainder. Do **not** use `replace_all: true` for `text-white`.

**Step 1: Read the file**

Read `frontend/src/components/AIChat.tsx` in full.

**Step 2: Fix the messages-area background (line ~838)**

Find the line:
```tsx
<div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 bg-gray-850 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ backgroundColor: 'rgb(17 24 39 / 0.5)' }}>
```

Replace with:
```tsx
<div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 bg-surface/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
```

(`bg-gray-850` is not a real Tailwind class; the inline style was doing all the work. Token `bg-surface/60` reproduces it cleanly.)

**Step 3: Apply specific destructive-button-preserving swaps**

Apply each as a single Edit (no `replace_all`):

| # | Old | New |
|---|---|---|
| 10a | `bg-gray-600 hover:bg-red-500 text-white` | `bg-surface-raised hover:bg-red-500 text-white` |
| 10b | `bg-blue-600 text-white rounded-2xl rounded-br-md` | `bg-brand text-ink rounded-2xl rounded-br-md` |
| 10c | `prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-table:my-2 prose-pre:my-2 prose-pre:bg-gray-800 prose-pre:text-gray-200 prose-code:text-gray-300 prose-code:before:content-none prose-code:after:content-none prose-a:text-blue-400 prose-strong:text-white prose-td:p-1.5 prose-th:p-1.5` | `prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-table:my-2 prose-pre:my-2 prose-pre:bg-surface-raised prose-pre:text-ink-muted prose-code:text-ink-muted prose-code:before:content-none prose-code:after:content-none prose-a:text-brand prose-strong:text-ink prose-td:p-1.5 prose-th:p-1.5` |

**Step 4: Apply generic surface/text swaps with `replace_all: true`**

Apply each row top-to-bottom. After 10b above consumes the user-message `text-white`, no remaining `text-white` should be swapped — the rest are intentional destructive contrast.

| # | Old | New | `replace_all` |
|---|---|---|---|
| 10d | `bg-gray-900` | `bg-surface` | yes |
| 10e | `bg-gray-800` | `bg-surface-panel` | yes |
| 10f | `bg-gray-700` | `bg-surface-raised` | yes |
| 10g | `border-gray-700` | `border-line-strong` | yes |
| 10h | `border-gray-800` | `border-line` | yes |
| 10i | `text-gray-300` | `text-ink-muted` | yes |
| 10j | `text-gray-400` | `text-ink-muted` | yes |
| 10k | `text-gray-500` | `text-ink-faint` | yes |
| 10l | `text-gray-600` | `text-ink-faint` | yes |
| 10m | `bg-blue-600` | `bg-brand` | yes |
| 10n | `bg-blue-700` | `bg-brand` | yes |
| 10o | `hover:bg-blue-700` | `hover:bg-brand/90` | yes |
| 10p | `text-blue-400` | `text-brand` | yes |
| 10q | `text-blue-300` | `text-brand` | yes |

**Step 5: Confirm `text-white` survivors are intentional**

Run: `cd frontend && grep -n "text-white" src/components/AIChat.tsx`
Expected: every remaining `text-white` is either on a `bg-red-*` button (destructive) or paired with a non-token solid background where white is the correct contrast. If any survivor is on a token background, fix manually.

**Step 6: Verify gray/blue are gone**

Run: `cd frontend && grep -E "gray-[0-9]|blue-[0-9]" src/components/AIChat.tsx`
Expected: no matches.

**Step 7: Visual check**

Open the chat panel on an investigation page. Expected:
- Chat panel sits one tier above the canvas (`surface-panel`), separated by a hairline left border (the existing `border-l border-gray-700` became `border-l border-line-strong`).
- User-message bubbles render with `bg-brand` (navy).
- Inline `code` in markdown renders on `surface-raised`.
- The destructive remove-attachment button still has white text on red hover.

**Step 8: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: passes.

**Step 9: Commit**

```bash
git add frontend/src/components/AIChat.tsx
git commit -m "feat(frontend): reskin AIChat panel chrome to brand tokens"
```

---

### Task 11: Sweep remaining `gray-*` / `blue-600` across components

**Files (all confirmed to contain `gray-*` and/or `blue-600`/`blue-700`):**
- `frontend/src/components/BatchEditPanel.tsx`
- `frontend/src/components/CanvasToolPill.tsx`
- `frontend/src/components/ChainSelect.tsx`
- `frontend/src/components/ChronologyTable.tsx`
- `frontend/src/components/CitationPicker.tsx`
- `frontend/src/components/ColorPicker.tsx`
- `frontend/src/components/ConfirmDeleteModal.tsx`
- `frontend/src/components/ContextMenu.tsx`
- `frontend/src/components/DetailsPanel.tsx`
- `frontend/src/components/EdgeBatchPanel.tsx`
- `frontend/src/components/ExportModal.tsx`
- `frontend/src/components/FetchHistoryPanel.tsx`
- `frontend/src/components/FetchModal.tsx`
- `frontend/src/components/FloatingPanel.tsx`
- `frontend/src/components/InvestigationForm.tsx`
- `frontend/src/components/Loader.tsx`
- `frontend/src/components/NewPrimaryModal.tsx`
- `frontend/src/components/ProductionViewer.tsx`
- `frontend/src/components/QuickAddInput.tsx`
- `frontend/src/components/ReportEditor.tsx`
- `frontend/src/components/ScriptsPanel.tsx`
- `frontend/src/components/SidePanel.tsx`
- `frontend/src/components/StagingPanel.tsx`
- `frontend/src/components/TagInput.tsx`
- `frontend/src/components/TraceForm.tsx`
- `frontend/src/components/TraceList.tsx`
- `frontend/src/components/TransactionForm.tsx`
- `frontend/src/components/UserMenu.tsx`
- `frontend/src/components/WalletForm.tsx`

**Out of scope:** `frontend/src/app/admin/**`, `frontend/src/app/entities/**`, `frontend/src/app/cases/[caseId]/data-room/page.tsx`. These have semantic status colors (yellow/green/red) and need a separate design pass.

**Step 1: Apply the Task 10 mapping per file**

For each file in the list, apply the same mapping table from Task 10 (rows 10d–10q), with the same destructive-contrast rule for `text-white`. Use the per-file workflow:

1. `grep -n "text-white" <file>` first. If matches appear on `bg-red-*` surfaces, plan to skip those.
2. Apply specific (long-context) replacements that protect destructive contrast (analogous to 10a–10c).
3. Apply the generic `replace_all` mappings (10d–10q).
4. `grep -E "gray-[0-9]|blue-[0-9]" <file>` — expect empty.

Skip any class that is part of a semantic status indicator (`text-red-400` for errors, `text-yellow-500` for warnings, `text-green-500` for success). Leave those.

**Step 2: Confirm scope contained**

Run:
```bash
cd frontend && grep -rln "gray-800\|gray-700\|gray-900\|gray-600\|gray-500\|gray-400\|gray-300" src/components/ | grep -v node_modules
```
Expected: empty result, OR only out-of-scope files. If a new file appears, do NOT expand the sweep — note it in the commit message and stop.

**Step 3: Visual smoke test**

Dev server running. Walk through:
- `/cases/<id>/investigations?inv=<id>` (sidebar, header, canvas, chat)
- Open the Export modal
- Open the Fetch modal
- Open the New Investigation modal
- Click a node on the canvas (DetailsPanel)
- Open a Production that contains a chart (ProductionViewer + ChartViewer)
- Open the citations picker, the chronology table, the script run panel

Expected: every panel uses brand tokens. No flashes of old slate gray. No invisible text. Destructive buttons still readable.

**Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: passes.

**Step 5: Build**

Run: `cd frontend && npm run build`
Expected: builds cleanly.

**Step 6: Commit**

```bash
git add frontend/src/components/
git commit -m "feat(frontend): sweep remaining gray/blue classes to brand tokens"
```

---

## Out-of-scope follow-ups (do not address in this plan)

- **Semantic status colors** (`yellow-*` warnings, `green-*` success, `red-*` errors). Need their own tokens (`--status-warn`, `--status-ok`, `--status-error`) tuned for `surface-panel`.
- **Admin pages** (`src/app/admin/**`) — lower brand priority.
- **Data Room page** (`src/app/cases/[caseId]/data-room/page.tsx`) — heavy themed connection-lost UI that needs design input.
- **GraphCanvas / Cytoscape node styling** — node/edge colors live in `useCytoscape.ts` and need a coordinated palette pass.
- **Chart options deepMerge** — current shallow merge in `ChartViewer` is fine now that the prompt no longer dictates options; revisit if nested overrides return.
- **Light mode** — explicit non-goal. Tokens are dark-only by hex.

---

## Final verification before handoff

Before declaring done:

1. `cd frontend && npx tsc --noEmit` passes.
2. `cd frontend && npm run build` passes.
3. `cd backend && npm run build` passes (prompt + skill changes shouldn't break backend types).
4. `git status` is clean (all changes committed).
5. The brand site and the app, side by side, share: navy/teal palette, Inter + JetBrains Mono, hairline borders, mono uppercase section labels, tabular numerals. They should feel like products from the same company.
