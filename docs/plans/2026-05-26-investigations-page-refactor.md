# Investigations Page Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce `frontend/src/app/cases/[caseId]/investigations/page.tsx` (currently 1,504 lines) to a thin orchestrator (~250–300 lines) by extracting pure utilities, domain hooks, and JSX clusters. **No behavior changes** — this is a structural refactor.

**Architecture:** Four phases, ordered by risk and ROI. Phase 1 extracts pure functions and small subcomponents (zero behavior risk). Phase 2 extracts five custom hooks that own discrete slices of page state. Phase 3 splits the JSX into named subcomponents that each hold one logical cluster. Phase 4 verifies the final page reads cleanly and removes any dead code. Each task moves code, then re-imports it — the file count grows but the page shrinks.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript (strict), Jest + ts-jest + React Testing Library, Tailwind, Cytoscape.js. Path alias `@/` → `frontend/src/`.

---

## Atomized Changes

| #    | File | Action | Purpose |
|------|------|--------|---------|
| 1    | `frontend/src/utils/focusItem.ts` | Create | Pure `resolveEndpointLabel` + `resolveFocusItem` — pulled out of the page so the page no longer carries 110 lines of resolver logic, and so the functions are unit-testable in isolation. |
| 2    | `frontend/src/utils/focusItem.test.ts` | Create | Coverage for all 6 `FocusItem` variants + endpoint-label precedence (trace > group > wallet > fallback). |
| 3    | `frontend/src/components/Graph/HeaderActions.tsx` | Create | `EditDeleteActions`, `WalletHeaderActions`, `TransactionHeaderActions`. Inline SVGs swapped for `react-icons/fa6` (`FaPenToSquare`, `FaTrash`) to match the project's no-emoji + react-icons rule. |
| 4    | `frontend/src/utils/arcEdge.ts` | Create | `applyArcDelta(investigation, edgeId, delta, { updateTransaction, updateEdgeBundle, setEphemeralArc })` — pure dispatcher pulled from the page's 30-line `onArcEdge` inline callback. Returns `true` when persisted, `false` when no backing entity (caller falls back to ephemeral). |
| 4b   | `frontend/src/utils/arcEdge.test.ts` | Create | Coverage: persists to TransactionEdge / EdgeBundle, resets when delta===null, returns false when investigation null or edgeId matches neither. |
| 5    | `frontend/src/utils/edgeBundling.ts` | Create | `computeDirectionalBundlingPlan(...)` + `computeSelectionBundlingPlan(...)` — extracts the ~80% duplicated logic between `handleBundleAllOutbound`, `handleBundleAllInbound`, and `handleBundleEdges`. Single source of truth for grouping edges by `(counterpartyAddress, tokenSymbol)`. |
| 6    | `frontend/src/utils/edgeBundling.test.ts` | Create | Coverage: outbound vs inbound, bundle consumption + rebuild, single-edge groups skipped, cross-trace edges, missing wallet. **Written together with Task 5 — see Task 5 step ordering.** |
| 7    | `frontend/src/hooks/useInvestigationUrlSync.ts` | Create | Owns `?inv=` ↔ `activeInvestigationId` two-way sync. Returns `{ activeInvestigationId, selectInvestigation, clearInvestigation }`. |
| 8    | `frontend/src/hooks/useInvestigationLoader.ts` | Create | Owns load-by-id, scriptRuns 10s polling, debounced trace auto-save, and `onGraphUpdated` subscription. Returns `{ loading, scriptRuns, reloadCurrent, refreshScriptRuns }`. |
| 8b   | `frontend/src/hooks/useInvestigationLoader.test.ts` | Create | Debounced auto-save test (1s debounce → exactly one `updateTrace` per trace after N mutations within the window) + reload-on-id-change test. Highest-risk effect in the refactor. |
| 9    | `frontend/src/hooks/useSelectedItem.ts` | Create | Owns `selectedItem` state + the re-derive-after-investigation-mutation effect. Returns `{ selectedItem, setSelectedItem, clearSelection }`. |
| 9b   | `frontend/src/hooks/useSelectedItem.test.ts` | Create | Coverage: deleted wallet/tx/group/bundle clears selection; aggregatedEdge with all-deleted underlying edges clears; surviving partial set keeps panel open with filtered edges. |
| 10   | `frontend/src/hooks/useEdgeBundling.ts` | Create | Wraps `utils/edgeBundling.ts` into a hook that takes investigation + mutators and returns `{ handleBundleEdges, handleBundleAllOutbound, handleBundleAllInbound, handleDeleteAllOutbound, handleDeleteAllInbound }`. |
| 11   | `frontend/src/hooks/useBatchNodeOps.ts` | Create | Owns rename / recolor / delete / group / add-to-group / extract-to-trace and the `selectedGroupEntry` memo. |
| 11b  | `frontend/src/hooks/useWalletTransactionAuthoring.ts` | Create | Owns `handleSaveNewWallet`, `findOrCreateWallet`, `handleSaveNewTransaction`, `handleAddStagedToTrace` — the four creation paths that share the address-normalization + wallet-resolution logic. ~165 lines moved out of the page. |
| 11c  | `frontend/src/hooks/useGraphContextMenu.ts` | Create | Owns `handleAddTrace`, `handleCreateWalletAtPosition`, `handleContextMenu`, `handleLabelContextMenu`, and the `cytoscapeCallbacks` useMemo. ~150 lines moved out of the page. Wires through `lastFocusedTraceId` state too. |
| 12   | `frontend/src/types/panel.ts` | Create | `PanelMode` discriminated union. Was inline in the page; promoted to its own type module so `CreationPanels` and the page share it. |
| 13   | `frontend/src/components/Graph/CreationPanels.tsx` | Create | The two modal forms (`createWallet`, `createTransaction`) currently rendered by `renderCreationPanel()`. Becomes a real component. |
| 14   | `frontend/src/components/Graph/SelectionDetailsPanel.tsx` | Create | The big `FloatingPanel` + `DetailsPanel` block (~115 lines) — wallet/tx/trace/group/edgeBundle/aggregatedEdge details with edit/delete/color/arc callbacks. |
| 15   | `frontend/src/components/Workspace/WorkspaceModals.tsx` | Create | Investigation edit form, delete confirm, search panel, fetch modal, staging panel — five overlay clusters with no shared logic, just spatial co-location at the bottom of the page render. |
| 16   | `frontend/src/components/Workspace/WorkspaceEmptyState.tsx` | Create | The logo + "Select or create an investigation" block (lines 1442–1459). |
| 17   | `frontend/src/app/cases/[caseId]/investigations/page.tsx` | Modify | Becomes a thin orchestrator: imports the hooks above, wires callbacks, renders the JSX components above. Target: ~280–320 lines (revised from initial 250–300 estimate after audit). |

### What changes (UX and DX)

**For the user (UX):**
- **Nothing.** This is a no-behavior refactor. If a user notices any visual or interactive change, that's a bug, not a feature.

**For the developer (DX):**
- The page becomes navigable. Today, finding "where does edge bundling live" means scrolling through ~280 lines of three near-identical inlined handlers. After this, it's `hooks/useEdgeBundling.ts` and `utils/edgeBundling.ts`.
- The duplicated outbound/inbound bundling code becomes one function with a `direction` parameter. Future changes (e.g. adding a third "bidirectional" mode) require one edit, not two.
- Pure resolvers (`resolveFocusItem`, `resolveEndpointLabel`, `applyArcDelta`, edge-bundling math) gain unit tests. Today none of these have tests.
- Hooks become the right size for AI-assisted edits — context windows can hold the file plus surrounding context without summarization.
- The page's role becomes legible at a glance: import hooks, wire them together, render the layout.

---

## Architectural call-outs (read before implementing)

1. **No behavior changes — this means no behavior changes.** Not even "small improvements." If you spot a bug while moving code, leave it in place and log it in a `## Engineering Decisions Made` block at the end of execution. A refactor that fixes bugs hides the bugs in the diff.
2. **Move, don't rewrite.** Copy the existing logic verbatim into the new file, change imports/exports, delete from the old file. Resist the urge to "clean up" the moved code. The exception is the edge-bundling consolidation (Task 5/6/10) — there the rewrite IS the point, and the new code must produce identical results for both outbound and inbound paths. Tests in Task 6 are how we know.
3. **Hooks must preserve identity rules.** Several callbacks in the page are dependencies of `cytoscapeCallbacks` (a `useMemo`). If a hook returns a callback whose identity changes every render, it tears down Cytoscape event bindings constantly. Wrap returned callbacks in `useCallback` with the same dependency lists they had inline. When in doubt, copy the deps array verbatim.
4. **The auto-save effect is load-bearing.** Lines 354–385 debounce 1s, then `PATCH` every trace via `apiClient.updateTrace`. Two pitfalls when moving it into `useInvestigationLoader`: (a) the `saveTimeoutRef = useMemo({ current: null })` pattern is intentional — it gives the ref stable identity across renders without using `useRef` (which would trigger lint warnings about ref-in-deps); preserve it. (b) the `if (!investigation || loading) return;` guard prevents a load-then-immediate-save loop. Keep both guards.
5. **`useSelectedItem` must NOT depend on `selectedItem` in the re-derive effect deps.** The effect at lines 395–435 has `// eslint-disable-line react-hooks/exhaustive-deps` with deps `[investigation]` only. Adding `selectedItem` causes an infinite loop because the effect calls `setSelectedItem`. Preserve the disable comment and the partial deps array.
6. **`updateSidebar` is consumed by `CaseContext`, which the page does NOT own.** Lines 494–520 push the sidebar slice into `CaseContext` via `updateSidebar()`. Every value referenced in the effect body MUST stay in the deps array — the comment at line 491 explains why (missing deps cause an infinite re-render loop because `updateSidebar` always creates a new sidebar object). When you move the sidebar wiring, copy the deps array exactly. Do not move this into a hook in Phase 2 — it depends on too many hook outputs and would create a circular import; keep it in the page.
7. **`graphRef` and `detailsPanelRef` stay in the page.** They're imperative handles to `GraphCanvas` and `DetailsPanel`, both rendered by the page. Passing refs into hooks creates lifecycle ordering problems (ref isn't attached when the hook initializes). Hooks that need to call into the graph receive the ref-callback as a parameter, not the ref itself.
8. **`apiClient` calls live in hooks, not in `utils/`.** `utils/` is for pure functions. Anything that does network I/O goes in a hook. This keeps utils testable without mocks.
9. **No commits inside tasks.** Per project CLAUDE.md: leave changes in the working tree. Each task ends with `git status` for visibility. The user commits after reviewing.
10. **One file moved per task, with its tests committed alongside (mentally).** Don't batch "move 3 utilities" into one task. If something breaks, a single-file undo should be enough to recover. The Phase 3 component extractions are the exception — those are atomic (component + import wiring in the page must change together).
11. **`react-icons/fa6` is already in use.** The page imports `FaMagnifyingGlass, FaDownload` from `react-icons/fa6` at line 23. The inline `EDIT_ICON` and `TRASH_ICON` SVGs (lines 44–58) are inconsistent with this. When you move them into `HeaderActions.tsx`, swap for `FaPenToSquare` and `FaTrash` (both 13px size, `text-ink-faint` color to match the existing hover behavior). This is the one allowed cosmetic change — it aligns with the project's no-emojis rule which mandates react-icons.
12. **Existing test conventions to follow.** See `frontend/src/hooks/cytoscapeSync.test.ts` for fixture-builder style (`wallet()`, `edge()`, `trace()`, `inv()` factory functions at the top of the file) and `frontend/src/lib/exportTheme.test.ts` for simple-pure-function style. Use the former when the test touches `Investigation` / `Trace`; use the latter for one-off pure helpers. Tests live next to the file they test (`focusItem.test.ts` next to `focusItem.ts`).
13. **TypeScript strict mode is on.** No `any` in new code — if you encounter `any` while moving (e.g. `selectedItem: any | null` on line 290 of the page), keep it as `any` in the moved code; do not retype it in this refactor. Retyping `selectedItem` is its own change with non-trivial downstream impact.
14. **Verify after every task with `npm run build --prefix frontend`.** TypeScript errors are how we know the imports rewired correctly. A passing build is the minimum bar. Tests run via `npm test --prefix frontend`.
15. **Callback identity in hook props must be stable, or wrapped via ref inside the hook.** This came up in plan review: `useInvestigationLoader` accepts an `onBeforeLoad` callback that's a dependency of the internal `loadInvestigation` `useCallback`. If the page passes a fresh arrow on every render, `loadInvestigation`'s identity churns → the load effect re-fires every render → infinite fetch. The fix used in Task 9 is the ref-mirror pattern from `useCytoscape.ts:46-55`: mirror the prop into a ref inside the hook, drop it from `useCallback` deps. Any future hook in this refactor that accepts a callback prop AND uses it inside an effect or `useCallback` MUST do the same. Do not push the burden onto the caller via "remember to wrap it in `useCallback` yourself" — that's a foot-gun.
16. **Plan-review must-fix items addressed:** (a) Two additional hooks (`useWalletTransactionAuthoring` Task 11b, `useGraphContextMenu` Task 11c) were added after audit — the page would have landed at ~450 lines without them. (b) Hook-test tasks were added for `useInvestigationLoader` (Task 8b — debounce semantics) and `useSelectedItem` (Task 9b — clear-on-delete) since those carry the most regression risk. (c) `arcEdge` got its own test task (4b). (d) The `types/panel.ts` file is now a row in the Atomized Changes table (Task 12) instead of being hidden inside an earlier task.

---

## Phase 1 — Pure helpers and small subcomponents

### Task 1: Extract `resolveEndpointLabel` + `resolveFocusItem` into `utils/focusItem.ts`

**Files:**
- Create: `frontend/src/utils/focusItem.ts`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx` (delete lines 124–241, add import)

**Step 1: Create `frontend/src/utils/focusItem.ts`** — copy the bodies of `resolveEndpointLabel` (page lines 132–168) and `resolveFocusItem` (page lines 174–241) verbatim. Imports needed at the top:

```ts
import type { FocusItem } from '@/hooks/useCytoscape';
import type { Investigation, TransactionEdge } from '@/types/investigation';
```

Export both as named exports.

**Step 2: Delete lines 124–241 from the page** and add `import { resolveFocusItem } from '@/utils/focusItem';` near the other `@/utils/...` imports (around page line 33).

**Step 3: Verify build**

Run: `npm run build --prefix frontend`
Expected: build succeeds, no TS errors.

**Step 4: Run `git status`**

Expected: 2 files modified/created.

---

### Task 2: Test coverage for `utils/focusItem.ts`

**Files:**
- Create: `frontend/src/utils/focusItem.test.ts`

**Step 1: Write fixture-builder-style tests** following `frontend/src/hooks/cytoscapeSync.test.ts` conventions. At minimum, cover:

```ts
import { resolveEndpointLabel, resolveFocusItem } from './focusItem';
import type { Investigation, Trace, WalletNode, TransactionEdge, Group, EdgeBundle } from '@/types/investigation';

function wallet(id: string, o: Partial<WalletNode> = {}): WalletNode { /* see cytoscapeSync.test.ts */ }
function edge(id: string, from: string, to: string, o: Partial<TransactionEdge> = {}): TransactionEdge { /* ... */ }
function trace(id: string, o: Partial<Trace> = {}): Trace { /* ... */ }
function inv(traces: Trace[]): Investigation { /* ... */ }

describe('resolveEndpointLabel', () => {
  it('returns "TraceName (N)" when trace is collapsed', () => { /* ... */ });
  it('returns trace name when trace is expanded', () => { /* ... */ });
  it('returns "GroupName (count)" when group is collapsed', () => { /* ... */ });
  it('returns group name when group is expanded', () => { /* ... */ });
  it('returns wallet.label when set', () => { /* ... */ });
  it('returns truncated address when wallet has no label', () => { /* ... */ });
  it('returns first-8-then-ellipsis fallback for unknown id', () => { /* ... */ });
});

describe('resolveFocusItem', () => {
  it('returns null when focusItem is null', () => { /* ... */ });
  it('returns null when investigation is null', () => { /* ... */ });
  it('resolves trace focusItem to the trace', () => { /* ... */ });
  it('resolves wallet focusItem', () => { /* ... */ });
  it('resolves group focusItem', () => { /* ... */ });
  it('resolves transaction focusItem', () => { /* ... */ });
  it('resolves edgeBundle focusItem', () => { /* ... */ });
  it('returns null for aggregatedEdge when underlying edges were deleted (race condition)', () => { /* ... */ });
  it('parses src/tgt from synthetic edge id for aggregatedEdge', () => { /* ... */ });
});
```

**Step 2: Run tests**

Run: `npm test --prefix frontend -- focusItem`
Expected: all tests pass.

**Step 3: Run `git status`**

---

### Task 3: Extract `HeaderActions.tsx` (swap inline SVGs for `react-icons/fa6`)

**Files:**
- Create: `frontend/src/components/Graph/HeaderActions.tsx`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx` (delete lines 44–122, add import)

**Step 1: Create the file**

```tsx
'use client';

import { useState } from 'react';
import { FaPenToSquare, FaTrash } from 'react-icons/fa6';
import { LabelColorPicker } from '@/components/Common/LabelColorPicker';
import type { WalletNode, TransactionEdge } from '@/types/investigation';

export function EditDeleteActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <button onClick={onEdit} title="Edit" className="text-ink-faint hover:text-ink-muted transition-colors">
        <FaPenToSquare size={13} />
      </button>
      {confirmDelete ? (
        <div className="flex items-center gap-1">
          <button onClick={() => { onDelete(); setConfirmDelete(false); }}
            className="text-[10px] px-1.5 py-0.5 bg-red-600 hover:bg-red-500 rounded text-white">
            Delete
          </button>
          <button onClick={() => setConfirmDelete(false)} className="text-[10px] text-ink-muted hover:text-white">
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirmDelete(true)} title="Delete" className="text-ink-faint hover:text-red-400 transition-colors">
          <FaTrash size={13} />
        </button>
      )}
    </div>
  );
}

export function TransactionHeaderActions({ transaction, onEdit, onDelete, onColorChange }: {
  transaction: TransactionEdge;
  onEdit: () => void;
  onDelete: () => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <LabelColorPicker color={transaction.color || '#10b981'} onChange={onColorChange} />
      <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

export function WalletHeaderActions({ wallet, onEdit, onDelete, onColorChange }: {
  wallet: WalletNode;
  onEdit: () => void;
  onDelete: () => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <LabelColorPicker color={wallet.color || '#60a5fa'} onChange={onColorChange} />
      <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}
```

**Step 2: Delete page lines 44–122 and add import**

In the page, replace the deleted block with:

```ts
import { WalletHeaderActions, TransactionHeaderActions } from '@/components/Graph/HeaderActions';
```

Place near the other `@/components/Graph/...` imports.

**Step 3: Verify build and visual smoke-test**

Run: `npm run build --prefix frontend`
Expected: build succeeds.

Open the investigation page in the browser. Select a wallet → confirm pencil + trash icons render in the floating panel header. Click pencil → edit mode opens. Click trash → inline confirm appears. Same for a transaction.

**Visual parity check:** the inline SVGs were stroke-style (stroke-width 2), `react-icons/fa6` ships filled-style at the same nominal size. Take a before/after screenshot of the wallet floating panel header. If the icons look meaningfully heavier or lighter than the rest of the header iconography, adjust the size prop (try 12 or 14) before moving on. If still off, swap to the outline variant from `react-icons/fa6` (`FaRegPenToSquare`, `FaRegTrashCan`).

**Step 4: Run `git status`**

---

### Task 4: Extract `applyArcDelta` into `utils/arcEdge.ts`

**Files:**
- Create: `frontend/src/utils/arcEdge.ts`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx` (replace the inline `onArcEdge` body — lines 1321–1352 — with a one-line call)

**Step 1: Create the util**

```ts
import type { Investigation, Trace } from '@/types/investigation';

interface ArcMutators {
  updateTransaction: (traceId: string, txId: string, patch: { hasArc?: boolean; arcOffset?: number }) => void;
  updateEdgeBundle: (traceId: string, bundleId: string, patch: { hasArc?: boolean; arcOffset?: number }) => void;
}

/**
 * Persist an arc-offset delta on the backing entity (TransactionEdge or EdgeBundle)
 * for the edge identified by `edgeId`. Returns true when a backing entity was found
 * and the mutation dispatched. Returns false for synthetic aggregated edges, which
 * have no backing entity — caller falls back to ephemeral cy-only override.
 *
 * `delta === null` resets the arc (clears hasArc + arcOffset). Otherwise the delta
 * is added to the current arcOffset (default 0).
 */
export function applyArcDelta(
  investigation: Investigation | null,
  edgeId: string,
  delta: number | null,
  mutators: ArcMutators
): boolean {
  if (!investigation) return false;
  for (const trace of investigation.traces) {
    const edge = trace.edges.find((e) => e.id === edgeId);
    if (edge) {
      if (delta === null) {
        mutators.updateTransaction(trace.id, edgeId, { hasArc: undefined, arcOffset: undefined });
      } else {
        const next = (edge.arcOffset ?? 0) + delta;
        mutators.updateTransaction(trace.id, edgeId, { hasArc: true, arcOffset: next });
      }
      return true;
    }
    const bundle = (trace.edgeBundles || []).find((b) => b.id === edgeId);
    if (bundle) {
      if (delta === null) {
        mutators.updateEdgeBundle(trace.id, edgeId, { hasArc: undefined, arcOffset: undefined });
      } else {
        const next = (bundle.arcOffset ?? 0) + delta;
        mutators.updateEdgeBundle(trace.id, edgeId, { hasArc: true, arcOffset: next });
      }
      return true;
    }
  }
  return false;
}
```

**Step 2: Replace the page's inline `onArcEdge` callback** (currently lines 1321–1352) with:

```tsx
onArcEdge={(edgeId, delta) => {
  const persisted = applyArcDelta(investigation, edgeId, delta, { updateTransaction, updateEdgeBundle });
  if (!persisted) graphRef.current?.setEdgeArc(edgeId, delta);
}}
```

Add `import { applyArcDelta } from '@/utils/arcEdge';` to the imports.

**Step 3: Verify build + smoke test**

Run: `npm run build --prefix frontend`. Then in the browser, drag an edge to bend it (arc), refresh — arc persists. Reset the arc — clears. Test on a transaction edge, a bundled edge, and a synthetic aggregated edge (the synthetic should still arc visually but not persist).

**Step 4: Run `git status`**

---

### Task 4b: Tests for `utils/arcEdge.ts`

**Files:**
- Create: `frontend/src/utils/arcEdge.test.ts`

**Step 1: Write tests**

```ts
import { applyArcDelta } from './arcEdge';
import type { Investigation } from '@/types/investigation';
// fixture builders wallet/edge/trace/inv from cytoscapeSync.test.ts

describe('applyArcDelta', () => {
  it('returns false when investigation is null', () => { /* ... */ });
  it('returns false when edgeId matches neither a transaction nor a bundle', () => { /* ... */ });

  it('persists hasArc + accumulated arcOffset to TransactionEdge', () => {
    const mutators = { updateTransaction: jest.fn(), updateEdgeBundle: jest.fn() };
    const investigation = inv([trace('t1', { edges: [edge('e1', 'w1', 'w2', { arcOffset: 10 })] })]);
    const result = applyArcDelta(investigation, 'e1', 5, mutators);
    expect(result).toBe(true);
    expect(mutators.updateTransaction).toHaveBeenCalledWith('t1', 'e1', { hasArc: true, arcOffset: 15 });
    expect(mutators.updateEdgeBundle).not.toHaveBeenCalled();
  });

  it('resets TransactionEdge arc when delta is null', () => {
    const mutators = { updateTransaction: jest.fn(), updateEdgeBundle: jest.fn() };
    const investigation = inv([trace('t1', { edges: [edge('e1', 'w1', 'w2', { arcOffset: 10 })] })]);
    applyArcDelta(investigation, 'e1', null, mutators);
    expect(mutators.updateTransaction).toHaveBeenCalledWith('t1', 'e1', { hasArc: undefined, arcOffset: undefined });
  });

  it('persists to EdgeBundle when edgeId matches a bundle', () => { /* ... */ });
  it('resets EdgeBundle arc when delta is null', () => { /* ... */ });

  it('treats undefined arcOffset as 0', () => {
    const mutators = { updateTransaction: jest.fn(), updateEdgeBundle: jest.fn() };
    const investigation = inv([trace('t1', { edges: [edge('e1', 'w1', 'w2')] })]); // no arcOffset
    applyArcDelta(investigation, 'e1', 7, mutators);
    expect(mutators.updateTransaction).toHaveBeenCalledWith('t1', 'e1', { hasArc: true, arcOffset: 7 });
  });
});
```

**Step 2: Run tests**

Run: `npm test --prefix frontend -- arcEdge`
Expected: all tests pass.

**Step 3: Run `git status`**

---

### Task 5: Extract `utils/edgeBundling.ts` (consolidates outbound/inbound)

**Files:**
- Create: `frontend/src/utils/edgeBundling.ts`

**Step 1: Write the consolidated util**

The key insight: outbound and inbound differ in 3 places — filter predicate (`edge.from === walletId` vs `edge.to === walletId`), bundle filter (`bundle.fromNodeId === walletId` vs `bundle.toNodeId === walletId`), and group key (counterparty is `toAddr` vs `fromAddr`). Parameterize over `direction`.

```ts
import type { Investigation, EdgeBundle, TransactionEdge } from '@/types/investigation';
import { normalizeToken } from '@/utils/formatAmount';

export type BundleDirection = 'outbound' | 'inbound';

export interface PlannedBundle {
  fromNodeId: string;
  toNodeId: string;
  token: string;
  edgeIds: string[];
}

export interface DirectionalBundlingPlan {
  walletTraceId: string;
  affectedEdgeIds: Set<string>;
  consumedBundleIds: { traceId: string; bundleId: string }[];
  newBundles: PlannedBundle[];
}

/**
 * Compute the set of new bundles + the existing bundles to consume, given a wallet
 * and a direction. Pure — does not mutate. Returns null if the wallet isn't in any
 * trace or if there are no edges in the requested direction.
 *
 * Used by handleBundleAllOutbound / handleBundleAllInbound.
 */
export function computeDirectionalBundlingPlan(
  investigation: Investigation,
  walletId: string,
  direction: BundleDirection
): DirectionalBundlingPlan | null {
  let walletTraceId = '';
  for (const t of investigation.traces) {
    if (t.nodes.some((n) => n.id === walletId)) { walletTraceId = t.id; break; }
  }
  if (!walletTraceId) return null;

  const nodeAddr = new Map<string, string>();
  for (const trace of investigation.traces) {
    for (const node of trace.nodes) nodeAddr.set(node.id, node.address);
  }

  const matchesDirection = (edge: TransactionEdge) =>
    direction === 'outbound' ? edge.from === walletId : edge.to === walletId;
  const bundleMatchesDirection = (b: EdgeBundle) =>
    direction === 'outbound' ? b.fromNodeId === walletId : b.toNodeId === walletId;

  const affectedEdgeIds = new Set<string>();
  const consumedBundleIds: { traceId: string; bundleId: string }[] = [];
  for (const trace of investigation.traces) {
    for (const edge of trace.edges) {
      if (matchesDirection(edge)) affectedEdgeIds.add(edge.id);
    }
    for (const bundle of trace.edgeBundles || []) {
      if (bundleMatchesDirection(bundle)) {
        bundle.edgeIds.forEach((eid) => affectedEdgeIds.add(eid));
        consumedBundleIds.push({ traceId: trace.id, bundleId: bundle.id });
      }
    }
  }
  if (affectedEdgeIds.size === 0) return null;

  const groups = new Map<string, PlannedBundle>();
  for (const trace of investigation.traces) {
    for (const edge of trace.edges) {
      if (!affectedEdgeIds.has(edge.id)) continue;
      const token = normalizeToken(edge.token).symbol;
      const counterpartyAddr = direction === 'outbound'
        ? (nodeAddr.get(edge.to) || edge.to)
        : (nodeAddr.get(edge.from) || edge.from);
      const key = `${counterpartyAddr}::${token}`;
      if (!groups.has(key)) {
        groups.set(key, { fromNodeId: edge.from, toNodeId: edge.to, token, edgeIds: [] });
      }
      groups.get(key)!.edgeIds.push(edge.id);
    }
  }

  return {
    walletTraceId,
    affectedEdgeIds,
    consumedBundleIds,
    newBundles: [...groups.values()].filter((g) => g.edgeIds.length >= 2),
  };
}

/**
 * Group selected edge ids (which may be a mix of raw edges and existing bundle ids)
 * by (fromAddr, toAddr, tokenSymbol). Used by handleBundleEdges (the multi-select
 * "Bundle" button path).
 */
export interface SelectionBundlingPlan {
  consumedBundleIds: { traceId: string; bundleId: string }[];
  newBundles: { traceId: string; bundle: PlannedBundle }[];
}

export function computeSelectionBundlingPlan(
  investigation: Investigation,
  selectedEdgeIds: string[]
): SelectionBundlingPlan {
  const nodeAddr = new Map<string, string>();
  for (const trace of investigation.traces) {
    for (const node of trace.nodes) nodeAddr.set(node.id, node.address);
  }

  const fromBundles = new Set<string>();
  const rawEdgeIds: string[] = [];
  const consumedBundleIds: { traceId: string; bundleId: string }[] = [];
  for (const id of selectedEdgeIds) {
    let found = false;
    for (const trace of investigation.traces) {
      const bundle = (trace.edgeBundles || []).find((b) => b.id === id);
      if (bundle) {
        bundle.edgeIds.forEach((eid) => fromBundles.add(eid));
        consumedBundleIds.push({ traceId: trace.id, bundleId: bundle.id });
        found = true;
        break;
      }
    }
    if (!found) rawEdgeIds.push(id);
  }
  const uniqueEdgeIds = new Set([...fromBundles, ...rawEdgeIds]);

  const groups = new Map<string, { fromNodeId: string; toNodeId: string; token: string; edgeIds: string[] }>();
  for (const trace of investigation.traces) {
    for (const edge of trace.edges) {
      if (!uniqueEdgeIds.has(edge.id)) continue;
      const token = normalizeToken(edge.token).symbol;
      const fromAddr = nodeAddr.get(edge.from) || edge.from;
      const toAddr = nodeAddr.get(edge.to) || edge.to;
      const key = `${fromAddr}::${toAddr}::${token}`;
      if (!groups.has(key)) groups.set(key, { fromNodeId: edge.from, toNodeId: edge.to, token, edgeIds: [] });
      groups.get(key)!.edgeIds.push(edge.id);
    }
  }

  const newBundles: { traceId: string; bundle: PlannedBundle }[] = [];
  for (const planned of groups.values()) {
    if (planned.edgeIds.length < 2) continue;
    let traceId = '';
    for (const t of investigation.traces) {
      if (t.edges.some((e) => e.id === planned.edgeIds[0])) { traceId = t.id; break; }
    }
    if (!traceId) continue;
    newBundles.push({ traceId, bundle: planned });
  }
  return { consumedBundleIds, newBundles };
}
```

**Step 2: Run build to catch syntax/type errors**

Run: `npm run build --prefix frontend`
Expected: build succeeds (no callers yet, but the file must compile).

**Step 3: Run `git status`**

---

### Task 6: Tests for `utils/edgeBundling.ts`

**Files:**
- Create: `frontend/src/utils/edgeBundling.test.ts`

**Step 1: Write tests** using the `cytoscapeSync.test.ts` fixture style.

```ts
import { computeDirectionalBundlingPlan, computeSelectionBundlingPlan } from './edgeBundling';
// fixture builders: wallet(), edge(), trace(), inv() — copy from cytoscapeSync.test.ts

describe('computeDirectionalBundlingPlan — outbound', () => {
  it('returns null when wallet is not in any trace', () => { /* ... */ });
  it('returns null when wallet has no outbound edges', () => { /* ... */ });
  it('groups outbound edges to same counterparty + token into one planned bundle', () => { /* ... */ });
  it('does not bundle single-edge groups', () => { /* ... */ });
  it('consumes existing bundles where wallet is the fromNodeId', () => { /* ... */ });
  it('groups by counterparty ADDRESS, not node id (so cross-trace dupes collapse)', () => { /* ... */ });
});

describe('computeDirectionalBundlingPlan — inbound', () => {
  it('groups inbound edges by source address + token', () => { /* ... */ });
  it('consumes existing bundles where wallet is the toNodeId', () => { /* ... */ });
});

describe('computeSelectionBundlingPlan', () => {
  it('expands selected bundle ids into their underlying edge ids', () => { /* ... */ });
  it('dedupes when both a raw edge and a bundle containing it are selected', () => { /* ... */ });
  it('groups by (from, to, token)', () => { /* ... */ });
  it('skips single-edge groups', () => { /* ... */ });
  it('attributes each new bundle to the trace containing the first edge', () => { /* ... */ });
});
```

**Step 2: Run tests**

Run: `npm test --prefix frontend -- edgeBundling`
Expected: all tests pass.

**Step 3: Run `git status`**

---

## Phase 2 — Domain hooks

### Task 7: Extract `useInvestigationUrlSync`

**Files:**
- Create: `frontend/src/hooks/useInvestigationUrlSync.ts`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Step 1: Create the hook**

```ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';

/**
 * Two-way sync between the `?inv=<id>` query param and the in-memory
 * `activeInvestigationId` state. Reading the URL is the source of truth on
 * mount + back/forward; setting via `selectInvestigation` updates both state
 * and the URL via router.push.
 */
export function useInvestigationUrlSync() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const caseId = params.caseId as string;

  const [activeInvestigationId, setActiveInvestigationId] = useState<string | null>(null);

  useEffect(() => {
    const invId = searchParams.get('inv');
    if (invId && invId !== activeInvestigationId) {
      setActiveInvestigationId(invId);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectInvestigation = useCallback((id: string) => {
    setActiveInvestigationId(id);
    router.push(`/cases/${caseId}/investigations?inv=${id}`, { scroll: false });
  }, [router, caseId]);

  const clearInvestigation = useCallback(() => {
    setActiveInvestigationId(null);
  }, []);

  return { caseId, activeInvestigationId, selectInvestigation, clearInvestigation };
}
```

**Step 2: Wire into the page**

In the page, replace the `useRouter/useSearchParams/useParams/useState(activeInvestigationId)/useEffect` block (page lines 244–249, 328–333) with:

```ts
const { caseId, activeInvestigationId, selectInvestigation, clearInvestigation } = useInvestigationUrlSync();
```

Update `handleSelectInvestigation` to use `selectInvestigation(inv.id)` instead of the inline router.push. Update the delete-investigation cleanup (`if (activeInvestigationId === id) setActiveInvestigationId(null);` at line 1399) to use `clearInvestigation()`.

**Step 3: Verify build + smoke test**

Run: `npm run build --prefix frontend`. In the browser: click an investigation in the sidebar → URL updates with `?inv=<id>`. Hit back → goes to previous investigation. Hit forward → re-loads. Delete the active investigation → URL `?inv=` clears.

**Step 4: Run `git status`**

---

### Task 8: Extract `useInvestigationLoader`

**Files:**
- Create: `frontend/src/hooks/useInvestigationLoader.ts`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Step 1: Create the hook**

```ts
'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { apiClient, type ScriptRun } from '@/lib/api-client';
import type { Investigation } from '@/types/investigation';
import { normalizeInvestigation } from '@/utils/normalizeInvestigation';
import { useCaseContext } from '@/contexts/CaseContext';

interface UseInvestigationLoaderArgs {
  activeInvestigationId: string | null;
  investigation: Investigation | null;
  setInvestigation: (inv: Investigation | null) => void;
  /** Called before loading begins — used by the page to clear selectedItem / staged items. */
  onBeforeLoad?: () => void;
}

/**
 * Owns the network lifecycle of an investigation:
 *   - Load on activeInvestigationId change
 *   - Poll script runs every 10s
 *   - Debounced trace auto-save (1s after the last in-memory mutation)
 *   - Subscribe to `onGraphUpdated` from CaseContext so the agent's writes
 *     trigger a reload here
 */
export function useInvestigationLoader({
  activeInvestigationId,
  investigation,
  setInvestigation,
  onBeforeLoad,
}: UseInvestigationLoaderArgs) {
  const [loading, setLoading] = useState(false);
  const [scriptRuns, setScriptRuns] = useState<ScriptRun[]>([]);
  const { setOnGraphUpdated } = useCaseContext();

  // Mirror onBeforeLoad into a ref so we don't have to depend on it inside
  // loadInvestigation. If we did, every parent render that passes a fresh
  // arrow would change loadInvestigation's identity → re-fire the load effect
  // → infinite fetch loop. Same pattern as useCytoscape.ts:46-55.
  const onBeforeLoadRef = useRef(onBeforeLoad);
  onBeforeLoadRef.current = onBeforeLoad;

  const loadInvestigation = useCallback(async (id: string) => {
    setLoading(true);
    onBeforeLoadRef.current?.();
    try {
      const inv = await apiClient.getInvestigation(id);
      setInvestigation(normalizeInvestigation(inv));
    } catch (err) {
      console.error('Failed to load investigation:', err);
    } finally {
      setLoading(false);
    }
  }, [setInvestigation]);

  // Load on id change
  useEffect(() => {
    if (activeInvestigationId) {
      loadInvestigation(activeInvestigationId);
      apiClient.listScriptRuns(activeInvestigationId).then(setScriptRuns).catch(console.error);
    } else {
      setInvestigation(null);
      setScriptRuns([]);
    }
  }, [activeInvestigationId, loadInvestigation, setInvestigation]);

  // Poll script runs every 10s
  useEffect(() => {
    if (!activeInvestigationId) return;
    const interval = setInterval(() => {
      apiClient.listScriptRuns(activeInvestigationId).then(setScriptRuns).catch(console.error);
    }, 10_000);
    return () => clearInterval(interval);
  }, [activeInvestigationId]);

  // Subscribe to graph-updated events from the agent
  useEffect(() => {
    setOnGraphUpdated(() => {
      if (activeInvestigationId) loadInvestigation(activeInvestigationId);
    });
    return () => setOnGraphUpdated(undefined);
  }, [activeInvestigationId, loadInvestigation, setOnGraphUpdated]);

  // Debounced trace auto-save. The useMemo({ current: null }) pattern gives
  // a stable ref-like object without using useRef in the deps array.
  const saveTimeoutRef = useMemo(() => ({ current: null as ReturnType<typeof setTimeout> | null }), []);
  useEffect(() => {
    if (!investigation || loading) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        for (const trace of investigation.traces) {
          const traceData = {
            criteria: trace.criteria,
            nodes: trace.nodes,
            edges: trace.edges,
            groups: trace.groups || [],
            edgeBundles: trace.edgeBundles || [],
            position: trace.position,
            hideTitle: trace.hideTitle ?? false,
            labels: trace.labels || [],
          };
          await apiClient.updateTrace(trace.id, {
            name: trace.name,
            color: trace.color || null,
            visible: trace.visible,
            collapsed: trace.collapsed,
            data: traceData,
          });
        }
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    }, 1000);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [investigation, loading, saveTimeoutRef]);

  const reloadCurrent = useCallback(() => {
    if (activeInvestigationId) loadInvestigation(activeInvestigationId);
  }, [activeInvestigationId, loadInvestigation]);

  const refreshScriptRuns = useCallback(async () => {
    if (!activeInvestigationId) return;
    const runs = await apiClient.listScriptRuns(activeInvestigationId);
    setScriptRuns(runs);
  }, [activeInvestigationId]);

  return { loading, scriptRuns, reloadCurrent, refreshScriptRuns };
}
```

**Step 2: Wire into the page**

In the page, replace the load-investigation effect (lines 313–343), the script-run polling effect (lines 346–352), the auto-save effect (lines 354–385), the `loadInvestigationFromApi` callback, and the `onGraphUpdated` effect (lines 437–442). The page now does:

```ts
const { loading, scriptRuns, reloadCurrent, refreshScriptRuns } = useInvestigationLoader({
  activeInvestigationId,
  investigation,
  setInvestigation,
  onBeforeLoad: () => {
    setSelectedItem(null);
    setStagedItems([]);
  },
});
```

Update `<CanvasToolPill onRefresh={...}>` to call `reloadCurrent`. Update the `onRerunScript` callback (lines 1314–1320) to call `refreshScriptRuns`.

**Step 3: Verify build + smoke test**

Run: `npm run build --prefix frontend`. In the browser: load a case → click an investigation → graph renders. Drag a node → wait 1s → refresh the page → position persists. Open script-runs sidebar → it polls. Click refresh in the canvas tool pill → reloads.

**Step 4: Run `git status`**

---

### Task 8b: Tests for `useInvestigationLoader`

**Files:**
- Create: `frontend/src/hooks/useInvestigationLoader.test.ts`

**Step 1: Set up jest mocks for `@/lib/api-client` and `@/contexts/CaseContext`**

Use `renderHook` from `@testing-library/react`. The test file lives in `src/hooks/`, so `@/` paths work via the jest `moduleNameMapper`. Switch jest `testEnvironment` to `jsdom` for this file via a `/** @jest-environment jsdom */` docblock at the top — the default is `node` per `jest.config.js`.

```ts
/** @jest-environment jsdom */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInvestigationLoader } from './useInvestigationLoader';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getInvestigation: jest.fn(),
    listScriptRuns: jest.fn().mockResolvedValue([]),
    updateTrace: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/contexts/CaseContext', () => ({
  useCaseContext: () => ({ setOnGraphUpdated: jest.fn() }),
}));

jest.mock('@/utils/normalizeInvestigation', () => ({
  normalizeInvestigation: (x: any) => x,
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});
```

**Step 2: Write the debounce auto-save test (the regression magnet)**

```ts
it('debounces auto-save: N investigation mutations within 1s = exactly one updateTrace per trace', async () => {
  const trace1 = { id: 't1', name: 'A', color: '#fff', visible: true, collapsed: false, criteria: {type:'custom'}, nodes:[], edges:[], groups:[], edgeBundles:[], position:{x:0,y:0} };
  const investigation = { id: 'i1', name: 'I', traces: [trace1] };
  let inv = investigation;
  const setInvestigation = (next: any) => { inv = next; };

  const { rerender } = renderHook(({ i }) =>
    useInvestigationLoader({
      activeInvestigationId: 'i1',
      investigation: i,
      setInvestigation,
    }),
    { initialProps: { i: investigation } }
  );

  // Three rapid mutations
  rerender({ i: { ...inv, traces: [{ ...trace1, name: 'B' }] } });
  rerender({ i: { ...inv, traces: [{ ...trace1, name: 'C' }] } });
  rerender({ i: { ...inv, traces: [{ ...trace1, name: 'D' }] } });

  // Before debounce fires
  expect(apiClient.updateTrace).not.toHaveBeenCalled();

  // Advance past debounce
  await act(async () => { jest.advanceTimersByTime(1100); });
  await waitFor(() => expect(apiClient.updateTrace).toHaveBeenCalledTimes(1));
});

it('reloads when activeInvestigationId changes', async () => {
  (apiClient.getInvestigation as jest.Mock).mockResolvedValue({ id: 'i1', name: 'A', traces: [] });
  const setInvestigation = jest.fn();
  const { rerender } = renderHook(({ id }) =>
    useInvestigationLoader({ activeInvestigationId: id, investigation: null, setInvestigation }),
    { initialProps: { id: null as string | null } }
  );
  rerender({ id: 'i1' });
  await waitFor(() => expect(apiClient.getInvestigation).toHaveBeenCalledWith('i1'));
});

it('does NOT re-fire load when onBeforeLoad identity changes (ref pattern)', async () => {
  (apiClient.getInvestigation as jest.Mock).mockResolvedValue({ id: 'i1', traces: [] });
  const setInvestigation = jest.fn();
  const { rerender } = renderHook(({ cb }) =>
    useInvestigationLoader({
      activeInvestigationId: 'i1',
      investigation: null,
      setInvestigation,
      onBeforeLoad: cb,
    }),
    { initialProps: { cb: () => {} } }
  );
  // Force five re-renders with fresh callback identities
  for (let i = 0; i < 5; i++) rerender({ cb: () => {} });
  await waitFor(() => expect(apiClient.getInvestigation).toHaveBeenCalledTimes(1));
});
```

**Step 3: Run tests**

Run: `npm test --prefix frontend -- useInvestigationLoader`
Expected: all tests pass. The third test fails if the ref-pattern fix from Task 8 was skipped.

**Step 4: Run `git status`**

---

### Task 9: Extract `useSelectedItem`

**Files:**
- Create: `frontend/src/hooks/useSelectedItem.ts`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Step 1: Create the hook**

```ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Investigation, WalletNode, TransactionEdge } from '@/types/investigation';

/**
 * Selected item state for the right-side details panel. Re-derives the cached
 * `selectedItem` whenever `investigation` mutates, so that the panel doesn't
 * hold a stale snapshot after an edit.
 *
 * NOTE: the re-derive effect intentionally depends ONLY on `investigation`.
 * Including `selectedItem` would create a setState loop because we setState
 * inside the effect.
 */
export function useSelectedItem(investigation: Investigation | null) {
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  useEffect(() => {
    if (!selectedItem || !investigation) return;
    const { type, data } = selectedItem;
    if (type === 'wallet' && data) {
      for (const trace of investigation.traces) {
        const found = trace.nodes.find((n: WalletNode) => n.id === data.id);
        if (found) { setSelectedItem({ type: 'wallet', data: found }); return; }
      }
      setSelectedItem(null);
    } else if (type === 'transaction' && data) {
      for (const trace of investigation.traces) {
        const found = trace.edges.find((e: TransactionEdge) => e.id === data.id);
        if (found) { setSelectedItem({ type: 'transaction', data: found }); return; }
      }
      setSelectedItem(null);
    } else if (type === 'trace' && data) {
      const found = investigation.traces.find((t) => t.id === data.id);
      if (found) setSelectedItem({ type: 'trace', data: found });
      else setSelectedItem(null);
    } else if (type === 'group' && data) {
      for (const trace of investigation.traces) {
        const found = (trace.groups || []).find((g) => g.id === data.id);
        if (found) { setSelectedItem({ type: 'group', data: found }); return; }
      }
      setSelectedItem(null);
    } else if (type === 'edgeBundle' && data) {
      for (const trace of investigation.traces) {
        const found = (trace.edgeBundles || []).find((b) => b.id === data.id);
        if (found) { setSelectedItem({ type: 'edgeBundle', data: found }); return; }
      }
      setSelectedItem(null);
    } else if (type === 'aggregatedEdge' && data) {
      const trace = investigation.traces.find((t) => t.id === data.traceId);
      if (!trace) { setSelectedItem(null); return; }
      const remaining = data.edges.filter((e: TransactionEdge) =>
        trace.edges.some((te) => te.id === e.id)
      );
      if (remaining.length === 0) { setSelectedItem(null); return; }
      setSelectedItem({ type: 'aggregatedEdge', data: { ...data, edges: remaining } });
    }
  }, [investigation]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearSelection = useCallback(() => setSelectedItem(null), []);

  return { selectedItem, setSelectedItem, clearSelection };
}
```

**Step 2: Wire into the page**

Replace `const [selectedItem, setSelectedItem] = useState<any | null>(null);` (line 290) and the re-derive `useEffect` (lines 395–435) with:

```ts
const { selectedItem, setSelectedItem, clearSelection } = useSelectedItem(investigation);
```

Search for any `setSelectedItem(null)` calls that should now use `clearSelection()` — they're equivalent, no need to change them for this refactor (leave as `setSelectedItem(null)`).

**Step 3: Verify build + smoke test**

Run: `npm run build --prefix frontend`. In the browser: select a wallet → edit its label → details panel shows new label (does not go stale). Delete a selected wallet → panel closes. Group two selected wallets → group panel appears. Bundle two edges → details show the bundle.

**Step 4: Run `git status`**

---

### Task 9b: Tests for `useSelectedItem`

**Files:**
- Create: `frontend/src/hooks/useSelectedItem.test.ts`

**Step 1: Write the clear-on-delete coverage**

```ts
/** @jest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { useSelectedItem } from './useSelectedItem';
import type { Investigation } from '@/types/investigation';
// fixture builders wallet/edge/trace/inv from cytoscapeSync.test.ts

describe('useSelectedItem', () => {
  it('clears selection when the selected wallet is deleted', () => {
    const w = wallet('w1');
    const initialInv = inv([trace('t1', { nodes: [w] })]);
    const { result, rerender } = renderHook(({ i }) => useSelectedItem(i), {
      initialProps: { i: initialInv as Investigation | null },
    });
    act(() => result.current.setSelectedItem({ type: 'wallet', data: w }));
    rerender({ i: inv([trace('t1', { nodes: [] })]) });
    expect(result.current.selectedItem).toBeNull();
  });

  it('re-derives the wallet snapshot when its label changes', () => {
    const w = wallet('w1', { label: 'before' });
    const { result, rerender } = renderHook(({ i }) => useSelectedItem(i), {
      initialProps: { i: inv([trace('t1', { nodes: [w] })]) as Investigation | null },
    });
    act(() => result.current.setSelectedItem({ type: 'wallet', data: w }));
    rerender({ i: inv([trace('t1', { nodes: [{ ...w, label: 'after' }] })]) });
    expect(result.current.selectedItem?.data.label).toBe('after');
  });

  it('clears aggregatedEdge selection when all underlying edges are gone', () => { /* ... */ });
  it('filters aggregatedEdge edges to surviving subset when some are deleted', () => { /* ... */ });
  it('clears selection when the selected trace is deleted', () => { /* ... */ });
  it('clears selection when the selected group is deleted', () => { /* ... */ });
  it('clears selection when the selected edge bundle is deleted', () => { /* ... */ });

  it('clearSelection sets selectedItem to null', () => {
    const { result } = renderHook(() => useSelectedItem(null));
    act(() => result.current.setSelectedItem({ type: 'wallet', data: wallet('w1') }));
    act(() => result.current.clearSelection());
    expect(result.current.selectedItem).toBeNull();
  });
});
```

**Step 2: Run tests**

Run: `npm test --prefix frontend -- useSelectedItem`
Expected: all tests pass.

**Step 3: Run `git status`**

---

### Task 10: Extract `useEdgeBundling`

**Files:**
- Create: `frontend/src/hooks/useEdgeBundling.ts`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Step 1: Create the hook**

```ts
'use client';

import { useCallback } from 'react';
import type { Investigation, EdgeBundle } from '@/types/investigation';
import {
  computeDirectionalBundlingPlan,
  computeSelectionBundlingPlan,
  type BundleDirection,
} from '@/utils/edgeBundling';

interface UseEdgeBundlingArgs {
  investigation: Investigation | null;
  selectedEdgeIds: string[];
  setSelectedEdgeIds: (ids: string[]) => void;
  addEdgeBundle: (traceId: string, bundle: EdgeBundle) => void;
  deleteEdgeBundle: (traceId: string, bundleId: string) => void;
  updateTransaction: (traceId: string, txId: string, patch: { color?: string }) => void;
  deleteOutboundEdges: (walletId: string) => void;
  deleteInboundEdges: (walletId: string) => void;
}

export function useEdgeBundling({
  investigation,
  selectedEdgeIds,
  setSelectedEdgeIds,
  addEdgeBundle,
  deleteEdgeBundle,
  updateTransaction,
  deleteOutboundEdges,
  deleteInboundEdges,
}: UseEdgeBundlingArgs) {
  const handleBundleEdges = useCallback(() => {
    if (!investigation || selectedEdgeIds.length < 2) return;
    const plan = computeSelectionBundlingPlan(investigation, selectedEdgeIds);
    for (const { traceId, bundleId } of plan.consumedBundleIds) {
      deleteEdgeBundle(traceId, bundleId);
    }
    for (const { traceId, bundle } of plan.newBundles) {
      addEdgeBundle(traceId, {
        id: crypto.randomUUID(),
        traceId,
        fromNodeId: bundle.fromNodeId,
        toNodeId: bundle.toNodeId,
        token: bundle.token,
        collapsed: true,
        edgeIds: bundle.edgeIds,
      });
    }
    setSelectedEdgeIds([]);
  }, [investigation, selectedEdgeIds, addEdgeBundle, deleteEdgeBundle, setSelectedEdgeIds]);

  const bundleByDirection = useCallback((walletId: string, color: string, direction: BundleDirection) => {
    if (!investigation) return;
    const plan = computeDirectionalBundlingPlan(investigation, walletId, direction);
    if (!plan) return;

    // Color all affected edges so the bundle's color is consistent if later un-bundled.
    for (const trace of investigation.traces) {
      for (const edge of trace.edges) {
        if (plan.affectedEdgeIds.has(edge.id)) {
          updateTransaction(trace.id, edge.id, { color });
        }
      }
    }

    for (const { traceId, bundleId } of plan.consumedBundleIds) {
      deleteEdgeBundle(traceId, bundleId);
    }

    for (const bundle of plan.newBundles) {
      addEdgeBundle(plan.walletTraceId, {
        id: crypto.randomUUID(),
        traceId: plan.walletTraceId,
        fromNodeId: bundle.fromNodeId,
        toNodeId: bundle.toNodeId,
        token: bundle.token,
        collapsed: true,
        edgeIds: bundle.edgeIds,
        color,
      });
    }
  }, [investigation, addEdgeBundle, deleteEdgeBundle, updateTransaction]);

  const handleBundleAllOutbound = useCallback(
    (walletId: string, color: string) => bundleByDirection(walletId, color, 'outbound'),
    [bundleByDirection]
  );
  const handleBundleAllInbound = useCallback(
    (walletId: string, color: string) => bundleByDirection(walletId, color, 'inbound'),
    [bundleByDirection]
  );
  const handleDeleteAllOutbound = useCallback(
    (walletId: string) => deleteOutboundEdges(walletId),
    [deleteOutboundEdges]
  );
  const handleDeleteAllInbound = useCallback(
    (walletId: string) => deleteInboundEdges(walletId),
    [deleteInboundEdges]
  );

  return {
    handleBundleEdges,
    handleBundleAllOutbound,
    handleBundleAllInbound,
    handleDeleteAllOutbound,
    handleDeleteAllInbound,
  };
}
```

**Step 2: Wire into the page**

Delete the inline `handleBundleEdges` (lines 744–807), `handleBundleAllOutbound` (lines 809–877), `handleBundleAllInbound` (lines 883–951), `handleDeleteAllOutbound` (lines 879–881), `handleDeleteAllInbound` (lines 953–955). Replace with:

```ts
const {
  handleBundleEdges,
  handleBundleAllOutbound,
  handleBundleAllInbound,
  handleDeleteAllOutbound,
  handleDeleteAllInbound,
} = useEdgeBundling({
  investigation,
  selectedEdgeIds,
  setSelectedEdgeIds,
  addEdgeBundle,
  deleteEdgeBundle,
  updateTransaction,
  deleteOutboundEdges,
  deleteInboundEdges,
});
```

**Step 3: Verify build + smoke test**

Run: `npm run build --prefix frontend` and `npm test --prefix frontend -- edgeBundling`. In the browser: select 3+ edges in a multi-select box → click Bundle in `EdgeBatchPanel` → bundle forms. Right-click a wallet → Bundle All Outbound → all outbound bundle. Same for inbound. Right-click → Delete All Outbound / Inbound → edges removed.

**Step 4: Run `git status`**

---

### Task 11: Extract `useBatchNodeOps`

**Files:**
- Create: `frontend/src/hooks/useBatchNodeOps.ts`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Step 1: Create the hook**

```ts
'use client';

import { useCallback, useMemo } from 'react';
import type { Investigation, WalletNode, Group, Trace } from '@/types/investigation';
import { apiClient } from '@/lib/api-client';

const TRACE_COLORS = ['#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#eab308', '#ef4444'];

interface UseBatchNodeOpsArgs {
  investigation: Investigation | null;
  activeInvestigationId: string | null;
  selectedNodeIds: { id: string; traceId: string }[];
  setSelectedNodeIds: (ids: { id: string; traceId: string }[]) => void;
  updateWallet: (traceId: string, walletId: string, patch: Partial<WalletNode>) => void;
  deleteWallet: (traceId: string, walletId: string) => void;
  createGroup: (traceId: string, group: Group, nodeIds: string[]) => void;
  setNodeGroup: (traceId: string, nodeIds: string[], groupId: string | null) => void;
  extractToTrace: (nodeIds: string[], newTrace: Trace) => void;
}

export function useBatchNodeOps({
  investigation,
  activeInvestigationId,
  selectedNodeIds,
  setSelectedNodeIds,
  updateWallet,
  deleteWallet,
  createGroup,
  setNodeGroup,
  extractToTrace,
}: UseBatchNodeOpsArgs) {
  const handleBatchRename = useCallback((prefix: string) => {
    selectedNodeIds.forEach(({ id, traceId }, i) => {
      updateWallet(traceId, id, { label: `${prefix} ${i + 1}` });
    });
    setSelectedNodeIds([]);
  }, [selectedNodeIds, updateWallet, setSelectedNodeIds]);

  const handleBatchRecolor = useCallback((color: string) => {
    selectedNodeIds.forEach(({ id, traceId }) => {
      updateWallet(traceId, id, { color });
    });
    setSelectedNodeIds([]);
  }, [selectedNodeIds, updateWallet, setSelectedNodeIds]);

  const handleBatchDelete = useCallback(() => {
    selectedNodeIds.forEach(({ id, traceId }) => {
      deleteWallet(traceId, id);
    });
    setSelectedNodeIds([]);
  }, [selectedNodeIds, deleteWallet, setSelectedNodeIds]);

  const handleGroupNodes = useCallback((name: string) => {
    if (selectedNodeIds.length < 2) return;
    const traceId = selectedNodeIds[0].traceId;
    const group: Group = { id: crypto.randomUUID(), name, traceId };
    createGroup(traceId, group, selectedNodeIds.map((n) => n.id));
    setSelectedNodeIds([]);
  }, [selectedNodeIds, createGroup, setSelectedNodeIds]);

  const selectedGroupEntry = useMemo(() => {
    if (!investigation || selectedNodeIds.length < 2) return null;
    for (const { id, traceId } of selectedNodeIds) {
      const trace = investigation.traces.find((t) => t.id === traceId);
      const group = (trace?.groups || []).find((g) => g.id === id);
      if (group) return { group, traceId };
    }
    return null;
  }, [selectedNodeIds, investigation]);

  const handleAddToGroup = useCallback(() => {
    if (!selectedGroupEntry) return;
    const { group, traceId } = selectedGroupEntry;
    const nodeIds = selectedNodeIds
      .filter(({ id }) => id !== group.id)
      .map(({ id }) => id);
    setNodeGroup(traceId, nodeIds, group.id);
    setSelectedNodeIds([]);
  }, [selectedGroupEntry, selectedNodeIds, setNodeGroup, setSelectedNodeIds]);

  const handleExtractToTrace = useCallback(async () => {
    if (!activeInvestigationId || selectedNodeIds.length < 2) return;
    const color = TRACE_COLORS[(investigation?.traces.length || 0) % TRACE_COLORS.length];
    const name = `Trace ${(investigation?.traces.length || 0) + 1}`;
    try {
      const created = await apiClient.createTrace(activeInvestigationId, { name, color });
      const newTrace: Trace = {
        id: created.id,
        name: created.name,
        criteria: { type: 'wallet-group' },
        visible: true,
        collapsed: false,
        color,
        nodes: [],
        edges: [],
        position: { x: 0, y: 0 },
      };
      extractToTrace(selectedNodeIds.map((n) => n.id), newTrace);
      setSelectedNodeIds([]);
    } catch (err) {
      console.error('Failed to extract to trace:', err);
    }
  }, [activeInvestigationId, selectedNodeIds, investigation?.traces.length, extractToTrace, setSelectedNodeIds]);

  return {
    handleBatchRename,
    handleBatchRecolor,
    handleBatchDelete,
    handleGroupNodes,
    selectedGroupEntry,
    handleAddToGroup,
    handleExtractToTrace,
  };
}
```

**Step 2: Wire into the page**

Delete `handleBatchRename` (lines 701–706), `handleBatchRecolor` (708–713), `handleBatchDelete` (715–720), `handleGroupNodes` (722–732), the `selectedGroupEntry` memo (734–742), `handleAddToGroup` (957–965), `handleExtractToTrace` (967–990). Replace with one call to `useBatchNodeOps({...})` that returns all of them.

**Step 3: Verify build + smoke test**

Run: `npm run build --prefix frontend`. In the browser: multi-select 2+ wallets → BatchEditPanel appears → rename, recolor, delete all work. Multi-select 2 wallets in the same trace → Group → group forms. Multi-select wallets + an existing group → Add to group. Multi-select 2 wallets across traces → Extract to trace.

**Step 4: Run `git status`**

---

### Task 11b: Extract `useWalletTransactionAuthoring`

**Files:**
- Create: `frontend/src/hooks/useWalletTransactionAuthoring.ts`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

This hook owns the four creation paths that share address-normalization / wallet-resolution logic: `handleSaveNewWallet`, `findOrCreateWallet`, `handleSaveNewTransaction`, `handleAddStagedToTrace`. About 165 lines moved out of the page.

**Step 1: Create the hook**

```ts
'use client';

import { useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { buildExplorerUrl } from '@/utils/addressParser';
import type { Investigation, WalletNode, TransactionEdge } from '@/types/investigation';
import type { PanelMode } from '@/types/panel';

interface UseWalletTransactionAuthoringArgs {
  investigation: Investigation | null;
  allWallets: { wallet: WalletNode; traceId: string }[];
  panelMode: PanelMode;
  setPanelMode: (mode: PanelMode) => void;
  setSelectedItem: (item: any) => void;
  setStagedItems: (updater: (prev: TransactionEdge[]) => TransactionEdge[]) => void;
  addWallet: (traceId: string, wallet: WalletNode) => void;
  updateWallet: (traceId: string, walletId: string, patch: Partial<WalletNode>) => void;
  addTransaction: (traceId: string, tx: TransactionEdge) => void;
}

export function useWalletTransactionAuthoring(args: UseWalletTransactionAuthoringArgs) {
  const {
    investigation, allWallets, panelMode, setPanelMode, setSelectedItem,
    setStagedItems, addWallet, updateWallet, addTransaction,
  } = args;

  const handleSaveNewWallet = useCallback((traceId: string, data: Partial<WalletNode>) => {
    const position = panelMode.type === 'createWallet' && panelMode.position
      ? panelMode.position
      : { x: Math.random() * 400, y: Math.random() * 400 };
    const addr = (data.address || '').toLowerCase();
    const ch = data.chain || 'ethereum';
    const wallet: WalletNode = {
      id: crypto.randomUUID(),
      label: data.label || 'New Node',
      address: addr,
      chain: ch,
      color: data.color || '#60a5fa',
      size: data.size,
      notes: data.notes || '',
      tags: data.tags || [],
      position,
      parentTrace: traceId,
      addressType: addr ? 'unknown' : undefined,
      explorerUrl: addr ? buildExplorerUrl(ch, addr) : undefined,
    };
    addWallet(traceId, wallet);
    setPanelMode({ type: 'none' });
    setSelectedItem({ type: 'wallet', data: wallet });

    if (addr) {
      apiClient.getAddressInfo(addr, ch).then((info) => {
        updateWallet(traceId, wallet.id, { addressType: info.addressType });
      }).catch(() => {});
    }
  }, [panelMode, addWallet, updateWallet, setPanelMode, setSelectedItem]);

  const findOrCreateWallet = useCallback((address: string, chain: string, traceId: string): string => {
    const existing = allWallets.find(
      (w) => w.wallet.address.toLowerCase() === address.toLowerCase()
    );
    if (existing) return existing.wallet.id;

    const normAddress = address.toLowerCase();
    const walletId = crypto.randomUUID();
    const wallet: WalletNode = {
      id: walletId,
      label: normAddress.length > 10 ? `${normAddress.slice(0, 6)}...${normAddress.slice(-4)}` : normAddress,
      address: normAddress,
      chain,
      notes: '',
      tags: [],
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      parentTrace: traceId,
      addressType: 'unknown',
      explorerUrl: buildExplorerUrl(chain, normAddress),
    };
    addWallet(traceId, wallet);

    apiClient.getAddressInfo(normAddress, chain).then((info) => {
      updateWallet(traceId, walletId, { addressType: info.addressType });
    }).catch(() => {});

    return wallet.id;
  }, [allWallets, addWallet, updateWallet]);

  const handleSaveNewTransaction = useCallback((traceId: string, data: Partial<TransactionEdge>) => {
    const ch = data.chain || 'ethereum';
    let fromId = data.from || '';
    let toId = data.to || '';
    const isExistingWallet = (val: string) =>
      allWallets.some((w) => w.wallet.id === val || w.wallet.address.toLowerCase() === val.toLowerCase());
    if (fromId && !isExistingWallet(fromId)) fromId = findOrCreateWallet(fromId, ch, traceId);
    if (toId && !isExistingWallet(toId)) toId = findOrCreateWallet(toId, ch, traceId);

    const fromTrace = allWallets.find((w) => w.wallet.id === fromId)?.traceId;
    const toTrace = allWallets.find((w) => w.wallet.id === toId)?.traceId;
    const crossTrace = !!(fromTrace && toTrace && fromTrace !== toTrace);

    const transaction: TransactionEdge = {
      id: crypto.randomUUID(),
      from: fromId,
      to: toId,
      txHash: data.txHash || '0x',
      chain: ch,
      timestamp: data.timestamp || new Date().toISOString(),
      amount: data.amount || '0',
      token: data.token || { address: '0x', symbol: 'ETH', decimals: 18 },
      usdValue: data.usdValue,
      color: data.color || '#10b981',
      label: data.label || '',
      notes: data.notes || '',
      tags: data.tags || [],
      blockNumber: data.blockNumber || 0,
      crossTrace,
    };
    addTransaction(traceId, transaction);
    setPanelMode({ type: 'none' });
    setSelectedItem({ type: 'transaction', data: transaction });
  }, [addTransaction, allWallets, findOrCreateWallet, setPanelMode, setSelectedItem]);

  const handleAddStagedToTrace = useCallback((traceId: string, selected: TransactionEdge[]) => {
    if (!investigation) return;

    const existingTxHashes = new Set<string>();
    investigation.traces.forEach((t) =>
      t.edges.forEach((e) => existingTxHashes.add(`${e.txHash}-${e.from}-${e.to}`))
    );

    const existingWalletAddresses = new Map<string, string>();
    investigation.traces.forEach((t) =>
      t.nodes.forEach((n) => existingWalletAddresses.set(n.address.toLowerCase(), n.id))
    );

    let maxX = 0;
    investigation.traces.forEach((t) =>
      t.nodes.forEach((n) => { if (n.position.x > maxX) maxX = n.position.x; })
    );
    let newNodeX = maxX + 150;
    let newNodeY = 100;
    let placedCount = 0;

    for (const tx of selected) {
      const key = `${tx.txHash}-${tx.from}-${tx.to}`;
      if (existingTxHashes.has(key)) continue;

      for (const addr of [tx.from, tx.to]) {
        if (!existingWalletAddresses.has(addr.toLowerCase())) {
          const x = newNodeX + Math.floor(placedCount / 5) * 150;
          const y = newNodeY + (placedCount % 5) * 100;
          placedCount++;
          const normAddr = addr.toLowerCase();
          const wallet: WalletNode = {
            id: crypto.randomUUID(),
            label: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
            address: normAddr,
            chain: tx.chain,
            notes: '',
            tags: [],
            position: { x, y },
            parentTrace: traceId,
          };
          addWallet(traceId, wallet);
          existingWalletAddresses.set(normAddr, wallet.id);
        }
      }

      const fromId = existingWalletAddresses.get(tx.from.toLowerCase()) || tx.from;
      const toId = existingWalletAddresses.get(tx.to.toLowerCase()) || tx.to;
      addTransaction(traceId, { ...tx, id: crypto.randomUUID(), from: fromId, to: toId });
      existingTxHashes.add(key);
    }

    const selectedIds = new Set(selected.map((s) => s.id));
    setStagedItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
  }, [investigation, addWallet, addTransaction, setStagedItems]);

  return { handleSaveNewWallet, findOrCreateWallet, handleSaveNewTransaction, handleAddStagedToTrace };
}
```

**Step 2: Wire into the page**

Delete page lines 522–559 (`handleCreateWalletAtPosition` and `handleSaveNewWallet`), 561–591 (`findOrCreateWallet`), 593–634 (`handleSaveNewTransaction`), 640–699 (`handleAddStagedToTrace`). Note: `handleCreateWalletAtPosition` is NOT part of this hook — it's a one-liner (`setPanelMode(...)`) and moves to `useGraphContextMenu` in Task 11c. Keep it inline for now if Task 11c hasn't landed.

Replace with:

```ts
const {
  handleSaveNewWallet,
  findOrCreateWallet, // eslint-disable-line @typescript-eslint/no-unused-vars
  handleSaveNewTransaction,
  handleAddStagedToTrace,
} = useWalletTransactionAuthoring({
  investigation, allWallets, panelMode, setPanelMode, setSelectedItem,
  setStagedItems, addWallet, updateWallet, addTransaction,
});
```

`findOrCreateWallet` may not be used externally — if TS / lint flags it, drop it from the destructure. The hook still uses it internally.

**Step 3: Verify build + smoke test**

Run: `npm run build --prefix frontend`. In the browser:
- Double-click empty canvas → create wallet → wallet appears + selected
- QuickAdd a transaction with two new addresses → both wallets auto-created, tx connects them
- Fetch history → select transactions in StagingPanel → Add to trace → wallets + edges placed in a 5-row grid to the right of existing nodes
- Re-add a tx that already exists in any trace → silently skipped (dedup key matches)

**Step 4: Run `git status`**

---

### Task 11c: Extract `useGraphContextMenu`

**Files:**
- Create: `frontend/src/hooks/useGraphContextMenu.ts`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

This hook owns: `handleAddTrace`, `handleCreateWalletAtPosition`, `handleContextMenu`, `handleLabelContextMenu`, the `lastFocusedTraceId` state, and the `cytoscapeCallbacks` `useMemo`. About 150 lines moved out of the page.

**Step 1: Create the hook**

```ts
'use client';

import { useCallback, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { buildGraphContextMenu, buildLabelContextMenu } from '@/components/Graph/graphContextMenu';
import type { ContextMenuItem } from '@/components/Graph/ContextMenu';
import type { CytoscapeCallbacks } from '@/hooks/useCytoscape';
import type { GraphCanvasHandle } from '@/components/Graph/GraphCanvas';
import type { Investigation, WalletNode, Trace, TraceLabel } from '@/types/investigation';
import type { PanelMode } from '@/types/panel';

const TRACE_COLORS = ['#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#eab308', '#ef4444'];

interface UseGraphContextMenuArgs {
  investigation: Investigation | null;
  activeInvestigationId: string | null;
  graphRef: React.RefObject<GraphCanvasHandle>;

  addTrace: (trace: Trace) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  updateWallet: (traceId: string, walletId: string, patch: Partial<WalletNode>) => void;
  updateGroup: (traceId: string, groupId: string, patch: { size: number }) => void;
  deleteWallet: (traceId: string, walletId: string) => void;
  deleteTransaction: (traceId: string, txId: string) => void;
  toggleTraceVisibility: (traceId: string) => void;
  toggleTraceCollapsed: (traceId: string) => void;
  addLabel: (traceId: string, label: TraceLabel) => void;
  deleteLabel: (traceId: string, labelId: string) => void;

  setSelectedItem: (item: any) => void;
  setSelectedNodeIds: (ids: { id: string; traceId: string }[]) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  setPanelMode: (mode: PanelMode) => void;
  setContextMenu: (menu: { x: number; y: number; items: ContextMenuItem[] } | null) => void;
  onFetchHistory: (address: string, chain: string) => void;
  resolveFocusItem: (focusItem: any, investigation: Investigation | null) => any;
}

export function useGraphContextMenu(args: UseGraphContextMenuArgs) {
  const {
    investigation, activeInvestigationId, graphRef,
    addTrace, updateNodePosition, updateWallet, updateGroup,
    deleteWallet, deleteTransaction, toggleTraceVisibility, toggleTraceCollapsed,
    addLabel, deleteLabel,
    setSelectedItem, setSelectedNodeIds, setSelectedEdgeIds, setPanelMode, setContextMenu,
    onFetchHistory, resolveFocusItem,
  } = args;

  const [lastFocusedTraceId, setLastFocusedTraceId] = useState<string | null>(null);

  const handleAddTrace = useCallback(async (): Promise<string | undefined> => {
    if (!activeInvestigationId) return undefined;
    const color = TRACE_COLORS[(investigation?.traces.length || 0) % TRACE_COLORS.length];
    const name = `Trace ${(investigation?.traces.length || 0) + 1}`;
    try {
      const created = await apiClient.createTrace(activeInvestigationId, { name, color });
      const trace: Trace = {
        id: created.id, name: created.name, criteria: { type: 'custom' },
        visible: true, collapsed: false, color, nodes: [], edges: [], position: { x: 0, y: 0 },
      };
      addTrace(trace);
      setSelectedItem({ type: 'trace', data: trace });
      return trace.id;
    } catch (err) {
      console.error('Failed to create trace:', err);
      return undefined;
    }
  }, [addTrace, investigation?.traces.length, activeInvestigationId, setSelectedItem]);

  const handleCreateWalletAtPosition = useCallback((position: { x: number; y: number }) => {
    setPanelMode({ type: 'createWallet', position });
  }, [setPanelMode]);

  const handleContextMenu = useCallback(
    (event: { type: 'node' | 'edge' | 'background'; id?: string; x: number; y: number; modelPosition?: { x: number; y: number } }) => {
      if (!investigation) return;
      const items = buildGraphContextMenu(event, {
        investigation, lastFocusedTraceId, setLastFocusedTraceId, setSelectedItem,
        toggleTraceVisibility, toggleTraceCollapsed, deleteWallet, deleteTransaction,
        addLabel, deleteLabel, handleCreateWalletAtPosition, handleAddTrace,
        handleFetchHistory: onFetchHistory, graphRef,
      });
      if (items.length > 0) setContextMenu({ x: event.x, y: event.y, items });
    },
    [investigation, lastFocusedTraceId, toggleTraceVisibility, toggleTraceCollapsed,
     deleteWallet, deleteTransaction, onFetchHistory, handleCreateWalletAtPosition,
     handleAddTrace, addLabel, deleteLabel, setSelectedItem, setContextMenu, graphRef]
  );

  const handleLabelContextMenu = useCallback(
    (traceId: string, labelId: string, x: number, y: number) => {
      const items = buildLabelContextMenu(traceId, labelId, {
        investigation: investigation!, lastFocusedTraceId, setLastFocusedTraceId,
        setSelectedItem, toggleTraceVisibility, toggleTraceCollapsed, deleteWallet,
        deleteTransaction, addLabel, deleteLabel, handleCreateWalletAtPosition,
        handleAddTrace, handleFetchHistory: onFetchHistory, graphRef,
      });
      setContextMenu({ x, y, items });
    },
    [deleteLabel, graphRef, investigation, lastFocusedTraceId, setSelectedItem,
     toggleTraceVisibility, toggleTraceCollapsed, deleteWallet, deleteTransaction,
     addLabel, handleCreateWalletAtPosition, handleAddTrace, onFetchHistory, setContextMenu]
  );

  const cytoscapeCallbacks: CytoscapeCallbacks = useMemo(() => ({
    onSelectionChange: ({ nodeIds, edgeIds, focusItem }) => {
      setSelectedNodeIds(nodeIds);
      setSelectedEdgeIds(edgeIds);
      setSelectedItem(resolveFocusItem(focusItem, investigation));
      if (focusItem && focusItem.type !== 'trace' && 'traceId' in focusItem) {
        setLastFocusedTraceId(focusItem.traceId);
      } else if (focusItem?.type === 'trace') {
        setLastFocusedTraceId(focusItem.id);
      }
    },
    onNodeDrag: updateNodePosition,
    onGroupDrag: (groupId, newPos) => {
      if (!investigation) return;
      for (const trace of investigation.traces) {
        const group = (trace.groups || []).find((g) => g.id === groupId);
        if (!group) continue;
        const members = trace.nodes.filter((n) => n.groupId === groupId);
        if (members.length === 0) break;
        const oldCx = members.reduce((s, n) => s + n.position.x, 0) / members.length;
        const oldCy = members.reduce((s, n) => s + n.position.y, 0) / members.length;
        const dx = newPos.x - oldCx;
        const dy = newPos.y - oldCy;
        members.forEach((n) => updateNodePosition(n.id, { x: n.position.x + dx, y: n.position.y + dy }));
        break;
      }
    },
    onResizeNode: (nodeId, traceId, size) => {
      const isGroup = investigation?.traces.some((t) => (t.groups || []).some((g) => g.id === nodeId));
      if (isGroup) updateGroup(traceId, nodeId, { size });
      else updateWallet(traceId, nodeId, { size });
    },
    onContextMenu: handleContextMenu,
    onDoubleClickBackground: handleCreateWalletAtPosition,
  }), [
    updateNodePosition, updateWallet, updateGroup, investigation,
    handleContextMenu, handleCreateWalletAtPosition,
    setSelectedNodeIds, setSelectedEdgeIds, setSelectedItem, resolveFocusItem,
  ]);

  return {
    lastFocusedTraceId,
    handleAddTrace,
    handleCreateWalletAtPosition,
    handleContextMenu,
    handleLabelContextMenu,
    cytoscapeCallbacks,
  };
}
```

**Step 2: Wire into the page**

Delete page lines 287–288 (`lastFocusedTraceId` state), 451–477 (`handleAddTrace`), 522–524 (`handleCreateWalletAtPosition`), 992–1057 (`handleContextMenu`, `handleLabelContextMenu`), 1059–1099 (`cytoscapeCallbacks`). Import `resolveFocusItem` from `@/utils/focusItem` and pass into the hook. Replace with:

```ts
const {
  handleAddTrace,
  handleCreateWalletAtPosition,
  handleLabelContextMenu,
  cytoscapeCallbacks,
} = useGraphContextMenu({
  investigation, activeInvestigationId, graphRef,
  addTrace, updateNodePosition, updateWallet, updateGroup,
  deleteWallet, deleteTransaction, toggleTraceVisibility, toggleTraceCollapsed,
  addLabel, deleteLabel,
  setSelectedItem, setSelectedNodeIds, setSelectedEdgeIds, setPanelMode, setContextMenu,
  onFetchHistory: handleFetchHistory,
  resolveFocusItem,
});
```

**Step 3: Verify build + smoke test**

Run: `npm run build --prefix frontend`. In the browser, exercise the full context-menu surface:
- Right-click empty canvas → "Add wallet here", "Add trace" (verify wallet appears at click position, trace gets a color from the rotation)
- Right-click a wallet → fetch history, delete, bundle outbound/inbound, etc.
- Right-click an edge → delete tx
- Right-click a label → label context menu
- Double-click empty canvas → wallet creation modal opens at that position
- Drag a node → position updates
- Drag a group → all members shift by the delta (not just the group node)
- Resize a node via cytoscape resize handle → size persists

**Step 4: Run `git status`**

---

## Phase 3 — JSX splits

### Task 12: Extract `CreationPanels` component

**Files:**
- Create: `frontend/src/components/Graph/CreationPanels.tsx`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Step 1: Create the component**

```tsx
'use client';

import { WalletForm } from '@/components/Forms/WalletForm';
import { TransactionForm } from '@/components/Forms/TransactionForm';
import type { Investigation, WalletNode, TransactionEdge, Trace } from '@/types/investigation';
import type { PanelMode } from '@/types/panel';

interface CreationPanelsProps {
  panelMode: PanelMode;
  investigation: Investigation;
  allWallets: { wallet: WalletNode; traceId: string }[];
  onSaveWallet: (traceId: string, data: Partial<WalletNode>) => void;
  onSaveTransaction: (traceId: string, data: Partial<TransactionEdge>) => void;
  onCancel: () => void;
  onCreateTrace: () => Promise<string | undefined>;
}

export function CreationPanels({
  panelMode,
  investigation,
  allWallets,
  onSaveWallet,
  onSaveTransaction,
  onCancel,
  onCreateTrace,
}: CreationPanelsProps) {
  if (panelMode.type === 'createWallet') {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40">
        <div className="bg-surface-panel rounded-lg p-6 w-96 max-h-[80vh] overflow-y-auto">
          <h3 className="text-sm font-semibold text-ink-muted uppercase mb-4">New Address</h3>
          <WalletForm
            traces={investigation.traces}
            selectedTraceId={investigation.traces[0]?.id}
            onSave={onSaveWallet}
            onCancel={onCancel}
            onCreateTrace={onCreateTrace}
            prefill={panelMode.prefill}
          />
        </div>
      </div>
    );
  }

  if (panelMode.type === 'createTransaction') {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40">
        <div className="bg-surface-panel rounded-lg p-6 w-[480px] max-h-[80vh] overflow-y-auto">
          <h3 className="text-sm font-semibold text-ink-muted uppercase mb-4">New Transaction</h3>
          <TransactionForm
            traces={investigation.traces}
            allWallets={allWallets}
            onSave={onSaveTransaction}
            onCancel={onCancel}
            onCreateTrace={onCreateTrace}
            prefill={panelMode.prefill}
          />
        </div>
      </div>
    );
  }

  return null;
}
```

**Step 2: Extract `PanelMode` into its own type file**

Create `frontend/src/types/panel.ts`:

```ts
import type { WalletNode, TransactionEdge } from './investigation';

export type PanelMode =
  | { type: 'none' }
  | { type: 'createWallet'; position?: { x: number; y: number }; prefill?: Partial<WalletNode> }
  | { type: 'createTransaction'; prefill?: Partial<TransactionEdge> };
```

**Step 3: Wire into the page**

Delete the `PanelMode` type at the top of the page (lines 39–42) and the `renderCreationPanel` function (lines 1101–1141). Add imports for `PanelMode` and `CreationPanels`. Replace `{renderCreationPanel()}` (line 1470) with:

```tsx
{investigation && (
  <CreationPanels
    panelMode={panelMode}
    investigation={investigation}
    allWallets={allWallets}
    onSaveWallet={handleSaveNewWallet}
    onSaveTransaction={handleSaveNewTransaction}
    onCancel={() => setPanelMode({ type: 'none' })}
    onCreateTrace={handleAddTrace}
  />
)}
```

**Step 4: Verify build + smoke test**

Run: `npm run build --prefix frontend`. In the browser: double-click empty canvas → New Address modal. Save → wallet appears. Quick-add a transaction in the QuickAddInput → New Transaction modal. Save → tx appears.

**Step 5: Run `git status`**

---

### Task 13: Extract `SelectionDetailsPanel` component

**Files:**
- Create: `frontend/src/components/Graph/SelectionDetailsPanel.tsx`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Step 1: Create the component**

The component owns the `FloatingPanel` + `DetailsPanel` cluster (page lines 1239–1355). It receives:

- `selectedItem`, `setSelectedItem`, `investigation`
- All mutator callbacks needed by DetailsPanel
- `graphRef` (as a ref-callback for `unselectAll` and `setEdgeArc`)
- `detailsPanelRef` (so the page can imperatively start edit via header actions)
- `activeInvestigationId`, `refreshScriptRuns` for the rerun-script flow
- The bundling helpers: `handleBundleAllOutbound`, `handleBundleAllInbound`, `handleDeleteAllOutbound`, `handleDeleteAllInbound`, `handleFetchHistory`

```tsx
'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';
import { FloatingPanel } from '@/components/Common/FloatingPanel';
import { DetailsPanel, type DetailsPanelHandle } from '@/components/Graph/DetailsPanel';
import { WalletHeaderActions, TransactionHeaderActions } from '@/components/Graph/HeaderActions';
import { applyArcDelta } from '@/utils/arcEdge';
import { apiClient } from '@/lib/api-client';
import type { Investigation, WalletNode, TransactionEdge, Trace, Group, EdgeBundle } from '@/types/investigation';
import type { GraphCanvasHandle } from '@/components/Graph/GraphCanvas';

interface SelectionDetailsPanelProps {
  selectedItem: any;
  setSelectedItem: (item: any | null) => void;
  investigation: Investigation;
  allWallets: { wallet: WalletNode; traceId: string }[];
  graphRef: React.RefObject<GraphCanvasHandle>;
  activeInvestigationId: string | null;

  updateWallet: (traceId: string, walletId: string, patch: Partial<WalletNode>) => void;
  deleteWallet: (traceId: string, walletId: string) => void;
  updateTransaction: (traceId: string, txId: string, patch: Partial<TransactionEdge>) => void;
  deleteTransaction: (traceId: string, txId: string) => void;
  updateTrace: (traceId: string, patch: Partial<Trace>) => void;
  deleteTrace: (traceId: string) => void;
  updateGroup: (traceId: string, groupId: string, patch: Partial<Group>) => void;
  deleteGroup: (traceId: string, groupId: string) => void;
  setNodeGroup: (traceId: string, nodeIds: string[], groupId: string | null) => void;
  toggleEdgeBundle: (traceId: string, bundleId: string) => void;
  updateEdgeBundle: (traceId: string, bundleId: string, patch: Partial<EdgeBundle>) => void;
  deleteEdgeBundle: (traceId: string, bundleId: string) => void;

  onFetchHistory: (address: string, chain: string) => void;
  onBundleAllOutbound: (walletId: string, color: string) => void;
  onDeleteAllOutbound: (walletId: string) => void;
  onBundleAllInbound: (walletId: string, color: string) => void;
  onDeleteAllInbound: (walletId: string) => void;
  onRefreshScriptRuns: () => Promise<void>;
}

export interface SelectionDetailsPanelHandle {
  startEdit: () => void;
}

export const SelectionDetailsPanel = forwardRef<SelectionDetailsPanelHandle, SelectionDetailsPanelProps>(
  function SelectionDetailsPanel(props, ref) {
    const {
      selectedItem, setSelectedItem, investigation, allWallets, graphRef,
      updateWallet, deleteWallet, updateTransaction, deleteTransaction,
      updateTrace, deleteTrace, updateGroup, deleteGroup, setNodeGroup,
      toggleEdgeBundle, updateEdgeBundle, deleteEdgeBundle,
      onFetchHistory, onBundleAllOutbound, onDeleteAllOutbound,
      onBundleAllInbound, onDeleteAllInbound, onRefreshScriptRuns,
    } = props;

    const detailsPanelRef = useRef<DetailsPanelHandle>(null);
    useImperativeHandle(ref, () => ({
      startEdit: () => detailsPanelRef.current?.startEdit(),
    }));

    const title = selectedItem.type === 'wallet' ? 'Address'
      : selectedItem.type === 'scriptRun' ? 'Script'
      : selectedItem.type === 'aggregatedEdge' ? 'Aggregated Transactions'
      : selectedItem.type;

    return (
      <FloatingPanel
        title={`${title} Details`}
        onClose={() => { setSelectedItem(null); graphRef.current?.unselectAll(); }}
        className="absolute bottom-4 left-4"
        width="w-[420px]"
        actions={selectedItem.type === 'wallet' ? (
          <WalletHeaderActions
            wallet={selectedItem.data as WalletNode}
            onEdit={() => detailsPanelRef.current?.startEdit()}
            onDelete={() => {
              const w = selectedItem.data as WalletNode;
              deleteWallet(w.parentTrace, w.id);
              setSelectedItem(null);
              graphRef.current?.unselectAll();
            }}
            onColorChange={(color) => updateWallet(selectedItem.data.parentTrace, selectedItem.data.id, { color })}
          />
        ) : selectedItem.type === 'transaction' ? (
          <TransactionHeaderActions
            transaction={selectedItem.data as TransactionEdge}
            onEdit={() => detailsPanelRef.current?.startEdit()}
            onDelete={() => {
              const tx = selectedItem.data as TransactionEdge;
              const traceId = investigation.traces.find((t) => t.edges.some((e) => e.id === tx.id))?.id || '';
              deleteTransaction(traceId, tx.id);
              setSelectedItem(null);
              graphRef.current?.unselectAll();
            }}
            onColorChange={(color) => {
              const tx = selectedItem.data as TransactionEdge;
              const traceId = investigation.traces.find((t) => t.edges.some((e) => e.id === tx.id))?.id || '';
              updateTransaction(traceId, tx.id, { color });
            }}
          />
        ) : undefined}
      >
        <DetailsPanel
          ref={detailsPanelRef}
          selectedItem={selectedItem}
          traces={investigation.traces}
          allWallets={allWallets}
          onUpdateWallet={updateWallet}
          onDeleteWallet={(traceId, walletId) => { deleteWallet(traceId, walletId); setSelectedItem(null); }}
          onUpdateTransaction={updateTransaction}
          onDeleteTransaction={(traceId, txId) => { deleteTransaction(traceId, txId); setSelectedItem(null); }}
          onUpdateTrace={updateTrace}
          onDeleteTrace={(traceId) => {
            apiClient.deleteTrace(traceId).catch(console.error);
            deleteTrace(traceId);
            setSelectedItem(null);
          }}
          onUpdateGroup={updateGroup}
          onDeleteGroup={(traceId, groupId) => { deleteGroup(traceId, groupId); setSelectedItem(null); }}
          onSetNodeGroup={setNodeGroup}
          onToggleEdgeBundle={toggleEdgeBundle}
          onUpdateEdgeBundle={updateEdgeBundle}
          onDeleteEdgeBundle={(traceId, bundleId) => { deleteEdgeBundle(traceId, bundleId); setSelectedItem(null); }}
          onFetchHistory={onFetchHistory}
          onBundleAllOutbound={onBundleAllOutbound}
          onDeleteAllOutbound={onDeleteAllOutbound}
          onBundleAllInbound={onBundleAllInbound}
          onDeleteAllInbound={onDeleteAllInbound}
          onRerunScript={async (scriptRunId) => {
            await apiClient.rerunScript(scriptRunId);
            await onRefreshScriptRuns();
          }}
          onArcEdge={(edgeId, delta) => {
            const persisted = applyArcDelta(investigation, edgeId, delta, { updateTransaction, updateEdgeBundle });
            if (!persisted) graphRef.current?.setEdgeArc(edgeId, delta);
          }}
        />
      </FloatingPanel>
    );
  }
);
```

**Step 2: Wire into the page**

The page previously called `detailsPanelRef.current?.startEdit()` from outside — but on inspection, all such calls are now INSIDE `SelectionDetailsPanel` itself (the header action buttons). So we don't actually need to thread `detailsPanelRef` out of the new component. Delete `detailsPanelRef` from the page entirely.

Replace the entire `{selectedItem && selectedNodeIds.length < 2 && selectedEdgeIds.length < 2 && (...)}` block (page lines 1239–1355) with:

```tsx
{selectedItem && selectedNodeIds.length < 2 && selectedEdgeIds.length < 2 && (
  <SelectionDetailsPanel
    selectedItem={selectedItem}
    setSelectedItem={setSelectedItem}
    investigation={investigation}
    allWallets={allWallets}
    graphRef={graphRef}
    activeInvestigationId={activeInvestigationId}
    updateWallet={updateWallet}
    deleteWallet={deleteWallet}
    updateTransaction={updateTransaction}
    deleteTransaction={deleteTransaction}
    updateTrace={updateTrace}
    deleteTrace={deleteTrace}
    updateGroup={updateGroup}
    deleteGroup={deleteGroup}
    setNodeGroup={setNodeGroup}
    toggleEdgeBundle={toggleEdgeBundle}
    updateEdgeBundle={updateEdgeBundle}
    deleteEdgeBundle={deleteEdgeBundle}
    onFetchHistory={handleFetchHistory}
    onBundleAllOutbound={handleBundleAllOutbound}
    onDeleteAllOutbound={handleDeleteAllOutbound}
    onBundleAllInbound={handleBundleAllInbound}
    onDeleteAllInbound={handleDeleteAllInbound}
    onRefreshScriptRuns={refreshScriptRuns}
  />
)}
```

Also remove the now-unused `applyArcDelta` import from the page (it lives in `SelectionDetailsPanel` now).

**Step 3: Verify build + smoke test**

Run: `npm run build --prefix frontend`. In the browser, exercise every panel variant:
- Click a wallet → wallet details, header actions (color, edit, delete) work
- Click a transaction → tx details, color/edit/delete work
- Click a trace label → trace details, delete-trace works
- Click a group → group details
- Click an edge bundle → bundle details, toggle collapse works
- Click an aggregated edge → aggregated details
- Click a script run → script details, rerun works
- Bend an edge (arc) → arc persists for tx and bundle, ephemeral for aggregated

**Step 4: Run `git status`**

---

### Task 14: Extract `WorkspaceModals` component

**Files:**
- Create: `frontend/src/components/Workspace/WorkspaceModals.tsx`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Step 1: Create the component**

It owns: investigation edit form, delete confirm, search panel, fetch modal, staging panel.

```tsx
'use client';

import { FloatingPanel } from '@/components/Common/FloatingPanel';
import { InvestigationForm } from '@/components/Forms/InvestigationForm';
import { ConfirmDeleteModal } from '@/components/Common/ConfirmDeleteModal';
import { FetchModal } from '@/components/Workspace/FetchModal';
import { StagingPanel } from '@/components/Graph/StagingPanel';
import { SearchPanel } from '@/components/AdvancedSearch/SearchPanel';
import { apiClient, type Investigation as ApiInvestigation } from '@/lib/api-client';
import type { Investigation, TransactionEdge } from '@/types/investigation';

interface WorkspaceModalsProps {
  caseId: string;
  investigation: Investigation;

  editingInvestigation: ApiInvestigation | null;
  setEditingInvestigation: (i: ApiInvestigation | null) => void;

  deletingInvestigation: ApiInvestigation | null;
  setDeletingInvestigation: (i: ApiInvestigation | null) => void;

  activeInvestigationId: string | null;
  clearInvestigation: () => void;
  reloadInvestigations: () => void;
  /** Used by the "duplicate" flow to navigate to the new investigation. Thread the same callback that the sidebar uses, NOT a raw router — this keeps URL-sync logic in one place (useInvestigationUrlSync). */
  selectInvestigation: (id: string) => void;

  searchOpen: boolean;
  setSearchOpen: (b: boolean) => void;
  selectedTraceId?: string;

  fetchModalWallet: { address: string; chain: string } | null;
  setFetchModalWallet: (w: { address: string; chain: string } | null) => void;
  onAddStagedToTrace: (traceId: string, selected: TransactionEdge[]) => void;

  stagedItems: TransactionEdge[];
  setStagedItems: (items: TransactionEdge[]) => void;
}

export function WorkspaceModals(props: WorkspaceModalsProps) {
  const {
    caseId, investigation,
    editingInvestigation, setEditingInvestigation,
    deletingInvestigation, setDeletingInvestigation,
    activeInvestigationId, clearInvestigation, reloadInvestigations, selectInvestigation,
    searchOpen, setSearchOpen, selectedTraceId,
    fetchModalWallet, setFetchModalWallet, onAddStagedToTrace,
    stagedItems, setStagedItems,
  } = props;

  return (
    <>
      {editingInvestigation && (
        <FloatingPanel
          title="Investigation"
          onClose={() => setEditingInvestigation(null)}
          className="absolute top-4 left-4"
        >
          <InvestigationForm
            investigation={editingInvestigation}
            traces={investigation.id === editingInvestigation.id ? (investigation.traces as any) : undefined}
            onSave={async (updates) => {
              await apiClient.updateInvestigation(editingInvestigation.id, updates);
              setEditingInvestigation(null);
              reloadInvestigations();
            }}
            onDelete={() => {
              setDeletingInvestigation(editingInvestigation);
              setEditingInvestigation(null);
            }}
            onDuplicate={async () => {
              const copy = await apiClient.duplicateInvestigation(editingInvestigation.id);
              setEditingInvestigation(null);
              reloadInvestigations();
              selectInvestigation(copy.id);
            }}
            onCancel={() => setEditingInvestigation(null)}
          />
        </FloatingPanel>
      )}

      {deletingInvestigation && (
        <ConfirmDeleteModal
          title="Delete investigation"
          expectedText={deletingInvestigation.name}
          message={
            <>
              This will permanently delete <span className="text-gray-200 font-medium">{deletingInvestigation.name}</span> and all of its traces, nodes, edges, and scripts. This cannot be undone.
            </>
          }
          onConfirm={async () => {
            const id = deletingInvestigation.id;
            await apiClient.deleteInvestigation(id);
            setDeletingInvestigation(null);
            if (activeInvestigationId === id) clearInvestigation();
            reloadInvestigations();
          }}
          onCancel={() => setDeletingInvestigation(null)}
        />
      )}

      {investigation.traces.length > 0 && (
        <SearchPanel
          investigation={investigation}
          selectedTraceId={selectedTraceId}
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {fetchModalWallet && (
        <FetchModal
          initialAddress={fetchModalWallet.address}
          initialChain={fetchModalWallet.chain}
          traces={investigation.traces}
          existingTxKeys={new Set(
            investigation.traces.flatMap((t) =>
              t.edges.map((e) => `${e.txHash}-${e.from}-${e.to}`)
            )
          )}
          onAdd={onAddStagedToTrace}
          onClose={() => setFetchModalWallet(null)}
        />
      )}

      {stagedItems.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-20">
          <StagingPanel
            items={stagedItems}
            traces={investigation.traces}
            onAddToTrace={onAddStagedToTrace}
            onClear={() => setStagedItems([])}
          />
        </div>
      )}
    </>
  );
}
```

**Step 2: Wire into the page**

Replace the five blocks (page lines 1357–1439) with one call to `<WorkspaceModals .../>` passing the props above. Add the import.

**Step 3: Verify build + smoke test**

Run: `npm run build --prefix frontend`. In the browser:
- Click edit-investigation in the sidebar → InvestigationForm appears, save works
- Click delete in the form → ConfirmDeleteModal, type the name, delete works
- Click the magnifier → SearchPanel
- Right-click wallet → Fetch history → FetchModal appears, add to trace works
- After fetch, StagingPanel appears at the bottom, add/clear works

**Step 4: Run `git status`**

---

### Task 15: Extract `WorkspaceEmptyState` component

**Files:**
- Create: `frontend/src/components/Workspace/WorkspaceEmptyState.tsx`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Step 1: Create the component**

```tsx
'use client';

import { PageHeader } from '@/components/Common/PageHeader';
import UserMenu from '@/components/Auth/UserMenu';

export function WorkspaceEmptyState() {
  return (
    <>
      <PageHeader title="Investigations" rightContent={<UserMenu variant="light" />} />
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center text-center">
          <img
            src="/logo-light.png"
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-20 w-20 select-none mb-4 opacity-90"
          />
          <h2 className="text-2xl font-bold mb-2">Daubert</h2>
          <p className="text-ink-faint">Select or create an investigation to begin</p>
        </div>
      </div>
    </>
  );
}
```

**Step 2: Wire into the page**

Replace the empty-state branch (lines 1442–1459) with `<WorkspaceEmptyState />`.

**Step 3: Verify build + smoke test**

Run: `npm run build --prefix frontend`. In the browser, navigate to `/cases/<id>/investigations` with no `?inv=` query — empty state renders.

**Step 4: Run `git status`**

---

## Phase 4 — Final cleanup

### Task 16: Page review and dead-code sweep

**Files:**
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Step 1: Re-read the page top-to-bottom**

Check for:
- Unused imports — VS Code or TypeScript should flag these. Remove.
- Variables that are now used in only one place — inline them.
- Comments that referenced the old structure (e.g. "Auto-save traces to backend" — that effect is gone now). Remove or move them with the code they describe.
- The `selectedTraceId` and `selectedScriptRunId` derivations (lines 487–488) — these are used by `updateSidebar` only. Leave them.
- `EDIT_ICON` / `TRASH_ICON` should no longer exist in the page (moved in Task 3).

**Step 2: Count lines**

Run: `wc -l frontend/src/app/cases/\[caseId\]/investigations/page.tsx`
Expected: between 280 and 320 lines. If over 380, something didn't get extracted — review the file. Most likely culprit is a hook that didn't actually delete the page-side code (the implementer added the hook call but forgot to remove the inline original).

**Step 3: Run full test suite**

Run: `npm test --prefix frontend`
Expected: all tests pass. Pay attention to `cytoscapeSync.test.ts`, `focusItem.test.ts`, `edgeBundling.test.ts`.

**Step 4: Run build one more time**

Run: `npm run build --prefix frontend`
Expected: build succeeds with no TS errors and no new warnings.

**Step 5: Full smoke test in browser**

Open an investigation and exercise every code path that was moved:
- Load investigation by URL → loads
- Click sidebar investigation → URL updates, loads
- Drag a node → position auto-saves after 1s
- Edit a wallet → details panel doesn't go stale
- Multi-select wallets → batch ops work
- Multi-select edges → bundle works
- Right-click wallet → context menu, bundle outbound/inbound, delete outbound/inbound, fetch history
- Right-click empty canvas → context menu, create wallet here
- Quick-add address → wallet form pre-fills
- Quick-add tx → tx form pre-fills
- Export PNG → exports
- Search → opens panel
- Edit investigation → form, duplicate, delete

**Step 6: Run `git status`**

Expected output (paraphrased):
```
On branch main
Changes not staged for commit:
  modified:   frontend/src/app/cases/[caseId]/investigations/page.tsx
  modified:   frontend/src/hooks/useCytoscapeOverlays.ts   (pre-existing, unrelated)

Untracked files:
  docs/plans/2026-05-26-investigations-page-refactor.md
  frontend/src/components/Graph/CreationPanels.tsx
  frontend/src/components/Graph/HeaderActions.tsx
  frontend/src/components/Graph/SelectionDetailsPanel.tsx
  frontend/src/components/Workspace/WorkspaceEmptyState.tsx
  frontend/src/components/Workspace/WorkspaceModals.tsx
  frontend/src/hooks/useBatchNodeOps.ts
  frontend/src/hooks/useEdgeBundling.ts
  frontend/src/hooks/useGraphContextMenu.ts
  frontend/src/hooks/useInvestigationLoader.test.ts
  frontend/src/hooks/useInvestigationLoader.ts
  frontend/src/hooks/useInvestigationUrlSync.ts
  frontend/src/hooks/useSelectedItem.test.ts
  frontend/src/hooks/useSelectedItem.ts
  frontend/src/hooks/useWalletTransactionAuthoring.ts
  frontend/src/types/panel.ts
  frontend/src/utils/arcEdge.test.ts
  frontend/src/utils/arcEdge.ts
  frontend/src/utils/edgeBundling.test.ts
  frontend/src/utils/edgeBundling.ts
  frontend/src/utils/focusItem.test.ts
  frontend/src/utils/focusItem.ts
```

Hand off to the user for review and commit.

---

## Done state

- `frontend/src/app/cases/[caseId]/investigations/page.tsx` is ~250–300 lines.
- Pure resolvers, arc logic, and edge bundling have unit tests.
- Outbound and inbound bundling share one implementation.
- All existing user-visible behavior is preserved.
- No commits made; changes await user review.
