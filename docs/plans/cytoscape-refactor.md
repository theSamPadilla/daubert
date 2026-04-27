# Cytoscape Hook Refactor — Phase 1 (steps 1–3)

**Goal:** Fix the brittleness of shift+drag multi-select in the trace graph and shrink `frontend/src/hooks/useCytoscape.ts` (currently 1006 lines doing six different jobs) by carving out two clean extractions. This is phase 1 of a longer refactor — phases 2–3 (event-binding extraction, sync extraction) are deliberately out of scope here.

**Architecture:** Today, selection state lives in a Cytoscape CSS class (`cy-sel`) on graph elements, while React separately tracks `selectedNodeIds`/`selectedEdgeIds` in `page.tsx`. The two are wired one-way: Cytoscape pushes selection changes to React via callbacks, but React never pushes back. Every time `syncToCytoscape` re-adds an element (which happens on any investigation mutation — rename, drag, label edit, etc.), the new element comes back without `cy-sel`, and the user's selection silently disappears even though React still holds the IDs. We flip the direction: React state becomes the single source of truth, and a new effect re-paints `cy-sel` from React state on every change. We also drop the "≥2 edges → clear nodes" heuristic in `boxend` that clobbers prior node selection during box-select. Then we extract the 220-line stylesheet and the ~150 lines of DOM overlay code (sublabels, edge sublabels, resize handle, edge orientation) into their own modules — pure mechanical extractions, no behavior change.

**Tech Stack:** Next.js 14, React 18, Cytoscape.js, TypeScript

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `frontend/src/hooks/useCytoscape.ts` | Modify | Selection becomes React-driven: hook accepts `selectedNodeIds`/`selectedEdgeIds` as inputs and re-paints `cy-sel` from them; tap/box handlers compute next selection and call back. Multi-select survives data changes. Mixed node+edge box-select no longer wipes nodes. |
| 2 | `frontend/src/app/cases/[caseId]/investigations/page.tsx` | Modify | Pass selection state into `GraphCanvas`/`useCytoscape`; `cytoscapeCallbacks` no longer have to triple-clear other selection arrays (the hook decides from the new payload shape). |
| 3 | `frontend/src/components/GraphCanvas.tsx` | Modify | Forward new `selectedNodeIds`/`selectedEdgeIds` props through to the hook. |
| 4 | `frontend/src/hooks/cytoscapeStyle.ts` | Create | Holds the `CYTOSCAPE_STYLE` array and the two color/date helpers (`contrastTextColor`, `formatShortDate`). Pure data + pure functions, no React. |
| 5 | `frontend/src/hooks/useCytoscape.ts` | Modify | Re-import `CYTOSCAPE_STYLE` and helpers from the new module; delete the in-file copies. |
| 6 | `frontend/src/hooks/useCytoscapeOverlays.ts` | Create | Owns the DOM overlay div, address sublabels, edge-date sublabels, edge orientation classes, and the resize handle (drag + position). Subscribes to `cy` events; returns nothing. |
| 7 | `frontend/src/hooks/useCytoscape.ts` | Modify | Remove the inlined overlay code (lines ~290–438) and call `useCytoscapeOverlays(cy, callbacks.onResizeNode)` from the init effect. |

### What changes (UX and DX)

**For the user (UX):**
- Shift+drag box-select for transactions (edges) actually works reliably. Selections survive any unrelated data change (renaming a wallet, dragging a node, editing a label).
- Mixing node and edge selections via shift+drag no longer silently drops the nodes when ≥2 edges land in the box.
- No new UI; this is purely a fix-and-cleanup pass.

**For the developer (DX):**
- `useCytoscape.ts` drops from ~1006 lines to ~600 lines.
- Selection has one source of truth. No more "why did my selection disappear" mystery — if React state has the ID, it's selected; if it doesn't, it isn't.
- The stylesheet is 220 lines of pure data — moving it out makes the hook readable and makes style edits reviewable in isolation.
- Overlay logic (sublabels, resize handle) lives next to its DOM, separate from selection/sync concerns.

### What does NOT change
- The selection visual (yellow ring on nodes, yellow underlay on edges) is identical.
- `syncToCytoscape` (the 240-line element diff) — left exactly as-is in this phase. Phase 2 will tackle it.
- The event-binding code (tap/dragfree/cxttap/dbltap/mouseover) stays inline in the init effect. Phase 2 will extract it.
- `CytoscapeCallbacks` keeps `onMultiSelect`, `onMultiSelectEdges`, `onSelectItem` — we don't collapse them into one callback in this phase (would touch every consumer; not worth the churn yet).
- All other commands the hook returns (`unselectAll`, `exportImage`, `setEdgeArc`, `containerRef`).
- The single-click solo-select / shift+click toggle / context menu / double-click background semantics.

---

## Task 1: Make selection React-driven (the bug fix)

**Files:**
- Modify: `frontend/src/hooks/useCytoscape.ts`
- Modify: `frontend/src/components/GraphCanvas.tsx`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx`

**Why this is task 1:** It fixes a real reported bug, and once selection is React-driven the later extractions (overlays especially — the resize handle reads `cy-sel`) become safer because there's only one place selection state can go stale.

### The current data flow (and why it's broken)

In `useCytoscape.ts:471–620`, tap and box handlers mutate the `cy-sel` class on graph elements directly, then call `notifySelection(inv)` / `notifyEdgeSelection(inv)` which inspect `cy-sel` and fire one of three callbacks (`onSelectItem` / `onMultiSelect` / `onMultiSelectEdges`). The callbacks update `selectedNodeIds` / `selectedEdgeIds` in `page.tsx:209,215`.

Then `syncToCytoscape` runs (triggered by *any* investigation mutation via `useEffect` at `:947`), and at `:891–944` it removes elements not in the target map and `cy.add(...)` for new ones. Re-added elements have no `cy-sel` class. Selection disappears visually; React state still holds the IDs but is now lying to the user.

Additionally, `boxend` at `:606–620` has a heuristic: if ≥2 edges ended up selected, `cy.nodes().removeClass('cy-sel')` — wiping any previously selected nodes. Edges between wallets are dense and easy to cross with a box, so this fires constantly and feels like a bug even though it's intentional.

### The new data flow

1. The hook accepts two new props: `selectedNodeIds: { id: string; traceId: string }[]` and `selectedEdgeIds: string[]`.
2. Tap handlers no longer mutate `cy-sel`. They compute the *next* selection arrays from the click + current state + shift key, and call back to React with the full new state.
3. A new `useEffect` in the hook watches `[selectedNodeIds, selectedEdgeIds]` and applies/removes `cy-sel` on the matching elements. This effect also fires after `syncToCytoscape` runs (because the same arrays are still set), so re-added elements get re-painted.
4. The "≥2 edges → clear nodes" rule goes away. Page.tsx callbacks decide what mixed states are allowed.

### Step 1: Add selection inputs to the hook signature

In `useCytoscape.ts`, change the signature at `:260–263`:

```ts
export function useCytoscape(
  investigation: Investigation | null,
  selectedNodeIds: { id: string; traceId: string }[],
  selectedEdgeIds: string[],
  callbacks: CytoscapeCallbacks = {}
)
```

### Step 2: Add the paint-from-state effect

After the init effect (after `:705`) and before the sync effect, add:

```ts
useEffect(() => {
  const cy = cyRef.current;
  if (!cy) return;
  cy.elements('.cy-sel').removeClass('cy-sel');
  const nodeIds = new Set(selectedNodeIds.map((n) => n.id));
  selectedEdgeIds.forEach((id) => {
    const e = cy.getElementById(id);
    if (e.length) e.addClass('cy-sel');
  });
  nodeIds.forEach((id) => {
    const n = cy.getElementById(id);
    if (n.length) n.addClass('cy-sel');
  });
}, [selectedNodeIds, selectedEdgeIds]);
```

Also call this paint logic at the end of `syncToCytoscape` (after `:944`) so newly-added elements get the class on the same tick they appear, not on the next React render. Easiest: extract a `paintSelection()` helper inside the hook scope and call it from both places.

### Step 3: Rewrite the tap handlers to compute next state

At `:471–545` (node tap), `:572–592` (edge tap), and `:595–600` (background tap), remove the `addClass`/`removeClass`/`clearSel` calls. Each branch should instead compute and call back. Pattern:

```ts
// Inside node tap, plain click on a leaf wallet node:
const nodeId = node.data('id');
const traceId = node.data('traceId') || node.data('parent');
const wasSoloSelected =
  selectedNodeIdsRef.current.length === 1 &&
  selectedNodeIdsRef.current[0].id === nodeId &&
  selectedEdgeIdsRef.current.length === 0;
if (wasSoloSelected) {
  callbacksRef.current.onSelectItem?.(null);
} else {
  // Find the wallet record and fire onSelectItem with type:'wallet'
  // (existing logic in notifySelection — keep it, just feed it the new state)
  callbacksRef.current.onSelectItem?.({ type: 'wallet', data: walletNode });
}
```

For shift+click on a node:

```ts
const nodeId = node.data('id');
const traceId = node.data('traceId') || node.data('parent');
const isSelected = selectedNodeIdsRef.current.some((n) => n.id === nodeId);
const next = isSelected
  ? selectedNodeIdsRef.current.filter((n) => n.id !== nodeId)
  : [...selectedNodeIdsRef.current, { id: nodeId, traceId }];
callbacksRef.current.onMultiSelect?.(next);
```

Add refs `selectedNodeIdsRef` / `selectedEdgeIdsRef` next to `investigationRef` at `:264–271` and update them on every render (same pattern as `callbacksRef`/`investigationRef`). Handlers read from the refs to avoid stale-closure bugs.

For edge tap (shift+click), drop the `cy.nodes().removeClass('cy-sel')` line — the React callback decides whether to keep nodes. Recommended page.tsx behavior in step 5 below: shift+click on an edge appends to `selectedEdgeIds` *and leaves `selectedNodeIds` alone*. Plain edge click clears nodes via `onSelectItem`.

For background tap, fire `onSelectItem(null)`. The existing `onSelectItem` callback in page.tsx already clears both arrays, which is the right behavior for clicking empty space.

### Step 4: Rewrite the boxend handler

Replace `:606–620` with:

```ts
cy.on('boxend', () => {
  const nativelySelectedNodes = cy.nodes(':selected').filter((n: any) => !n.isParent() || n.data('isGroup'));
  const nativelySelectedEdges = cy.edges(':selected');
  cy.elements().unselect(); // clear native :selected, we don't use it as state

  // Merge with current React selection (additive — shift+drag is always additive)
  const existingNodeIds = new Set(selectedNodeIdsRef.current.map((n) => n.id));
  const newNodes = nativelySelectedNodes
    .filter((n: any) => !existingNodeIds.has(n.data('id')))
    .map((n: any) => ({ id: n.data('id'), traceId: n.data('traceId') || n.data('parent') }));
  const nextNodeIds = [...selectedNodeIdsRef.current, ...newNodes];

  const existingEdgeIds = new Set(selectedEdgeIdsRef.current);
  const newEdges = nativelySelectedEdges.filter((e: any) => !existingEdgeIds.has(e.data('id'))).map((e: any) => e.data('id'));
  const nextEdgeIds = [...selectedEdgeIdsRef.current, ...newEdges];

  // Decide which callback(s) to fire based on resulting count
  if (nextNodeIds.length >= 2) callbacksRef.current.onMultiSelect?.(nextNodeIds);
  if (nextEdgeIds.length >= 2) callbacksRef.current.onMultiSelectEdges?.(nextEdgeIds);
  // Single-of-each selection → existing notifySelection / notifyEdgeSelection branches
  // (keep the helper but feed it the new arrays instead of querying cy-sel)
});
```

The key change: no more `cy.nodes().removeClass('cy-sel')` heuristic. If a box catches both nodes and edges, both arrays grow.

### Step 5: Update `GraphCanvas` and `page.tsx` to thread the props through

In `frontend/src/components/GraphCanvas.tsx`:

```tsx
interface GraphCanvasProps {
  investigation: Investigation | null;
  selectedNodeIds: { id: string; traceId: string }[];
  selectedEdgeIds: string[];
  callbacks: CytoscapeCallbacks;
}

// In the component body:
const { containerRef, unselectAll, exportImage, setEdgeArc } =
  useCytoscape(investigation, selectedNodeIds, selectedEdgeIds, callbacks);
```

In `frontend/src/app/cases/[caseId]/investigations/page.tsx` (around `:968`):

```tsx
<GraphCanvas
  investigation={investigation}
  selectedNodeIds={selectedNodeIds}
  selectedEdgeIds={selectedEdgeIds}
  callbacks={cytoscapeCallbacks}
  ref={graphRef}
/>
```

The `cytoscapeCallbacks` at `:824–866` can stay as-is — the existing three handlers map cleanly onto the new world. The only change worth considering: `onMultiSelectEdges` currently does `setSelectedNodeIds([])` at `:838`. With the new boxend logic supporting mixed selections, that line should go — let nodes survive an edge multi-select. Same for `onMultiSelect` clearing edges at `:834`.

### Step 6: Remove the now-dead helpers

- `clearSel` at `:441` is no longer called → remove.
- `selNodes` at `:444` and `selEdges` at `:548` were used by tap handlers and by `notifySelection` to read state. They survive only if `notifySelection`/`notifyEdgeSelection` still need to query cytoscape — but we just rewrote tap handlers to compute from refs, so these helpers should go too. The `notifySelection`/`notifyEdgeSelection` functions become small switches over the new selection arrays (single→`onSelectItem` with type, multi→`onMultiSelect*`).
- `unselectAll` at `:967` should now call back via `callbacksRef.current.onSelectItem?.(null)` instead of `cy.elements().removeClass('cy-sel')` directly. Page.tsx's `onSelectItem(null)` already clears both arrays, which the paint effect then mirrors to the canvas.

### Step 7: Verify

Run `npm run fe` and exercise:
1. Shift+drag a box around 3 wallet nodes → all 3 highlight, batch toolbar appears.
2. Drag one of those nodes → selection survives the dragfree → state update → sync cycle. *This is the main regression scenario the old code failed.*
3. Edit a wallet's label via the right panel while the multi-selection is active → selection survives.
4. Shift+drag a box around 3 transaction edges → all 3 highlight, batch edge toolbar appears.
5. With nodes still selected, shift+drag a box that crosses 2 edges → both nodes AND edges remain selected. *This was the heuristic bug.*
6. Plain click on the background → everything deselects.
7. Plain click on a wallet → solo selection, details panel opens.
8. Shift+click an already-selected node → that node deselects, others stay selected.

If any of those fail, the paint effect or the boxend logic needs another pass — don't move on to task 2 until all 8 work.

### Step 8: Commit

```bash
git add frontend/src/hooks/useCytoscape.ts frontend/src/components/GraphCanvas.tsx frontend/src/app/cases/\[caseId\]/investigations/page.tsx
git commit -m "fix(graph): make multi-select React-driven so it survives data syncs"
```

---

## Task 2: Extract the stylesheet

**Files:**
- Create: `frontend/src/hooks/cytoscapeStyle.ts`
- Modify: `frontend/src/hooks/useCytoscape.ts`

**Why now (after task 1, before task 3):** Pure mechanical move. No behavior change. Doing it now shrinks the file before the overlay extraction so each diff is easier to review.

### Step 1: Create the new module

`frontend/src/hooks/cytoscapeStyle.ts` should export:
- `CYTOSCAPE_STYLE` — the array currently at `useCytoscape.ts:36–258`
- `contrastTextColor(hex: string): string` — currently at `:7–16`
- `formatShortDate(ts: string | number): string` — currently at `:18–23`
- `SHORT_MONTHS` — currently at `:18` (const used only by `formatShortDate`; keep it module-private)

```ts
import type cytoscape from 'cytoscape';

export function contrastTextColor(hex: string): string { /* ... */ }

const SHORT_MONTHS = ['Jan', /* ... */];
export function formatShortDate(ts: string | number): string { /* ... */ }

export const CYTOSCAPE_STYLE: cytoscape.StylesheetStyle[] = [
  // ... entire array verbatim
];
```

`formatShortDate` uses `parseTimestamp` from `../utils/formatAmount` — keep that import.

### Step 2: Update useCytoscape.ts

At the top of `useCytoscape.ts`:

```ts
import { CYTOSCAPE_STYLE, contrastTextColor, formatShortDate } from './cytoscapeStyle';
```

Delete the in-file copies (lines `:7–23` and `:36–258`). The file shrinks by ~240 lines.

`contrastTextColor` is referenced inside `syncToCytoscape` (e.g. `:757`, `:787`, `:810`). `formatShortDate` is referenced at `:842`, `:846`, `:882–883`. The new imports cover both.

### Step 3: Verify

- `npm run build --prefix frontend` succeeds with no type errors.
- `npm run fe` and confirm: nodes render with the right colors, contrast text is right (light text on dark wallets, dark on light), edge date sublabels render in the same `Mar 5, 2026` format, selected nodes still get the yellow ring, selected edges still get the yellow underlay.

### Step 4: Commit

```bash
git add frontend/src/hooks/cytoscapeStyle.ts frontend/src/hooks/useCytoscape.ts
git commit -m "refactor(graph): extract CYTOSCAPE_STYLE and color helpers into cytoscapeStyle.ts"
```

---

## Task 3: Extract the DOM overlays

**Files:**
- Create: `frontend/src/hooks/useCytoscapeOverlays.ts`
- Modify: `frontend/src/hooks/useCytoscape.ts`

**Why this is a clean extraction:** The overlay code (sublabels, edge sublabels, edge orientations, resize handle) is self-contained. It needs the `cy` instance and the container element, plus one callback (`onResizeNode`). It doesn't touch selection logic except that the resize handle reads `cy-sel` to find the single selected node — and after task 1, that class is reliably painted from React state, so the read is now stable.

### What moves

From `useCytoscape.ts`:
- The overlay container creation at `:290–293` (the `overlayEl` div).
- `sublabelEls` map and `updateSublabels` at `:293–320`.
- `edgeSublabelEls` map and `updateEdgeSublabels` at `:323–365`.
- `updateEdgeOrientations` at `:368–378`.
- The resize handle element + `updateResizeHandle` + the mousedown drag handler at `:380–431`.
- The `cy.on('render', ...)` registration at `:433–438`.
- The cleanup pieces at `:701–703` (`overlayEl.remove()`, the two map clears).

### Step 1: Define the new hook

`frontend/src/hooks/useCytoscapeOverlays.ts`:

```ts
import { useEffect } from 'react';
import type { Core } from 'cytoscape';

export function useCytoscapeOverlays(
  cy: Core | null,
  container: HTMLDivElement | null,
  onResizeNode: ((nodeId: string, traceId: string, size: number) => void) | undefined
) {
  useEffect(() => {
    if (!cy || !container) return;

    const overlayEl = document.createElement('div');
    overlayEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    container.parentElement?.appendChild(overlayEl);

    const sublabelEls = new Map<string, HTMLDivElement>();
    const edgeSublabelEls = new Map<string, HTMLDivElement>();

    const updateSublabels = () => { /* ... copied verbatim ... */ };
    const updateEdgeSublabels = () => { /* ... */ };
    const updateEdgeOrientations = () => { /* ... */ };

    const resizeHandleEl = document.createElement('div');
    /* ... resize handle creation + mousedown wiring (use onResizeNode in onUp) ... */

    const updateResizeHandle = () => { /* ... */ };

    const onRender = () => {
      updateEdgeOrientations();
      updateSublabels();
      updateEdgeSublabels();
      updateResizeHandle();
    };
    cy.on('render', onRender);

    return () => {
      cy.off('render', onRender);
      overlayEl.remove();
      sublabelEls.clear();
      edgeSublabelEls.clear();
      // resize handle's document-level listeners are cleaned up in onUp; if a drag
      // is in flight at unmount, we'd leak — guard by adding an AbortController if needed
    };
  }, [cy, container, onResizeNode]);
}
```

The resize handle's mousedown closure captures `cy`, `container`, and `onResizeNode` — pass `onResizeNode` directly (don't use a ref) since this hook re-runs on its change anyway. If that causes too many re-binds, switch to a ref pattern matching the parent hook.

### Step 2: Wire it into useCytoscape

In the init effect of `useCytoscape.ts`, delete the moved blocks. After the init effect finishes setting up the `cy` instance, call the new hook from the top level of `useCytoscape` (hooks can't be called inside effects):

```ts
// Inside useCytoscape function body, after the init useEffect:
useCytoscapeOverlays(cyRef.current, containerRef.current, callbacks.onResizeNode);
```

But `cyRef.current` is null on first render — the init effect runs *after* render. So `useCytoscapeOverlays` will run with `cy=null` first, return early, then re-run after a state change... except `cyRef` is a ref and doesn't trigger re-renders. We need a state version.

**Fix:** Convert `cyRef` to a `useState`-based handle, OR add a `cyVersion` state bumped at the end of the init effect to force `useCytoscapeOverlays` to re-evaluate. Simplest is `useState`:

```ts
const [cy, setCy] = useState<Core | null>(null);
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (!containerRef.current) return;
  const instance = cytoscape({ /* ... */ });
  setCy(instance);
  // ... bind events using instance ...
  return () => { instance.destroy(); setCy(null); };
}, []);

useCytoscapeOverlays(cy, containerRef.current, callbacks.onResizeNode);
```

The init effect's event handlers (tap/dragfree/etc., still inline) use the local `instance` variable in their closure — same as today's `cy` const. Replace internal `cyRef.current` reads with the local variable inside the effect; *outside* the effect (in `unselectAll`, `exportImage`, `setEdgeArc`, the paint effect from task 1, the sync effect), use the `cy` state.

### Step 3: Verify

- `npm run fe` and confirm:
  - Wallet sublabels (truncated address) render below custom-labeled nodes.
  - Edge date sublabels render at edge midpoints with correct rotation/anti-flip behavior.
  - Selecting a single wallet shows the yellow resize handle at the bottom-right; dragging it resizes the node and persists on mouseup.
  - Selecting two wallets hides the resize handle.
  - Near-vertical edges get the `near-vertical` class (visible if any styles depend on it; otherwise check via DevTools).
  - Switching investigations or destroying the canvas cleans up the overlay div (no orphan DOM nodes — check Elements panel).

### Step 4: Commit

```bash
git add frontend/src/hooks/useCytoscapeOverlays.ts frontend/src/hooks/useCytoscape.ts
git commit -m "refactor(graph): extract DOM overlays (sublabels, resize handle) into useCytoscapeOverlays"
```

---

## Out of scope (deferred to phase 2)

- Extracting the event-binding code (tap/box/dragfree/cxttap/dbltap/edge-hover) into a `bindCytoscapeEvents(cy, callbacks, getSelection) → unbind` function.
- Extracting `syncToCytoscape` (the 240-line element diff) into its own module — this is the gnarliest part and benefits most from being tackled after phase 1 has shrunk the file and stabilized selection.
- Collapsing the three selection callbacks (`onSelectItem`, `onMultiSelect`, `onMultiSelectEdges`) into a single `onSelectionChange({ nodeIds, edgeIds, focusItem })` payload. Worth doing eventually; not worth touching every consumer right now.
- Adding tests. The hook has no test coverage today; a manual checklist (in each task's verify step) is what we have. Consider a follow-up plan to add component tests once the surface stabilizes.
