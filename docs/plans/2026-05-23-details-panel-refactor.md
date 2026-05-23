# DetailsPanel Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Split `frontend/src/components/Graph/DetailsPanel.tsx` (1,237 lines) into one file per detail subcomponent, leaving `DetailsPanel.tsx` as a thin dispatcher (~120 lines).

**Architecture:** Pure file-split refactor. Each `*Details` subcomponent moves to `frontend/src/components/Graph/details/`. Constants and helpers used by only one consumer travel with that consumer (verified via grep — no constant is shared across multiple subcomponents). `TransactionHeader` stays internal to `TransactionDetails.tsx`. `MultiTxDetails.tsx` stays where it is (already extracted, shared by two consumers).

No behavior change, no public API change, no logic change. Every task verifies with `npx tsc --noEmit` from `/frontend` and a manual dev-server smoke test of the panel for the entity type being moved.

**Tech Stack:** React + TypeScript + Next.js 14 App Router. Type-check via `tsc --noEmit`. Dev server: `npm run fe` from repo root.

---

## Atomized Changes (DX)

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `frontend/src/components/Graph/details/EdgeBundleDetails.tsx` | Create | Houses `EdgeBundleDetails` (lines 15–71 of DetailsPanel.tsx). |
| 2 | `frontend/src/components/Graph/details/AggregatedEdgeDetails.tsx` | Create | Houses `AggregatedEdgeDetails` (lines 73–105). |
| 3 | `frontend/src/components/Graph/details/TraceDetails.tsx` | Create | Houses `TraceDetails` (lines 910–941). |
| 4 | `frontend/src/components/Graph/details/ScriptRunDetails.tsx` | Create | Houses `ScriptRunDetails` (lines 949–1036) and `STATUS_BADGE`. |
| 5 | `frontend/src/components/Graph/details/TransactionDetails.tsx` | Create | Houses `TransactionDetails` (lines 540–723), `TransactionHeader` (481–532), `LINE_STYLES` (534–538), and `resolveWalletDisplay` (469–479). |
| 6 | `frontend/src/components/Graph/details/GroupDetails.tsx` | Create | Houses `GroupDetails` (lines 733–908) and `fmtFlow` (725–731). |
| 7 | `frontend/src/components/Graph/details/WalletDetails.tsx` | Create | Houses `WalletDetails` (lines 176–467), `ADDRESS_TYPE_LABELS`, `ADDRESS_TYPE_COLORS`, `NODE_SHAPES`, `getCategoryStyle`, `BUNDLE_COLORS` (132–174). |
| 8 | `frontend/src/components/Graph/DetailsPanel.tsx` | Modify | Collapses to: `DetailsPanelProps` interface, exported `DetailsPanelHandle` interface, `forwardRef` + `useImperativeHandle` wiring (consumed by `page.tsx` via `detailsPanelRef.current.startEdit()`), and the `switch` dispatching to each child component (~120 lines). `TYPE_DISPLAY` is investigated separately (see Task 8 Step 2 — it appears unused inside the file). |

**Developer-visible outcome:** Each detail view becomes independently navigable, editable, and reviewable. Future changes to (say) `WalletDetails` no longer require scrolling past 700 lines of unrelated code. `DetailsPanel.tsx` becomes a glanceable dispatcher.

**User-visible outcome:** None. This is a pure refactor.

---

## Pre-flight checks (do these before Task 1)

1. **Working tree is clean for the refactor scope.** Run `git status`. The earlier delete-production and color-picker work is fine to keep in the working tree, but no other in-flight edits should touch `DetailsPanel.tsx`.
2. **Type-check baseline.** From `frontend/`, run `npx tsc --noEmit; echo "exit=$?"`. Expected: `exit=0`. If non-zero, fix existing errors before starting.
3. **Dev server.** Have `npm run fe` running in a separate terminal at `http://localhost:3001`. You'll click into each entity type during smoke tests.
4. **Pick a test case.** Open any investigation with at least: one wallet, one transaction, one group, one trace, one bundled edge, one aggregated edge, and one script run. If your seed data lacks one of these, document the gap and proceed — you can verify the missing type by inspecting cytoscape state in DevTools.

---

## Task ordering rationale

We move components in dependency order — leaves first, then trunk. Smaller subcomponents move first because their extraction is mechanical and risk-free; this builds confidence in the import pattern before tackling the 292-line `WalletDetails` last. The dispatcher (`DetailsPanel.tsx`) is updated incrementally — after each extraction it imports from the new file and removes the inlined version.

The shared `mkClass` of imports (icons, types, hooks) goes per-file; we don't introduce a barrel index for now (premature; we can add one later if the import lines become unwieldy in `DetailsPanel.tsx`).

---

### Task 1: Extract `EdgeBundleDetails`

**Files:**
- Create: `frontend/src/components/Graph/details/EdgeBundleDetails.tsx`
- Modify: `frontend/src/components/Graph/DetailsPanel.tsx` (remove lines 15–71, replace with import)

**Step 1: Create the new file**

Copy the entire `EdgeBundleDetailsProps` interface (lines 15–22) and `EdgeBundleDetails` function (lines 24–71) from `DetailsPanel.tsx` into the new file. At the top of the new file, add these imports:
- `import { EdgeBundle, Trace, TransactionEdge } from '@/types/investigation';`
- `import { normalizeToken } from '@/utils/formatAmount';`
- `import { MultiTxDetails } from '../MultiTxDetails';`

(Re-grep the function body to confirm completeness and add anything missing.)

Export the function: `export function EdgeBundleDetails(...) {...}`.

**Step 2: Update `DetailsPanel.tsx`**

Delete lines 15–71. Add at the top of `DetailsPanel.tsx`:

```tsx
import { EdgeBundleDetails } from './details/EdgeBundleDetails';
```

**Step 3: Type-check**

From `frontend/`:
```bash
npx tsc --noEmit; echo "exit=$?"
```
Expected: `exit=0`.

**Step 4: Smoke test**

In the dev-server browser, select a collapsed edge bundle on the graph. Confirm the panel renders identically to before (title, color picker, totals, transactions list, expand/unbundle buttons all work). No console errors.

**Step 5: Stop and report**

Report back: file created, lines removed from `DetailsPanel.tsx`, type-check exit code, smoke-test result. Do NOT commit (project rule — user commits explicitly).

---

### Task 2: Extract `AggregatedEdgeDetails`

**Files:**
- Create: `frontend/src/components/Graph/details/AggregatedEdgeDetails.tsx`
- Modify: `frontend/src/components/Graph/DetailsPanel.tsx`

**Step 1: Create the new file**

Move the `AggregatedEdgeDetailsProps` interface and `AggregatedEdgeDetails` function (currently around lines 73–105 of `DetailsPanel.tsx` — re-grep after Task 1's removals to confirm new line numbers).

Required imports in the new file:
- `import type { TransactionEdge } from '@/types/investigation';`
- `import { MultiTxDetails } from '../MultiTxDetails';`

Export as named export.

**Step 2: Update `DetailsPanel.tsx`**

Delete the moved block. Add:
```tsx
import { AggregatedEdgeDetails } from './details/AggregatedEdgeDetails';
```

**Step 3: Type-check**

`npx tsc --noEmit; echo "exit=$?"` → expect `exit=0`.

**Step 4: Smoke test**

Collapse a node group so multiple transactions aggregate into a single synthetic edge. Click that aggregate. Confirm: title, totals, per-row delete + confirm UX, color picker, transactions list, arc controls — all unchanged.

**Step 5: Stop and report**

Same reporting format as Task 1.

---

### Task 3: Extract `TraceDetails`

**Files:**
- Create: `frontend/src/components/Graph/details/TraceDetails.tsx`
- Modify: `frontend/src/components/Graph/DetailsPanel.tsx`

**Step 1: Create the new file**

Move `TraceDetails` (currently lines 910–941, re-grep after prior tasks). Required import:
- `import type { Trace } from '@/types/investigation';`

(Plus any icon imports the function body actually uses — grep to confirm.)

**Step 2: Update `DetailsPanel.tsx`**

Remove the moved block, add `import { TraceDetails } from './details/TraceDetails';`.

**Step 3: Type-check** → expect `exit=0`.

**Step 4: Smoke test**

Select a trace in the graph (click on the trace background or via the sidebar). Confirm panel renders title + edit/visibility/delete controls correctly.

**Step 5: Stop and report.**

---

### Task 4: Extract `ScriptRunDetails`

**Files:**
- Create: `frontend/src/components/Graph/details/ScriptRunDetails.tsx`
- Modify: `frontend/src/components/Graph/DetailsPanel.tsx`

**Step 1: Create the new file**

Move both `STATUS_BADGE` (currently lines 943–947) and `ScriptRunDetails` (949–1036) — `STATUS_BADGE` is used only by `ScriptRunDetails` (verified by grep — only call site at line 958), so it travels with the consumer.

Expected imports (re-grep to confirm):
- `import { useState } from 'react';` (if not already needed elsewhere in this file)
- `import type { ScriptRun } from '@/lib/api-client';`
- Any icons from `react-icons/fa6` referenced in the body.

**Step 2: Update `DetailsPanel.tsx`**

Remove both blocks, add `import { ScriptRunDetails } from './details/ScriptRunDetails';`.

**Step 3: Type-check** → expect `exit=0`.

**Step 4: Smoke test**

Trigger or select a recent script run (via the script-run badge on a node or from the run history). Confirm status badge, run metadata, and "Rerun" button render as before.

**Step 5: Stop and report.**

---

### Task 5: Extract `TransactionDetails` (+ `TransactionHeader`)

**Files:**
- Create: `frontend/src/components/Graph/details/TransactionDetails.tsx`
- Modify: `frontend/src/components/Graph/DetailsPanel.tsx`

This is the first medium-sized extraction. Move:
- `resolveWalletDisplay` helper (~lines 469–479) — used only by `TransactionDetails` (verified: call sites at lines 551–552).
- `TransactionHeader` (~lines 481–532) — keep as a non-exported helper inside `TransactionDetails.tsx`.
- `LINE_STYLES` constant (~lines 534–538) — used only at line 604.
- `TransactionDetails` (~lines 540–723) — exported.

**Step 1: Create the new file**

Order inside the new file: imports → `resolveWalletDisplay` → `LINE_STYLES` → `TransactionHeader` (not exported) → `TransactionDetails` (exported).

Required imports (all confirmed via grep against the original file):
- `import { useState, useRef } from 'react';`
- `import { TransactionEdge, WalletNode } from '@/types/investigation';`
- `import { CopyButton } from '@/components/Common/CopyButton';`
- `import { formatTokenAmount, normalizeToken, parseTimestamp } from '@/utils/formatAmount';`
- `import { buildTxExplorerUrl } from '@/utils/addressParser';`
- Any `react-icons/fa6` icons referenced in `TransactionHeader` or `TransactionDetails` bodies — grep to enumerate.

Note: `TransactionHeader` uses a render-time `setState` + `useRef` pattern to reset local state when the selected transaction changes. This is preserved verbatim — do not "clean it up."

**Step 2: Update `DetailsPanel.tsx`**

Delete all four blocks. Add:
```tsx
import { TransactionDetails } from './details/TransactionDetails';
```

**Step 3: Type-check** → expect `exit=0`.

**Step 4: Smoke test**

Click a single (non-bundled, non-aggregated) transaction edge in the graph. Confirm: header (token chip, color picker, edit/delete actions), from/to wallets, amount, line-style picker, all controls. Edit one field (e.g., notes) and verify it persists. Delete confirm flow works.

**Then click a *second*, different transaction** to confirm `TransactionHeader`'s render-time-reset pattern (label-edit state, etc.) clears correctly across selection changes. This is the specific behavior most at risk from the file move.

**Step 5: Stop and report.**

---

### Task 6: Extract `GroupDetails`

**Files:**
- Create: `frontend/src/components/Graph/details/GroupDetails.tsx`
- Modify: `frontend/src/components/Graph/DetailsPanel.tsx`

**Step 1: Create the new file**

Move:
- `fmtFlow` helper (~lines 725–731) — used only by `GroupDetails` (call sites at lines 867, 880).
- `GroupDetails` (~lines 733–908).

Imports: grep the body to confirm. Expect group/trace/wallet types and icon imports.

**Step 2: Update `DetailsPanel.tsx`**

Remove both blocks, add `import { GroupDetails } from './details/GroupDetails';`.

**Step 3: Type-check** → expect `exit=0`.

**Step 4: Smoke test**

Select a group (cluster) in the graph. Confirm: title, member list, inflow/outflow totals (these use `fmtFlow`), color/shape pickers, delete and dissolve actions.

**Step 5: Stop and report.**

---

### Task 7: Extract `WalletDetails` (largest)

**Files:**
- Create: `frontend/src/components/Graph/details/WalletDetails.tsx`
- Modify: `frontend/src/components/Graph/DetailsPanel.tsx`

This is the biggest move — 292 lines plus 5 co-located constants/helpers.

**Step 1: Create the new file**

Move in this order:
- `ADDRESS_TYPE_LABELS`, `ADDRESS_TYPE_COLORS` (~lines 132–142)
- `NODE_SHAPES` (~lines 144–151)
- `getCategoryStyle` (~lines 153–165)
- `BUNDLE_COLORS` (~lines 167–174)
- `WalletDetails` function (~lines 176–467) — exported.

All five are used only by `WalletDetails` (verified earlier — call sites at lines 219–220, 248, 277, 350, 376 are all inside `WalletDetails`'s body).

Required imports (grep to enumerate the full icon set, but at minimum):
- `import { useState, useRef } from 'react';`
- `import { WalletNode, Trace } from '@/types/investigation';`
- `import { CopyButton } from '@/components/Common/CopyButton';`
- `import type { LabeledEntity } from '@/lib/api-client';`
- Icons from `react-icons/fa6` (e.g., `FaXmark`, `FaArrowRightToBracket`, `FaArrowRightFromBracket`, plus anything else referenced).

**Cleanup during move:** the original code uses an inline type form `lookupAddress: (address: string) => import('@/lib/api-client').LabeledEntity | undefined`. Convert this to a normal top-of-file `import type { LabeledEntity } from '@/lib/api-client';` and write the prop type as `LabeledEntity | undefined`. This is the *only* non-mechanical change permitted in the refactor — it's an equivalent rewrite of an awkward inline type, not a behavior change.

**Step 2: Update `DetailsPanel.tsx`**

Delete all five blocks. Add `import { WalletDetails } from './details/WalletDetails';`.

**Step 3: Type-check** → expect `exit=0`.

**Step 4: Smoke test** — exercise the full `WalletDetails` surface:

- Select a wallet → confirm address, type chip, category badge (uses `getCategoryStyle`), label/notes editing.
- **Then select a *second*, different wallet** without closing the panel → confirm local state (notes draft, confirm-delete flags, bundle-color pickers) resets correctly. This is the specific behavior most at risk from the file move.
- Try changing node shape (uses `NODE_SHAPES`).
- Open the bundle-all-outbound flow → color swatches render (uses `BUNDLE_COLORS`) → confirm delete works.
- Repeat for bundle-all-inbound.
- "Fetch history" button works.

**Step 5: Stop and report.**

---

### Task 8: Final cleanup of `DetailsPanel.tsx`

**Files:**
- Modify: `frontend/src/components/Graph/DetailsPanel.tsx`

By this point, `DetailsPanel.tsx` should contain only:
- Imports (including the seven `import { XDetails } from './details/XDetails';` lines, plus `forwardRef`, `useImperativeHandle`, `useState` from React)
- `DetailsPanelProps` interface
- Exported `DetailsPanelHandle` interface (consumed by `page.tsx`)
- The main `DetailsPanel` component, declared via `forwardRef<DetailsPanelHandle, DetailsPanelProps>(function DetailsPanel(...) {...})`
- The `useImperativeHandle` wiring that exposes `startEdit`
- The `switch` on `selectedItem.type` dispatching to each child component

`DetailsPanelHandle`, `forwardRef`, and `useImperativeHandle` are load-bearing — `page.tsx` imports `DetailsPanelHandle` and calls `detailsPanelRef.current?.startEdit()`. Do **not** drop them, do **not** convert to a plain function component.

**Step 1: Audit and clean imports**

Open `DetailsPanel.tsx`. Remove any imports that are no longer used (icons, types, helpers that were only referenced by the now-extracted components). VS Code / `tsc` will flag these as unused if you have `noUnusedLocals` enabled; if not, eyeball the import list against the remaining body.

**Step 2: Investigate `TYPE_DISPLAY`**

Grep the whole frontend for `TYPE_DISPLAY` references:
```bash
grep -rn "TYPE_DISPLAY" frontend/src
```

If the only hit is its definition inside `DetailsPanel.tsx`, it is **dead code**. **Do not silently delete it.** Flag it to the user in the final report as a separate finding: "Found unused symbol `TYPE_DISPLAY` at line N during refactor — recommend removing in a follow-up commit." Leave the symbol in place during this refactor. Pure file-split means no semantic deletions.

If grep finds external consumers (unlikely — it's not exported), leave it where it is and note the consumer in the report.

**Step 3: Confirm size and shape**

Run `wc -l frontend/src/components/Graph/DetailsPanel.tsx`. Expected: roughly 110–140 lines (slightly higher if `TYPE_DISPLAY` is left in place pending the dead-code decision).

Eyeball the file:
- Should be: imports → `DetailsPanelProps` → `DetailsPanelHandle` → (possibly `TYPE_DISPLAY`) → `DetailsPanel` forwardRef component.
- Should NOT contain any `*Details` function definitions, any of the moved constants (`ADDRESS_TYPE_*`, `NODE_SHAPES`, `LINE_STYLES`, `BUNDLE_COLORS`, `STATUS_BADGE`), or any of the moved helpers (`getCategoryStyle`, `resolveWalletDisplay`, `fmtFlow`).

**Step 4: Type-check the whole frontend**

```bash
cd frontend && npx tsc --noEmit; echo "exit=$?"
```
Expected: `exit=0`.

**Step 5: Full smoke test**

Click through every entity type one last time in the dev server: wallet, transaction, group, trace, edge bundle, aggregated edge, script run. The panel must look and behave identically to before the refactor.

For each entity type that supports it (wallet, transaction): also click a **second** of that type to verify local-state reset across selection changes.

**Step 6: Final report**

Report:
- Final `DetailsPanel.tsx` line count.
- New files created and their line counts.
- Type-check result.
- Smoke-test summary (per entity type: pass/fail).
- `TYPE_DISPLAY` finding from Step 2 (dead code? external consumer?).
- `git status` output.

Do NOT commit. The user will review the working tree and commit themselves.

---

## Not in scope

- Splitting `WalletDetails` or `GroupDetails` into sub-subcomponents (e.g., a separate `BundleAllControls`). They're feature-dense by nature — revisit only if a specific section grows again.
- Introducing a barrel file (`details/index.ts`) — premature; the seven explicit imports in `DetailsPanel.tsx` are fine.
- Moving `MultiTxDetails.tsx` into `details/`. It's already extracted and shared by two consumers (`EdgeBundleDetails` and `AggregatedEdgeDetails`); keeping it at `components/Graph/` signals its shared nature.
- Adding unit tests for the extracted components. The project has no existing unit-test infrastructure for these components, and TDD doesn't apply to a pure file-split.
- Renaming anything. All exports keep their existing names so call sites in `DetailsPanel.tsx`'s switch are a one-line swap (remove inline definition → add import).

## Risks and mitigations

- **Risk:** A constant or helper turns out to be used by more than one consumer (grep missed something). **Mitigation:** Each task includes a re-grep step before moving. If a second consumer is discovered mid-task, halt that task and re-decide whether the symbol should live in `DetailsPanel.tsx` (stays put) or a new `details/shared.ts` (introduced lazily, only if 2+ consumers).
- **Risk:** Import-path typos break the dev build. **Mitigation:** `npx tsc --noEmit` after every task — it will catch missing/wrong imports immediately.
- **Risk:** A subcomponent silently regresses because the props it accepts changed during the move. **Mitigation:** Copy/paste discipline — move the function body verbatim, do not edit. The smoke test per task is the second line of defense.
- **Risk:** Apparent dead code (`TYPE_DISPLAY`) is silently deleted during the move, but turns out to be referenced somewhere the local grep missed (e.g., dynamic key lookup, JSX prop). **Mitigation:** Pure file-split means **no semantic deletions**. Anything that looks dead is *flagged* in the final report and left in place; the user decides whether to remove it in a follow-up. The only non-mechanical change allowed in this refactor is the `LabeledEntity` inline-type-import cleanup in Task 7 (called out explicitly).
- **Risk:** `forwardRef` / `useImperativeHandle` / `DetailsPanelHandle` gets dropped during the cleanup in Task 8, breaking `page.tsx`'s `detailsPanelRef.current?.startEdit()` call. **Mitigation:** Task 8's preamble explicitly enumerates these as load-bearing; final type-check will catch a regression (`page.tsx` will error on a missing exported type or missing imperative method).
