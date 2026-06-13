# Light-First Redesign Implementation Plan

**Goal:** Reskin the entire app to the marketing site's light, legal/fintech design language — one token system, ~10 shared UI primitives, dark reserved for the graph canvas only.

## Summary

- **What & why:** The app is a visually incoherent half-dark/half-light patchwork with no component library. This plan flips the token layer to the website's light palette (same token names, so the theme flips globally in one task), builds in-house UI primitives, then migrates every surface to tokens + primitives, keeping the graph canvas dark with a deliberate "floating on canvas" treatment.
- **Key product decisions (LOCKED, approved 2026-06-12):** Light-first matching `../website-daubert`; graph canvas stays dark; `variant="light"` props deleted; dark mode deferred (token swap later); visual-only — zero behavior/routing/API changes.
- **Decisions made autonomously during planning:** (1) Existing token *names* (`surface`, `surface-panel`, `surface-raised`, `ink`, …) are kept and remapped to light values so unmigrated screens degrade gracefully — no big-bang rename. (2) Graph-floating panels use explicit `canvas-*` tokens, not a variant prop. (3) The color-picker palettes (`ColorPicker`, `LabelColorPicker`, `GroupColorPicker`), `cytoscapeStyle.ts`, and `exportTheme.ts` keep their hex values — those are user-selectable content colors / canvas rendering, not chrome.
- **Risk concentration (opus tasks):** Task 5 (workspace shell + canvas seam), Task 7 (graph-floating UI), Task 14 (final sweep + signature details).

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task. Work in the worktree `/Users/Sam/Work/Incite/dev/daubert/.worktrees/redesign-light-theme`. Commits ARE authorized in this worktree (fullsend run). No Co-Authored-By trailers.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `frontend/src/app/globals.css` + `frontend/tailwind.config.js` | Modify | Whole app instantly flips to the website's light palette; canvas tokens for dark graph zone |
| 2 | `frontend/src/components/ui/*` (10 new files) | Create | Devs get Button/Input/Modal/Panel/Badge/Kicker/EmptyState/Field primitives — no more ad-hoc buttons |
| 3 | `frontend/src/components/Common/*` | Modify | Modals, loaders, page headers look consistent; emoji glyphs replaced with icons |
| 4 | `frontend/src/components/Auth/*`, `Layout/OrgSwitcher.tsx` | Modify | `variant="light"` deleted; menus/login widgets match brand |
| 5 | `frontend/src/components/Workspace/{CaseShell,InvestigationsSidebar,WorkspaceEmptyState,ScriptsPanel}.tsx` + 3 workspace pages | Modify | Workspace becomes light chrome around a deliberate dark canvas — the flagship screen |
| 6 | `frontend/src/components/Workspace/AIChat.tsx` | Modify | Agent chat matches website chat-bubble language, zero hardcoded hex |
| 7 | `frontend/src/components/Graph/*` (floating panels, menus, popovers) | Modify | Graph overlays get the website's dark-canvas treatment (white/10 borders, mono pills) |
| 8 | `frontend/src/components/{Forms,Cases,AdvancedSearch}/*`, `Workspace/{FetchModal,NewPrimaryModal,WorkspaceModals}.tsx` | Modify | All forms/modals use primitives |
| 9 | `frontend/src/app/page.tsx`, `account/`, `entities/` | Modify | Home gets website card language (hover-lift case tiles) |
| 10 | `frontend/src/app/{login,invite,org-invite,oauth}/**` | Modify | Auth/invite pages align to tokens (they were the accidental light pages) |
| 11 | `frontend/src/app/cases/[caseId]/settings`, `orgs/[orgSlug]/**`, `cases/[caseId]/page.tsx` | Modify | Settings surfaces go light |
| 12 | `frontend/src/app/superadmin/**` | Modify | Admin panel goes light |
| 13 | `frontend/src/components/Productions/*` | Modify | Reports/charts/chronology viewers go light |
| 14 | Sweep: kickers, entity chips, hover-lift, z-ladder, hex-zero check | Modify | Signature brand details + enforcement that no chrome hex remains |

## Global conventions (read before every task)

**Token map (the ONLY colors allowed in chrome).** After Task 1 these exist as Tailwind classes:

| Class | Value | Use |
|---|---|---|
| `text-ink` | `#0B1220` | primary text |
| `text-ink-soft` | `#1F2937` | secondary text |
| `text-ink-muted` | `#5B6473` | tertiary text |
| `text-ink-faint` | `#9AA3B2` | hints/disabled |
| `bg-surface` | `#FFFFFF` | page/card background |
| `bg-surface-panel` | `#F7F8FB` | sidebars, muted panels |
| `bg-surface-raised` | `#F1F4FA` | hovers, tinted fills |
| `border-line` | `#E5E7EB` | default border |
| `border-line-strong` | `#CFD4DD` | emphasized border |
| `brand` | `#1F3A93` | primary actions, links |
| `brand-strong` | `#162B6D` | hover state of brand |
| `brand-soft` | `#E8EDFB` | badge/selected bg |
| `accent` | `#0EA5A3` | teal accent (sparing) |
| `redline` | `#B91C1C` | destructive only |
| `bg-canvas` | `#0B1220` | graph canvas zone only |
| `canvas-line` | `rgba(255,255,255,0.12)` | borders on canvas |
| `canvas-fill` | `rgba(255,255,255,0.06)` | fills on canvas |
| `text-canvas-ink` | `#E6EAF2` | primary text on canvas |
| `text-canvas-muted` | `#9AA3B2` | muted text on canvas |

**Mechanical replacement table** (apply in every migration task):
- `text-[#0B1220]` → `text-ink` · `text-[#1F2937]` → `text-ink-soft` · `text-[#5B6473]` → `text-ink-muted` · `text-[#9AA3B2]` → `text-ink-faint`
- `bg-[#F7F8FB]` → `bg-surface-panel` · `bg-[#F1F4FA]` → `bg-surface-raised` · `bg-white` → `bg-surface`
- `border-[#E5E7EB]` → `border-line` · `border-[#CFD4DD]` → `border-line-strong`
- Tailwind-default grays used as chrome (`text-gray-*`, `bg-gray-*`, `#374151`, `#d1d5db`, `#9ca3af`, `#1f2937` inline styles) → nearest token above (on canvas zone: `canvas-*` tokens)
- `bg-red-600/hover:bg-red-500` destructive buttons → `Button variant="danger"` (redline)
- Focus: every interactive element gets `focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40`
- Radii: controls `rounded-lg` (8px) · cards/modals/panels `rounded-xl` (12px) · pills `rounded-full`. No bare `rounded`.
- Z-index ladder: sticky/header `z-10` · dropdown/popover `z-20` · floating panel/sidebar toggles `z-30` · modal `z-50`. No other values.
- Icons: `react-icons/fa6` only. No `✕`/`✓` text glyphs.
- **Exempt from hex rules:** `src/hooks/cytoscapeStyle.ts`, `src/lib/exportTheme.ts`, the palette arrays inside `ColorPicker.tsx`, `LabelColorPicker.tsx`, `GroupColorPicker.tsx`, and label color data in `LabelEditPopover.tsx` (content colors). The *chrome* (toolbars, buttons) of those components is NOT exempt.

**Verification commands (every task):**
- Build: `npm run build --prefix frontend` (from worktree root) — must pass.
- Tests: `npm test --prefix frontend` — must pass (22 existing test files).
- Hex check for the task's files: `grep -nE 'text-\[#|bg-\[#|border-\[#' <files>` → empty (exempt files aside).

**Commit after each task:** `git add -A && git commit -m "style(<area>): <description>"` — no trailers.

---

## Task 1: Flip the token layer

**Implementer:** sonnet
**Files:** Modify `frontend/src/app/globals.css`, `frontend/tailwind.config.js`, `frontend/src/app/layout.tsx`.

**Step 1:** Replace the `:root` block and base styles in `globals.css`:

```css
@layer base {
  :root {
    color-scheme: light;

    --ink: #0B1220;
    --ink-soft: #1F2937;
    --ink-muted: #5B6473;
    --ink-faint: #9AA3B2;

    --surface: #FFFFFF;
    --surface-panel: #F7F8FB;
    --surface-raised: #F1F4FA;

    --line: #E5E7EB;
    --line-strong: #CFD4DD;

    --brand: #1F3A93;
    --brand-strong: #162B6D;
    --brand-soft: #E8EDFB;
    --brand-ink: #1F3A93;
    --accent: #0EA5A3;
    --redline: #B91C1C;

    --canvas: #0B1220;
    --canvas-line: rgba(255, 255, 255, 0.12);
    --canvas-fill: rgba(255, 255, 255, 0.06);
    --canvas-ink: #E6EAF2;
    --canvas-muted: #9AA3B2;
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
```

Keep the keyframes. Update `.bg-grid-faint` to a light variant (swap `white`/`rgba(255,255,255,…)` for `rgba(11,18,32,0.06)` dots and `rgba(11,18,32,0.04)` lines) and add a `.bg-grid-canvas` utility preserving the old white-dot values for use inside the dark canvas zone.

**Step 2:** In `tailwind.config.js` extend colors with the new tokens: add `ink.soft`, `brand.strong`, `redline`, and a `canvas` group (`DEFAULT: 'var(--canvas)'`, `line`, `fill`, `ink`, `muted` → corresponding vars). Keep all existing aliases.

**Step 3:** `layout.tsx` body class stays `bg-surface text-ink font-sans antialiased` (no change needed — verify only).

**Step 4:** Verify: build + tests + visually nonsensical combos are expected at this stage (screens become light-but-plain; that's the design of the migration).

**Step 5:** Commit `style(tokens): flip token layer to light palette, add canvas + redline tokens`.

## Task 2: UI primitives

**Implementer:** sonnet
**Files:** Create `frontend/src/components/ui/Button.tsx`, `IconButton.tsx`, `Input.tsx`, `Select.tsx`, `Textarea.tsx`, `Field.tsx`, `Modal.tsx`, `Panel.tsx`, `Badge.tsx`, `Kicker.tsx`, `EmptyState.tsx`, `index.ts`. Test: `frontend/src/components/ui/ui.test.tsx`.

All primitives: plain function components, `className` passthrough merged last, no external deps. Shared focus ring `focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40`.

**Step 1:** Write `ui.test.tsx` first (jsdom env via `@jest-environment jsdom` docblock, pattern from `AgentStatusButton.test.tsx`): renders Button variants with expected classes (`bg-brand` for primary, `text-redline` styling path for danger), Modal renders children inside overlay with `z-50`, Kicker uppercases with `font-mono`. Run `npm test --prefix frontend -- ui.test` → fails (files missing).

**Step 2:** Implement:

```tsx
// Button.tsx
import { ButtonHTMLAttributes } from 'react';

const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-strong',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-raised',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-raised',
  danger: 'bg-redline text-white hover:bg-redline/90',
} as const;

const SIZES = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-[15px]',
} as const;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
};

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    />
  );
}
```

- `IconButton`: square (`h-8 w-8`), ghost styling, requires `aria-label`.
- `Input`/`Select`/`Textarea`: `w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint` + focus ring; `Field` wraps label (`text-[13px] font-medium text-ink-soft`) + child + optional error (`text-[13px] text-redline`).
- `Modal`: `fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center p-4`; dialog `bg-surface rounded-xl border border-line shadow-[0_24px_60px_-30px_rgba(11,18,32,0.25)] w-full` with `maxWidth` prop; header row with title + `IconButton` close (`FaXmark`); Escape + overlay-click close.
- `Panel`: `bg-surface rounded-xl border border-line` with optional `padded`.
- `Badge`: pill, `tone` prop → `brand` (`bg-brand-soft text-brand`), `neutral` (`bg-surface-raised text-ink-muted`), `accent` (`bg-accent/10 text-accent`), `danger` (`bg-redline/10 text-redline`).
- `Kicker`: `font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint` rendering children, optional `index` prop prefixing `0N · `.
- `EmptyState`: centered icon + title (`text-[15px] font-medium text-ink`) + body (`text-sm text-ink-muted`) + optional action slot.
- `index.ts` re-exports all.

**Step 3:** `npm test --prefix frontend -- ui.test` → pass. Build passes.
**Step 4:** Commit `feat(ui): in-house primitive component library`.

## Task 3: Common components

**Implementer:** sonnet
**Files:** Modify all of `frontend/src/components/Common/` (PageHeader, Loader, ErrorModal, ConfirmDeleteModal, ConfirmProvider, InviteCreatedModal, ExportModal, ExportPreview, CopyButton, FloatingPanel, ColorPicker, LabelColorPicker, GroupColorPicker).

**Steps:** Apply the mechanical replacement table. Specifics:
- `PageHeader.tsx`: delete hardcoded `#F7F8FB/#E5E7EB/#0B1220/#5B6473` → `bg-surface-panel border-b border-line h-12`, title `text-sm font-medium text-ink`, secondary `text-ink-muted`. Remove any light/dark conditional props — one theme.
- Modals (`ErrorModal`, `ConfirmDeleteModal`, `InviteCreatedModal`, `ExportModal`, `ConfirmProvider` dialogs): rebuild on `ui/Modal` + `ui/Button` (danger actions → `variant="danger"`).
- `FloatingPanel.tsx`: this floats on the graph canvas → dark-canvas treatment: `bg-canvas/90 backdrop-blur border border-canvas-line rounded-xl text-canvas-ink`; replace `✕` glyph with `FaXmark` IconButton (keep ghost hover legible on dark: `text-canvas-muted hover:text-canvas-ink`).
- Color pickers: palette swatch hex arrays stay; chrome (container, labels, buttons) → tokens.
- `Loader.tsx`: token colors only.
- Verify per-task commands; `ExportPreview.test.tsx` must still pass. Commit `style(common): migrate shared components to tokens and primitives`.

## Task 4: Auth + OrgSwitcher (kill `variant="light"`)

**Implementer:** sonnet
**Files:** Modify `frontend/src/components/Auth/{UserMenu,EmailLoginForm,OtpInput,RequestAccessModal}.tsx`, `frontend/src/components/Layout/OrgSwitcher.tsx`, and the three call sites passing `variant="light"` (`app/cases/[caseId]/(workspace)/{investigations,productions,data-room}/page.tsx` — prop removal only here; full page migration is Task 5) plus `Workspace/WorkspaceEmptyState.tsx` call site.

**Steps:** Remove the `variant` prop and all `variant === 'light'` conditionals from `UserMenu` and `OrgSwitcher`; single light styling per token map. Dropdown menus: `bg-surface rounded-xl border border-line shadow-[0_24px_60px_-30px_rgba(11,18,32,0.18)] z-20`. Forms use `ui` primitives. Build + tests (`login/page.test.tsx` etc. must pass). Commit `style(auth): single-theme UserMenu/OrgSwitcher, tokenized auth components`.

## Task 5: Workspace shell + canvas seam

**Implementer:** opus
**Files:** Modify `frontend/src/components/Workspace/{CaseShell,InvestigationsSidebar,WorkspaceEmptyState,ScriptsPanel}.tsx` (ScriptsPanel renders INSIDE the light sidebar — light token pass, NOT canvas treatment), `frontend/src/app/cases/[caseId]/(workspace)/layout.tsx`, and the chrome portions of `investigations/page.tsx`, `productions/page.tsx`, `data-room/page.tsx`.

**Steps:**
- Left sidebar: `bg-surface-panel border-r border-line`, header `h-12 border-b border-line` with back button (`IconButton`) + case name `text-sm font-medium text-ink`. Section headers become `Kicker` with indices: `01 · INVESTIGATIONS`, `02 · PRODUCTIONS`, `03 · SCRIPTS`. Active investigation row: `bg-surface rounded-lg border border-line-strong`; inactive rows `text-ink-muted hover:bg-surface-raised rounded-lg`.
- The graph pane wrapper (center column on investigations route) gets `bg-canvas` explicitly so the canvas stays dark inside light chrome; the seam is just the sidebar borders — no gradient, no shadow.
- Resize handles: `bg-line hover:bg-line-strong`; collapse toggles `z-30` IconButtons on light chrome.
- `data-room` and `productions` center panes are LIGHT (documents read on white); only the investigations graph pane is dark.
- Workspace top header (where present in pages): light `bg-surface border-b border-line`, actions use `ui/Button` (`size="sm"`).
- Remove every hardcoded hex in these files. Build + tests + `data-room/page.spec.tsx` passes. Commit `style(workspace): light chrome around dark graph canvas`.

## Task 6: AIChat

**Implementer:** opus
**Files:** Modify `frontend/src/components/Workspace/AIChat.tsx` (28 hex occurrences).

**Steps:** Right sidebar container `bg-surface border-l border-line`. Header with `Kicker index={3}>AGENT`. User bubbles `bg-surface-raised rounded-xl px-3 py-2 text-sm text-ink-soft`; assistant bubbles `bg-surface border border-line rounded-xl`. Tool/status lines `font-mono text-[11px] text-accent`. Model selector dropdown per Task 4 dropdown spec. Composer: `border border-line-strong rounded-xl` wrapping textarea (borderless inner) + send `IconButton` with `text-brand`. Markdown prose: ensure `prose prose-sm` renders dark-on-light (drop any `prose-invert`). Zero hex. Build + tests. Commit `style(chat): tokenized agent chat with website bubble language`.

## Task 7: Graph-floating UI (dark-canvas treatment)

**Implementer:** opus
**Files:** Modify `frontend/src/components/Graph/`: `SelectionDetailsPanel.tsx`, `DetailsPanel.tsx`, `ContextMenu.tsx`, `graphContextMenu.tsx`, `CanvasToolPill.tsx`, `QuickAddInput.tsx`, `ChainSelect.tsx`, `StagingPanel.tsx`, `CreationPanels.tsx`, `HeaderActions.tsx`, `BatchEditPanel.tsx`, `EdgeBatchPanel.tsx`, `MultiTxDetails.tsx`, `LabelEditPopover.tsx`, `LabelOverlay.tsx`, `details/*.tsx` (7 files).

**Steps:** Everything that renders OVER the cytoscape canvas uses the canvas treatment: `bg-canvas/90 backdrop-blur border border-canvas-line rounded-xl text-canvas-ink`, muted text `text-canvas-muted`, fills `bg-canvas-fill`, mono pills (`CanvasToolPill`: `font-mono text-[11px] rounded-full border border-canvas-line bg-canvas-fill px-2.5 py-1`). Inputs inside these panels: `bg-canvas-fill border-canvas-line text-canvas-ink placeholder:text-canvas-muted` (do NOT use the light `ui/Input` here; create local class constant). Primary action buttons inside panels may keep `bg-brand text-white` (works on dark). Replace ALL inline `style={{ background: '#1f2937' … }}` objects in `LabelEditPopover.tsx` toolbar with canvas token classes (label color DATA arrays stay). `LabelOverlay.test.tsx` must pass. Z-index: panels `z-30`, context menu `z-20`. Build + tests. Commit `style(graph): dark-canvas treatment for floating graph UI`.

## Task 8: Forms, workspace modals, search

**Implementer:** sonnet
**Files:** Modify `frontend/src/components/Forms/{InvestigationForm,TraceForm,WalletForm,TransactionForm,TagInput}.tsx`, `frontend/src/components/Workspace/{FetchModal,NewPrimaryModal,WorkspaceModals}.tsx`, `frontend/src/components/Cases/NewCaseModal.tsx`, `frontend/src/components/AdvancedSearch/{SearchPanel,SearchResults,WalletGroupPicker}.tsx`.

**Steps:** Important nuance: these forms/panels render in two contexts. Light-chrome modals/overlays (`NewCaseModal`, `FetchModal`, `NewPrimaryModal`, and `SearchPanel` — it is a `fixed inset-0 z-50` full-screen LIGHT modal, not a canvas widget) → rebuild on `ui/Modal` + `ui` form primitives, light. Panels/forms that float on the graph (`CreationPanels` hosts the Forms components) → canvas treatment per Task 7; for the shared `Forms/*` components, parameterize ONLY via the classes already applied by their container — make the form controls inherit (`bg-transparent`, `border-canvas-line`-friendly): give Forms components a small local `inputClass` constant matching the canvas input spec from Task 7 since their only render context is on-canvas panels. `FetchModal`: replace `✕` with `FaXmark`. Zero hex; build + tests. Commit `style(forms): tokenized forms, modals, and search panels`.

## Task 9: Home, account, entities

**Implementer:** sonnet
**Files:** Modify `frontend/src/app/page.tsx`, `frontend/src/app/account/page.tsx` (+ its section components in that dir), `frontend/src/app/entities/{layout,page}.tsx`, `frontend/src/app/entities/[id]/page.tsx`.

**Steps:** Home: light page `bg-surface`; top nav `bg-surface/80 backdrop-blur-md border-b border-line sticky top-0 z-10` (website nav pattern); case grid tiles → `Panel` with `rounded-xl border border-line hover:border-line-strong hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-30px_rgba(11,18,32,0.18)] transition-all`; case-name `text-[15px] font-medium text-ink`; meta row `font-mono text-[11px] text-ink-faint`; "New case" → `ui/Button`. One hero moment: page title may use `bg-gradient-to-r from-brand to-accent bg-clip-text text-transparent` on the word "Cases" — the ONLY gradient on this screen. Account + entities pages: same card/token language, `Kicker` section headers. Account tests (`AgentActivitySection.test.tsx`, `ConnectedAgentsSection.test.tsx`) pass. Commit `style(home): website card language for home, account, entities`.

## Task 10: Login, invite, oauth pages

**Implementer:** sonnet
**Files:** Modify `frontend/src/app/login/page.tsx`, `frontend/src/app/invite/[code]/page.tsx`, `frontend/src/app/org-invite/[code]/page.tsx`, `frontend/src/app/oauth/authorize/page.tsx`, `frontend/src/app/oauth/consent/{layout,page}.tsx` (+ `ConsentScreen`).

**Steps:** These were the accidental-light pages — replace their hardcoded `#0B1220/#5B6473/#F1F4FA/#E5E7EB` with tokens (mechanical table), center cards on `bg-surface-panel` page with `Panel` (`rounded-xl border-line shadow` card), buttons → `ui/Button`. Tests `login/page.test.tsx`, `oauth/authorize/page.test.tsx`, `ConsentScreen.test.tsx` pass. Zero hex. Commit `style(auth-pages): tokenize login, invite, and oauth pages`.

## Task 11: Case + org settings

**Implementer:** sonnet
**Files:** Modify `frontend/src/app/cases/[caseId]/page.tsx`, `frontend/src/app/cases/[caseId]/settings/page.tsx`, `frontend/src/app/cases/[caseId]/layout.tsx`, `frontend/src/app/orgs/[orgSlug]/layout.tsx`, `frontend/src/app/orgs/[orgSlug]/settings/page.tsx` (+ section components like `OrgCasesAdminSection`).

**Steps:** Light settings pages: `max-w-3xl mx-auto` content, sections as `Panel padded` with `Kicker` headers, member rows `border-b border-line last:border-0`, role badges → `Badge`, destructive zone: `border border-redline/30 rounded-xl` section with `Button variant="danger"`. `OrgCasesAdminSection.test.tsx` passes. Commit `style(settings): light settings surfaces`.

## Task 12: Superadmin

**Implementer:** sonnet
**Files:** Modify `frontend/src/app/superadmin/{layout,page}.tsx` and `cases,entities,orgs,token-usage,users/page.tsx`.

**Steps:** Mechanical migration to tokens + primitives; tables: header `font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line`, rows `border-b border-line hover:bg-surface-panel`; the local `primaryBtn`-style class constants are deleted in favor of `ui/Button`. Commit `style(superadmin): tokenized admin panel`.

## Task 13: Productions

**Implementer:** sonnet
**Files:** Modify `frontend/src/components/Productions/{ProductionViewer,ReportEditor,ChartViewer,ChronologyTable,ExhibitBuilder,CitationPicker,AddColumnModal,ChartDatasetEditor}.tsx`.

**Steps:** All light (documents on white): viewer chrome `bg-surface`, toolbars `border-b border-line` with `ui/Button size="sm"` + `IconButton`, editor prose dark-on-light, chronology table per Task 12 table spec, modals on `ui/Modal`. Replace the 10 hardcoded hex in `ProductionViewer`. Chart palettes (data series colors) are content — keep. Commit `style(productions): light production surfaces`.

## Task 14: Signature details + enforcement sweep

**Implementer:** opus
**Files:** Touch-ups across files migrated above; `frontend/src/app/globals.css` if utilities needed.

**Steps:**
1. Sweep: `grep -rnE "text-\[#|bg-\[#|border-\[#" frontend/src --include='*.tsx' | grep -v -E 'ColorPicker|LabelColorPicker|GroupColorPicker|cytoscapeStyle|exportTheme'` → fix every hit (label-color DATA arrays in LabelEditPopover may remain — chrome may not). Second pass for inline styles: `grep -rnE "style=\{[^}]*#[0-9A-Fa-f]{3,6}" frontend/src --include='*.tsx'` — chrome hits must be fixed; content-color hits (trace dots, label colors, chart palettes) are exempt and listed individually in the commit message. Same for `variant="light"` (zero hits), `✕|✓|×` glyphs (zero hits), z-index values outside the ladder.
2. Entity/category chips wherever wallet categories render (graph details panels, entities pages): map to website category palette — exchange `#2563EB`, mixer `#B45309`, bridge cyan `#0891B2`, protocol `#7C3AED`, tron `#EF4444` — define once as `CATEGORY_COLORS` in `frontend/src/lib/categoryColors.ts` and import (these are content colors, allowed as a single named constant module).
3. Confirm exactly one brand→accent gradient moment per screen max; kickers present on home, sidebar, chat, settings.
4. Full verification: `npm run build --prefix frontend` && `npm test --prefix frontend` && backend build untouched (`git diff --stat -- backend` empty).
5. Commit `style(polish): signature details and hex-zero enforcement sweep`.
