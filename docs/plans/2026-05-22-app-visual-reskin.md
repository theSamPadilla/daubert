# App Visual Reskin — Brand Alignment with website-daubert

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reskin the dark Daubert app to match the editorial-premium brand of `website-daubert` — navy/teal accents, Inter + JetBrains Mono typography, three-tier surface hierarchy, and mono uppercase section labels — without changing any product behavior.

**Architecture:** Introduce a CSS-variable design-token foundation in `globals.css`, expose those tokens as semantic Tailwind colors/fonts in `tailwind.config.js`, then migrate the highest-visibility surfaces (layout, header, sidebar, chart, chat panel) to use the new tokens. Long-tail hardcoded `gray-*` classes get a final mechanical sweep at the end. No new components, no behavior changes.

**Tech Stack:** Next.js 14 App Router, Tailwind CSS, `next/font` (Inter + JetBrains Mono), Chart.js, React 18.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `frontend/src/app/globals.css` | Modify | Add brand design tokens (CSS vars) — single source of truth for colors, fonts, surfaces |
| 2 | `frontend/tailwind.config.js` | Modify | Expose semantic Tailwind classes (`bg-bg`, `bg-panel`, `text-ink`, `border-line`, `font-mono`, `text-brand`, `text-accent`) so JSX can adopt the tokens |
| 3 | `frontend/src/app/layout.tsx` | Modify | Load Inter + JetBrains Mono via `next/font`, set body to brand tokens — establishes the type/color baseline app-wide |
| 4 | `frontend/src/components/Header.tsx` | Modify | App header: brand panel surface, mono uppercase case label, tighter scale — first surface user sees |
| 5 | `frontend/src/components/InvestigationsSidebar.tsx` | Modify | Sidebar: section labels in mono caps, brand-soft active state with left brand rail, no more pure gray — editorial sidebar voice |
| 6 | `frontend/src/lib/chartPalette.ts` | Create | Centralized brand palette + Chart.js base options — kills the yellow line problem at the source for every chart in the app |
| 7 | `frontend/src/components/ChartViewer.tsx` | Modify | Wire chart palette + ink/line/mono token-driven axes — every chart inherits brand colors from one place |
| 8 | `frontend/src/components/AIChat.tsx` | Modify | Chat panel: `bg-panel` surface, 1px left `line` border, mono code chips — gives the right rail architectural separation from the canvas |
| 9 | Remaining `gray-*`/`blue-600` classes in `frontend/src/components/*` and `frontend/src/app/**/*.tsx` | Modify | Mechanical sweep to semantic tokens for visual consistency across the long tail of components |

---

## Brand Token Reference (used by all tasks)

These hex values are derived from `website-daubert/src/app/globals.css`, dark-shifted where needed so they read on a dark canvas. **Do not invent or adjust these — copy them verbatim.**

| Token | Hex | Maps to (website) |
|---|---|---|
| `--ink` | `#E6EAF2` | inverse of `--color-ink` on dark |
| `--ink-muted` | `#9AA3B2` | `--color-ink-faint` |
| `--ink-faint` | `#5B6473` | `--color-ink-muted` |
| `--bg` | `#0B1220` | same hex as website `--color-ink` (intentional symmetry) |
| `--bg-panel` | `#111827` | one tier above canvas |
| `--bg-raised` | `#1A2235` | two tiers above (chips, code blocks) |
| `--line` | `#1F2937` | hairline borders |
| `--line-strong` | `#2A364E` | stronger dividers |
| `--brand` | `#4F6FD8` | lifted website `--color-brand` for dark readability |
| `--brand-soft` | `#1F2A4A` | active-state background |
| `--accent` | `#2DD4D2` | lifted website `--color-accent` |

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
    --ink: #E6EAF2;
    --ink-muted: #9AA3B2;
    --ink-faint: #5B6473;

    --bg: #0B1220;
    --bg-panel: #111827;
    --bg-raised: #1A2235;

    --line: #1F2937;
    --line-strong: #2A364E;

    --brand: #4F6FD8;
    --brand-soft: #1F2A4A;
    --accent: #2DD4D2;
  }

  html, body {
    background: var(--bg);
    color: var(--ink);
    font-feature-settings: "ss01", "cv11";
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
        bg: {
          DEFAULT: 'var(--bg)',
          panel: 'var(--bg-panel)',
          raised: 'var(--bg-raised)',
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
Expected: build succeeds. The new classes (`bg-bg`, `bg-panel`, `text-ink`, `border-line`, `text-brand`, etc.) are now valid Tailwind utilities even though nothing uses them yet.

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
      <body className="bg-bg text-ink font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

**Step 2: Start the dev server and verify fonts load**

Run (from repo root, in a separate terminal): `npm run fe`
Expected: dev server starts on http://localhost:3001 with no font-loading errors in the terminal.

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
    <header className="bg-bg-panel border-b border-line h-12 px-4 flex items-center justify-between gap-4">
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
          className="px-3 h-8 bg-bg-raised hover:bg-line border border-line hover:border-line-strong text-ink-muted hover:text-ink rounded-md text-xs font-medium transition-colors flex items-center gap-1.5"
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

Dev server still running from Task 3. Navigate to any case investigation page (e.g. http://localhost:3001/cases/&lt;id&gt;/investigations?inv=&lt;id&gt;). Expected:
- Header height is 48px (was 64px).
- "INVESTIGATION" label in mono uppercase, faint.
- Investigation name in tight semibold ink.
- Export button is `bg-raised` with `border-line`, no longer flat gray.

**Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: passes (no new errors introduced by this file).

**Step 4: Commit**

```bash
git add frontend/src/components/Header.tsx
git commit -m "feat(frontend): reskin Header to brand tokens"
```

---

### Task 5: Reskin `InvestigationsSidebar.tsx`

**Files:**
- Modify: `frontend/src/components/InvestigationsSidebar.tsx`

**Step 1: Read current file**

Read `frontend/src/components/InvestigationsSidebar.tsx` so the edits below have correct context.

**Step 2: Apply the following class replacements (preserve all logic and props, change ONLY the className strings listed)**

These are mechanical class swaps. Each `replace_all` is safe because the strings are unique per occurrence (verified). Use the Edit tool with `replace_all: true` only where the same class string appears multiple times for the same purpose.

| Old class string | New class string | Notes |
|---|---|---|
| `w-full bg-gray-800 flex flex-col h-full overflow-hidden` | `w-full bg-bg-panel flex flex-col h-full overflow-hidden` | Root container |
| `p-3 border-b border-gray-700 flex items-center gap-2` | `p-3 border-b border-line flex items-center gap-2` | Case header row |
| `text-gray-400 hover:text-white transition-colors` | `text-ink-faint hover:text-ink transition-colors` | Back button |
| `px-3 py-2 flex items-center justify-between border-b border-gray-700` | `px-3 py-2 flex items-center justify-between border-b border-line` | "Investigations" section header |
| `text-xs font-medium text-gray-400 uppercase tracking-wider` | `font-mono text-[10px] text-ink-faint uppercase tracking-[0.14em]` | Section labels — apply to all 3 occurrences (Investigations / Productions / Data Room) with `replace_all: true` |
| `text-gray-500 hover:text-gray-300 text-xs transition-colors` | `text-ink-faint hover:text-ink text-xs transition-colors` | "+" buttons — `replace_all: true` |
| `bg-blue-600/20 text-blue-300` | `bg-brand-soft text-ink border-l-2 border-brand -ml-[2px] pl-[calc(0.75rem-2px)]` | Active investigation/production/data-room row — `replace_all: true`. The negative margin + adjusted padding keeps row width constant when the brand rail appears. |
| `hover:bg-gray-700/60 text-gray-300` | `hover:bg-bg-raised text-ink-muted` | Hover state for investigation rows |
| `hover:bg-gray-700/60 text-gray-400` | `hover:bg-bg-raised text-ink-muted` | Hover state for production/data-room rows — `replace_all: true` |
| `mr-1 shrink-0 transition-colors ${isActive && traces ? 'text-gray-500 hover:text-gray-300' : 'text-gray-600'}` | `mr-1 shrink-0 transition-colors ${isActive && traces ? 'text-ink-faint hover:text-ink-muted' : 'text-ink-faint/60'}` | Chevron button |
| `px-0.5 text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity` | `px-0.5 text-ink-faint hover:text-ink opacity-0 group-hover:opacity-100 transition-opacity` | Edit pencil |
| `ml-3 border-l border-gray-700/70` | `ml-3 border-l border-line` | Trace list rail |
| `bg-gray-700 text-white` | `bg-bg-raised text-ink` | Selected trace |
| `hover:bg-gray-700/50 text-gray-400 hover:text-gray-200` | `hover:bg-bg-raised text-ink-muted hover:text-ink` | Trace hover |
| `flex items-center ${trace.visible ? 'text-gray-500 hover:text-white' : 'text-gray-700 hover:text-gray-400'}` | `flex items-center ${trace.visible ? 'text-ink-faint hover:text-ink' : 'text-ink-faint/40 hover:text-ink-faint'}` | Eye toggle |
| `flex items-center gap-1.5 pl-3 pr-2 py-1 w-full text-left text-gray-600 hover:text-gray-400 transition-colors` | `flex items-center gap-1.5 pl-3 pr-2 py-1 w-full text-left text-ink-faint/60 hover:text-ink-faint transition-colors` | "Add trace" button |
| `text-gray-500 text-xs p-3` | `text-ink-faint text-xs p-3` | Empty state |
| `mt-2 border-t border-gray-700` | `mt-2 border-t border-line` | Section divider — `replace_all: true` |
| `text-[10px] text-gray-600` | `font-mono text-[10px] text-ink-faint/70 uppercase tracking-wider` | Production type badge |
| `text-gray-600 text-xs px-3 py-1` | `text-ink-faint text-xs px-3 py-1` | Empty productions |

For the data-room status colors, leave `text-yellow-500` and `text-green-500` for now — those are semantic status indicators, not brand chrome. They will be revisited in Task 9.

**Step 3: Visual check**

Reload http://localhost:3001/cases/&lt;id&gt;/investigations?inv=&lt;id&gt;. Expected:
- Sidebar background is `bg-panel` (slightly raised from canvas).
- "INVESTIGATIONS", "PRODUCTIONS", "DATA ROOM" labels render in mono, smaller, with more letter-spacing.
- Active investigation row has a navy `bg-brand-soft` background and a 2px brand-blue left rail.
- No more `text-blue-300` anywhere in the sidebar.

**Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: passes.

**Step 5: Commit**

```bash
git add frontend/src/components/InvestigationsSidebar.tsx
git commit -m "feat(frontend): reskin InvestigationsSidebar to brand tokens"
```

---

### Task 6: Create centralized chart palette

**Files:**
- Create: `frontend/src/lib/chartPalette.ts`

**Step 1: Create the file**

Write the following to `frontend/src/lib/chartPalette.ts`:

```ts
/**
 * Brand-aligned palette for Chart.js. Values mirror the CSS tokens in
 * globals.css; we duplicate them here as JS literals because Chart.js
 * canvas rendering cannot read CSS custom properties.
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
  '#FBBF24', // amber (last resort — avoid as primary)
] as const;

/**
 * Apply brand palette to a Chart.js dataset array. Mutates a shallow copy
 * of each dataset so callers can pass the raw API response without
 * worrying about color assignment.
 */
export function applyBrandColors<T extends { backgroundColor?: unknown; borderColor?: unknown }>(
  datasets: T[],
): T[] {
  return datasets.map((ds, i) => {
    const color = BRAND_SERIES_COLORS[i % BRAND_SERIES_COLORS.length];
    return {
      ...ds,
      backgroundColor: ds.backgroundColor ?? color,
      borderColor: ds.borderColor ?? color,
    };
  });
}

/**
 * Base Chart.js options block with brand-aligned axes, gridlines, and
 * legend text. Spread this into per-chart options to inherit the look.
 */
export const BRAND_CHART_OPTIONS = {
  plugins: {
    legend: {
      labels: {
        color: BRAND_PALETTE.inkMuted,
        font: { family: 'ui-sans-serif, system-ui, sans-serif', size: 11 },
      },
    },
  },
  scales: {
    x: {
      ticks: {
        color: BRAND_PALETTE.inkFaint,
        font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 10 },
      },
      grid: { color: BRAND_PALETTE.line },
    },
    y: {
      ticks: {
        color: BRAND_PALETTE.inkFaint,
        font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 10 },
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
git commit -m "feat(frontend): add centralized brand chart palette"
```

---

### Task 7: Wire `ChartViewer.tsx` to brand palette

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

**Step 2: Visual check**

Trigger a chart render in the AI chat (or navigate to a production that contains a chart, if available). Expected:
- Line series renders in teal `#2DD4D2`, not yellow.
- Gridlines are dark `#1F2937` instead of mid-gray.
- Axis tick labels render in JetBrains Mono.

If you cannot find a chart in the running app, manually create a test page or skip the visual check and rely on the typecheck — note this in the commit message.

**Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: passes.

**Step 4: Commit**

```bash
git add frontend/src/components/ChartViewer.tsx
git commit -m "feat(frontend): wire ChartViewer to brand palette and mono axes"
```

---

### Task 8: Reskin `AIChat.tsx` panel chrome

**Files:**
- Modify: `frontend/src/components/AIChat.tsx`

**Scope:** Only the panel chrome (outer container, message bubbles, code blocks, input bar, model selector, conversation list). Do **not** touch any logic, streaming handlers, attachment handling, or markdown rendering.

**Step 1: Read the file**

Read `frontend/src/components/AIChat.tsx` in full.

**Step 2: Apply token swaps**

Search for and replace these patterns (use Edit with `replace_all` where the same string appears multiple times):

| Old | New |
|---|---|
| `bg-gray-900` | `bg-bg` |
| `bg-gray-800` | `bg-bg-panel` |
| `bg-gray-700` | `bg-bg-raised` |
| `border-gray-700` | `border-line` |
| `border-gray-800` | `border-line` |
| `text-gray-300` | `text-ink-muted` |
| `text-gray-400` | `text-ink-muted` |
| `text-gray-500` | `text-ink-faint` |
| `text-gray-600` | `text-ink-faint` |
| `text-white` (inside this file only) | `text-ink` |
| `bg-blue-600` | `bg-brand` |
| `bg-blue-700` | `bg-brand` |
| `hover:bg-blue-700` | `hover:bg-brand/90` |
| `text-blue-400` | `text-brand` |
| `text-blue-300` | `text-brand` |

**Step 3: Add architectural left border to the outer panel**

Find the outermost container `<div>` of the chat panel (the one rendered at the top level of the component's JSX return). Add `border-l border-line` to its className list. This is the architectural separator from the canvas.

If the outermost element already has a left border class, leave it.

**Step 4: Visual check**

Dev server still running. Open the chat panel on an investigation page. Expected:
- Chat panel sits one tier above the canvas (`bg-panel`), separated by a hairline left border.
- User messages render with `bg-brand` (navy), not bright blue.
- Inline code in markdown renders in JetBrains Mono on `bg-raised`.
- No remaining `gray-*` or `blue-*` classes in the chat surface.

Run: `cd frontend && grep -E "gray-[0-9]|blue-[0-9]" src/components/AIChat.tsx`
Expected: no matches (or only matches in status/severity contexts you intentionally left).

**Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: passes.

**Step 6: Commit**

```bash
git add frontend/src/components/AIChat.tsx
git commit -m "feat(frontend): reskin AIChat panel chrome to brand tokens"
```

---

### Task 9: Sweep remaining `gray-*` / `blue-600` in high-traffic components

**Files:**
- Modify (mechanical class swaps, no logic changes):
  - `frontend/src/components/DetailsPanel.tsx`
  - `frontend/src/components/FloatingPanel.tsx`
  - `frontend/src/components/SidePanel.tsx`
  - `frontend/src/components/StagingPanel.tsx`
  - `frontend/src/components/FetchModal.tsx`
  - `frontend/src/components/ExportModal.tsx`
  - `frontend/src/components/ConfirmDeleteModal.tsx`
  - `frontend/src/components/NewPrimaryModal.tsx`
  - `frontend/src/components/InvestigationForm.tsx`
  - `frontend/src/components/TraceForm.tsx`
  - `frontend/src/components/WalletForm.tsx`
  - `frontend/src/components/TransactionForm.tsx`
  - `frontend/src/components/QuickAddInput.tsx`
  - `frontend/src/components/UserMenu.tsx`
  - `frontend/src/components/CanvasToolPill.tsx`
  - `frontend/src/components/TraceList.tsx`
  - `frontend/src/components/Loader.tsx`

**Out of scope:** `frontend/src/app/admin/**`, `frontend/src/app/entities/**`, `frontend/src/app/cases/[caseId]/data-room/page.tsx`. These have semantic status colors (yellow/green/red) that need a separate review.

**Step 1: Apply the same mapping table from Task 8 across each file in scope**

For each file in the list above, run a grep first to confirm the file has `gray-*` or `blue-600` classes, then apply the Task 8 mapping table. The mapping is purely mechanical — do not modify any logic, props, or behavior.

```bash
cd frontend && grep -l "gray-[0-9]\|blue-600\|blue-700" \
  src/components/DetailsPanel.tsx \
  src/components/FloatingPanel.tsx \
  src/components/SidePanel.tsx \
  src/components/StagingPanel.tsx \
  src/components/FetchModal.tsx \
  src/components/ExportModal.tsx \
  src/components/ConfirmDeleteModal.tsx \
  src/components/NewPrimaryModal.tsx \
  src/components/InvestigationForm.tsx \
  src/components/TraceForm.tsx \
  src/components/WalletForm.tsx \
  src/components/TransactionForm.tsx \
  src/components/QuickAddInput.tsx \
  src/components/UserMenu.tsx \
  src/components/CanvasToolPill.tsx \
  src/components/TraceList.tsx \
  src/components/Loader.tsx
```

For each file returned, apply the Task 8 mapping. Skip any class that is part of a semantic status indicator (e.g., `text-red-400` for errors, `text-yellow-500` for warnings, `text-green-500` for success). Leave those as-is.

**Step 2: Confirm scope contained**

Run: `cd frontend && grep -rln "gray-800\|gray-700\|gray-900" src/components/ | grep -v node_modules`
Expected: an empty result, OR only files explicitly out of scope above. If a new file appears, do NOT expand the sweep — note it in the commit message and stop.

**Step 3: Visual smoke test**

Dev server running. Walk through these routes and confirm nothing visibly broke:
- `/cases/<id>/investigations?inv=<id>` (sidebar, header, canvas, chat)
- Open the Export modal
- Open the Fetch modal
- Open the New Investigation modal
- Click a node on the canvas (DetailsPanel)

Expected: every panel uses brand tokens, no flashes of the old slate gray, no white text on white background, no invisible text.

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

The following are deliberately deferred. Flag them to the user when handing off, but do not touch them in this plan:

- **Semantic status colors** (`yellow-*` warnings, `green-*` success, `red-*` errors). These need their own pass to define `--status-warn`, `--status-ok`, `--status-error` tokens that look correct on `bg-panel`.
- **Admin pages** (`src/app/admin/**`) — separate audit; lower brand priority.
- **Data Room page** (`src/app/cases/[caseId]/data-room/page.tsx`) — has heavy yellow-themed connection-lost UI that needs design input, not a mechanical sweep.
- **GraphCanvas / Cytoscape node styling** — node/edge colors live in `useCytoscape.ts` style overrides and need a separate palette pass coordinated with the brand chart palette.
- **Light mode** — out of scope for this plan; not part of the agreed direction.

---

## Final verification before handoff

Before declaring done:

1. `cd frontend && npx tsc --noEmit` passes.
2. `cd frontend && npm run build` passes.
3. `git status` is clean (all changes committed).
4. The brand site (`website-daubert`) and the app, side by side, share: navy/teal palette, Inter + JetBrains Mono, hairline borders, mono uppercase section labels, tabular numerals. They should feel like products from the same company.
