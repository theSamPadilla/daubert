# Graph Label Export Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make exported PNGs WYSIWYG for user-authored annotation labels by eliminating the brittle "viewport overlay → full-extent PNG" composite math, replacing it with a single-coord-space export overlay.

**Architecture:**
- Today: `exportPngDataUrl` (frontend/src/hooks/useCytoscape.ts:197-357) captures the **live DOM overlay** (viewport-clipped, zoom-dependent, screen-pixel) and composites it onto a **full-extent base PNG** via per-export math that depends on `cy.pan/zoom/bb`, container size, and html2canvas scale. Any drift (devicePixelRatio mismatch, html2canvas transform quirks, viewport clipping, aspect mismatch) shifts labels.
- New: build a **dedicated off-screen "export overlay"** sized to the full-extent bounding box + padding. Render each label into it using a **synthetic GeometryContext** at zoom=1 with an offset = `(-bb.x1+padding, -bb.y1+padding)`. The overlay's coord space is now identical to the base PNG's (modulo the padding inset, which we apply in the composite canvas). The composite reduces to two `drawImage` calls with no zoom factor.

**Tech Stack:** Next.js 14 (App Router), Cytoscape.js, html2canvas, react-dom 18 (`createRoot` + `flushSync`), Jest + jsdom.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `frontend/src/lib/labelGeometry.ts` | Modify | Add `exportContextFromCy(cy, bb, padding)` — synthetic GeometryContext at zoom=1, offset = (-bb.x1+padding, -bb.y1+padding). Add `EXPORT_PADDING = 50` shared constant. |
| 2 | `frontend/src/lib/labelGeometry.test.ts` | Modify | Cover the new synthetic context across all four anchor types AND prove it ignores `cy.pan()` / `cy.zoom()`. |
| 3 | `frontend/src/components/Graph/labelStyling.ts` | Create | Pure helpers: `applyLabelWrapperStyles(el, label)` + constants currently duplicated inside `useCytoscapeOverlays.ts:217-451`. |
| 4 | `frontend/src/hooks/useCytoscapeOverlays.ts` | Modify | Use the new helpers. Drop the per-property `lastApplied*` cache (DOM style writes are cheap; the cache adds complexity for negligible gain). Behavioral no-op for the live overlay. |
| 5 | `frontend/src/lib/exportLabelOverlay.ts` | Create | `renderExportLabelOverlay(cy, labels, bb, padding) → { overlayEl, dispose }`. Off-screen, fully-managed React roots, `flushSync`-driven commit, no dependency on the live overlay. |
| 6 | `frontend/src/lib/exportLabelOverlay.test.ts` | Create | Unit tests: overlay sized to bb+padding; one child per resolvable label; positions match the synthetic-context math; dispose unmounts React roots (no leak); labels skipped when anchor unresolvable. |
| 7 | `frontend/src/hooks/useCytoscape.ts` | Modify | Rewrite the html2canvas composite block (lines 286-354) to use the new helper. DPR-aware scale matches `cy.png`'s effective output. Composite canvas is overlay-sized; base PNG is offset by `(padding × scale, padding × scale)`. Old pan/zoom/containerRect math deleted. |
| 8 | `frontend/src/hooks/useCytoscape.export.test.ts` | Create | Pure-function test of the composite math (extract into `composeExport(baseImg, overlayCanvas, padding, scale)` so it's testable without a real cy/html2canvas). Verifies a known pixel from the overlay lands at the expected location in the composite. |

### What changes (UX and DX)

**For the user (UX):**
- Exported PNGs match the live view: every annotation label sits where the user placed it, regardless of zoom, pan, viewport size, devicePixelRatio, or label position outside the visible viewport.
- Same fix applies to both export paths: the in-view export button (`page.tsx:400`) and the exhibit builder snapshot (`ExhibitBuilder.tsx:116`).

**For the developer (DX):**
- One coordinate system for export — no more "model vs. rendered vs. PNG pixel" reconciliation.
- DPR is handled in one place (`exportLabelOverlay.ts`) instead of being implicit and broken.
- Label styling shared between live and export via `labelStyling.ts`.
- The fix removes a class of bugs entirely (zoom-dependent export drift), not just the symptom.

---

## Engineering Decisions Made

- **Off-screen overlay over container resize.** Resizing the live container during export would cause a visible flash on the in-view path. The off-screen overlay reuses cy's coordinate data without disturbing the live render at all.
- **No marker-node hack for PNG padding.** The original draft of this plan added invisible marker nodes at the corners of `(bb ± padding)` to coax `cy.png({ full: true })` into emitting a padded image. Rejected for two reasons: (a) it mutates the cy graph mid-export, and any `render` event between add and remove would trigger the live overlay's `updateLabels` against a transiently expanded bbox; (b) `cy.png` adds zero internal padding (verified in `cytoscape.cjs.js:34767`), so we can just apply the padding in the composite step — make the composite canvas `(bb.w + 2*padding) × (bb.h + 2*padding) × scale` and `drawImage(basePng, padding*scale, padding*scale)`. Cleaner, fewer side effects.
- **DPR-aware scale.** Cytoscape's `cy.png({ scale: 2 })` multiplies output by `getPixelRatio()` internally when `maxWidth/maxHeight` is unset (`cytoscape.cjs.js:34744-34748`). On a retina display the base PNG is `bb.w × 4 × bb.h × 4`. We match this by passing `scale: 2 * devicePixelRatio` to `html2canvas`. Both layers end up at the same effective resolution.
- **Bypass `renderLabelMarkdownInto` for export; manage React roots directly.** `LabelOverlay.tsx:21` stores roots in a module-level `WeakMap<HTMLElement, Root>` and never exposes an `unmount`. Reusing it in the export path would leak one React root per exported label (and there's already a pre-existing root-collision warning between `useCytoscapeOverlays.ts:405` and `:456` — out of scope here, but flagged below). The export overlay creates each root inline, tracks them in an array, and unmounts them in `dispose()`.
- **`flushSync` instead of waiting for `requestAnimationFrame`.** React 18's `createRoot.render()` is async; one RAF is not a commit barrier. `flushSync(() => root.render(...))` forces synchronous commit so html2canvas runs against fully-rendered DOM.
- **`position: absolute; left: -100000px` for the off-screen overlay.** `position: fixed` interacts poorly with html2canvas's iframe-cloning capture path (html2canvas#2493, #2658). Absolute positioning at an extreme negative offset is the documented-safe pattern.
- **Padding constant `EXPORT_PADDING = 50` extracted to `labelGeometry.ts`.** Used in three places (overlay sizing, `cy.png` composite offset, the synthetic-context offset). Single source of truth.
- **Drop the `lastApplied*` style-gating cache in `useCytoscapeOverlays.ts`.** The cache exists to avoid touching `style.color/background/etc` on every `render` event (60+/s during pan). DOM style writes are cheap relative to React commits. Dropping the cache keeps the live and export paths using the same helper without divergent branches.
- **Keep `cy.png`'s edge-label and parent-style mutation block as-is.** Lines 215-258 in `useCytoscape.ts` are unrelated to the bug. The composite rewrite stops at line 286.

---

## Out of scope (flag as follow-ups if they bite)

- **Labels positioned outside the cy bounding box.** Free-floating labels far outside the bbox will be clipped at the overlay edge. Pre-existing behavior; fix would be to compute label positions first and extend the composite bbox to cover them.
- **Pre-existing React root collision in the live overlay.** `useCytoscapeOverlays.ts:405` calls `createRoot(markdownContainer)`, then `:456` calls `renderLabelMarkdownInto` which creates a *second* root on the same element. React logs a dev-mode warning. Not addressed here; flag separately.
- **html2canvas markdown rendering fidelity.** Bold weight, code-block backgrounds, link colors may render slightly off in the export. If the user complains, mitigation is to swap html2canvas for `dom-to-image` or to bake fonts as data URIs.
- **PDF orientation auto-detect.** `apiClient.exportGraph` derives orientation from the user-provided render options. The new PNG aspect ratio (`bb + padding`) differs from the old (viewport-bound). Verify in Task 5 manual smoke — if orientation defaults misbehave, fix as a follow-up.

---

## Task 1: Synthetic export GeometryContext + shared padding constant

**Files:**
- Modify: `frontend/src/lib/labelGeometry.ts`
- Test:   `frontend/src/lib/labelGeometry.test.ts`

**Step 1: Write the failing tests**

Append to `frontend/src/lib/labelGeometry.test.ts`:

```ts
import { exportContextFromCy, EXPORT_PADDING } from './labelGeometry';

describe('EXPORT_PADDING', () => {
  it('is 50px (matches cy.fit padding for visual consistency)', () => {
    expect(EXPORT_PADDING).toBe(50);
  });
});

describe('exportContextFromCy', () => {
  function makeFakeCy(overrides: Partial<any> = {}) {
    return {
      zoom: jest.fn(() => 0.37),                  // export must ignore this
      pan: jest.fn(() => ({ x: 999, y: -999 })),  // export must ignore this
      getElementById: () => ({ length: 0 }),
      edges: () => ({ filter: () => [] }),
      ...overrides,
    } as any;
  }

  it('returns zoom=1 and pan derived from bb + padding, never reading live zoom/pan', () => {
    const cy = makeFakeCy();
    const bb = { x1: 200, y1: 100, x2: 1200, y2: 700, w: 1000, h: 600 } as any;
    const ctx = exportContextFromCy(cy, bb, 50);
    expect(ctx.zoom).toBe(1);
    expect(ctx.pan).toEqual({ x: -150, y: -50 });
    expect(cy.zoom).not.toHaveBeenCalled();
    expect(cy.pan).not.toHaveBeenCalled();
  });

  it('resolves a free anchor in PNG-pixel space (model + offset)', () => {
    const cy = makeFakeCy();
    const bb = { x1: 0, y1: 0, x2: 1000, y2: 1000, w: 1000, h: 1000 } as any;
    const ctx = exportContextFromCy(cy, bb, 50);
    expect(resolveLabelRenderedPosition({ type: 'free', x: 100, y: 200 }, ctx))
      .toEqual({ x: 150, y: 250 });
  });

  it('resolves a node anchor from node.position() (model), NOT renderedPosition()', () => {
    const fakeNode = {
      length: 1,
      isNode: () => true,
      position: () => ({ x: 400, y: 300 }),
      renderedPosition: () => ({ x: 9999, y: 9999 }), // tripwire — must not be read
    } as any;
    const cy = makeFakeCy({ getElementById: () => fakeNode });
    const bb = { x1: 0, y1: 0, x2: 1000, y2: 1000, w: 1000, h: 1000 } as any;
    const ctx = exportContextFromCy(cy, bb, 50);
    expect(resolveLabelRenderedPosition({ type: 'node', anchorId: 'n1', dx: 10, dy: -20 }, ctx))
      .toEqual({ x: 460, y: 330 });
  });

  it('resolves an edge anchor at midpoint + perpOffset, in PNG-pixel space', () => {
    const src = { renderedPosition: () => ({ x: 100, y: 100 }), position: () => ({ x: 100, y: 100 }) };
    const tgt = { renderedPosition: () => ({ x: 300, y: 100 }), position: () => ({ x: 300, y: 100 }) };
    const fakeEdge = { length: 1, isEdge: () => true, source: () => src, target: () => tgt } as any;
    const cy = makeFakeCy({ getElementById: () => fakeEdge });
    const bb = { x1: 0, y1: 0, x2: 400, y2: 400, w: 400, h: 400 } as any;
    const ctx = exportContextFromCy(cy, bb, 50);
    expect(resolveLabelRenderedPosition({ type: 'edge', anchorId: 'e1', t: 0.5, perpOffset: 10 }, ctx))
      .toEqual({ x: 250, y: 140 });
  });

  it('resolves a txEdge anchor via edges().filter, in PNG-pixel space', () => {
    const src = { position: () => ({ x: 0, y: 0 }), renderedPosition: () => ({ x: 0, y: 0 }) };
    const tgt = { position: () => ({ x: 200, y: 0 }), renderedPosition: () => ({ x: 200, y: 0 }) };
    const fakeEdge = { source: () => src, target: () => tgt, data: (k: string) => (k === 'txHash' ? '0xabc' : undefined) } as any;
    const fakeMatch = { length: 1, 0: fakeEdge };
    const cy = makeFakeCy({ edges: () => ({ filter: (_pred: any) => fakeMatch }) });
    const bb = { x1: 0, y1: 0, x2: 200, y2: 200, w: 200, h: 200 } as any;
    const ctx = exportContextFromCy(cy, bb, 50);
    expect(resolveLabelRenderedPosition({ type: 'txEdge', txHash: '0xabc', t: 0.5, perpOffset: 0 }, ctx))
      .toEqual({ x: 150, y: 50 });
  });
});
```

**Step 2: Verify the tests fail**

```bash
npm test --prefix frontend -- labelGeometry
```

Expected: `exportContextFromCy is not exported` and `EXPORT_PADDING is not exported`.

**Step 3: Implement `exportContextFromCy` + `EXPORT_PADDING`**

Append to `frontend/src/lib/labelGeometry.ts`:

```ts
/**
 * Padding applied around the cy bounding box in the exported image.
 * Matches the live `cy.fit(undefined, 50)` so exports feel visually consistent.
 */
export const EXPORT_PADDING = 50;

/**
 * GeometryContext for the export pipeline. Positions are returned in PNG-pixel
 * space relative to the composite canvas top-left, i.e. `(bb.x1 - padding, bb.y1 - padding)`
 * in model coords maps to (0, 0). Zoom is forced to 1 because the export PNG is unzoomed.
 *
 * Note: the returned `getNode/getEdge` adaptors expose `renderedPosition()`, but the
 * value they return is the cy element's **model** position. This is intentional — the
 * existing `resolveLabelRenderedPosition` expects renderedPosition() in whatever coord
 * space matches the context's zoom/pan, and for export that's model space.
 */
export function exportContextFromCy(
  cy: Core,
  bb: { x1: number; y1: number },
  padding: number,
): GeometryContext {
  const offset = { x: -bb.x1 + padding, y: -bb.y1 + padding };
  return {
    zoom: 1,
    pan: offset,
    getNode: (id: string) => {
      const n = cy.getElementById(id);
      if (!n || n.length === 0 || !n.isNode()) return null;
      const p = n.position();
      return { renderedPosition: () => ({ x: p.x, y: p.y }) };
    },
    getEdge: (id: string) => {
      const e = cy.getElementById(id);
      if (!e || e.length === 0 || !e.isEdge()) return null;
      return {
        source: () => ({ renderedPosition: () => e.source().position() }),
        target: () => ({ renderedPosition: () => e.target().position() }),
      };
    },
    getEdgeByTxHash: (txHash: string) => {
      const match = cy.edges().filter((e: any) => e.data('txHash') === txHash);
      if (match.length === 0) return null;
      const e = match[0];
      return {
        source: () => ({ renderedPosition: () => e.source().position() }),
        target: () => ({ renderedPosition: () => e.target().position() }),
      };
    },
  };
}
```

**Step 4: Verify tests pass**

```bash
npm test --prefix frontend -- labelGeometry
```

Expected: all six new tests pass; existing tests still pass.

**Step 5: Stop. Do not commit.** Run `git status`.

---

## Task 2: Extract pure label-styling helpers

**Files:**
- Create: `frontend/src/components/Graph/labelStyling.ts`
- Modify: `frontend/src/hooks/useCytoscapeOverlays.ts`

**Step 1: Create `labelStyling.ts`**

Create `frontend/src/components/Graph/labelStyling.ts`:

```ts
import type { TraceLabel } from '@/types/investigation';

export const FONT_SIZE_PX: Record<string, string> = { sm: '10px', md: '11px', lg: '14px' };

export const SHAPE_BORDER_RADIUS: Record<string, string> = {
  rectangle: '0',
  rounded: '6px',
  pill: '999px',
  ellipse: '50%',
};

export const DEFAULT_LABEL_BG = 'rgba(17,24,39,0.92)';
export const DEFAULT_LABEL_COLOR = '#f3f4f6';

/**
 * Base wrapper cssText, applied once on element creation. Position-specific
 * styles (left/top) are applied by the caller per-render.
 */
export const LABEL_WRAPPER_BASE_CSS =
  'position:absolute;transform:translate(-50%, -50%);pointer-events:auto;max-width:240px;' +
  'background:' + DEFAULT_LABEL_BG + ';color:' + DEFAULT_LABEL_COLOR + ';' +
  'border:1px solid #374151;border-radius:6px;' +
  'padding:6px 8px;font-size:11px;line-height:1.35;cursor:move;user-select:none;' +
  'box-shadow:0 2px 8px rgba(0,0,0,0.4);z-index:5;';

/**
 * Apply per-label visual styles (color, bg, fontSize, shape) to a wrapper element.
 * Unconditional writes — DOM style writes are cheap; the previous lastApplied* cache
 * was complexity without measurable benefit.
 */
export function applyLabelWrapperStyles(el: HTMLElement, label: TraceLabel): void {
  el.style.color = label.color ?? DEFAULT_LABEL_COLOR;
  el.style.background = label.bgColor ?? DEFAULT_LABEL_BG;
  el.style.fontSize = FONT_SIZE_PX[label.fontSize ?? 'md'] ?? '11px';
  el.style.borderRadius = SHAPE_BORDER_RADIUS[label.shape ?? 'rounded'] ?? '6px';
}
```

**Step 2: Refactor `useCytoscapeOverlays.ts` to use the helpers**

Open `frontend/src/hooks/useCytoscapeOverlays.ts`.

1. Add imports near the top:
   ```ts
   import {
     LABEL_WRAPPER_BASE_CSS,
     applyLabelWrapperStyles,
   } from '@/components/Graph/labelStyling';
   ```

2. Delete local constants on lines 217-229 (`FONT_SIZE_PX`, `SHAPE_BORDER_RADIUS`, `DEFAULT_LABEL_BG`).

3. In the `LabelEntry` interface (around line 232), delete the `lastApplied*` fields — we're dropping the cache.

4. In the wrapper creation block (around line 392):
   ```ts
   const wrapper = document.createElement('div');
   wrapper.className = 'label-wrapper';
   wrapper.style.cssText = LABEL_WRAPPER_BASE_CSS;
   ```

5. In the per-render styling block (around lines 430-451), replace the entire gated block with:
   ```ts
   applyLabelWrapperStyles(entry.wrapper, label);
   ```

6. Update `LabelEntry` to remove the deleted fields and the `newEntry` initializer:
   ```ts
   interface LabelEntry {
     wrapper: HTMLDivElement;
     markdownContainer: HTMLDivElement;
     cleanup: () => void;
     lastRenderedText: string;
   }
   ```
   The markdown text gating (`lastRenderedText`) stays — markdown re-render IS expensive.

**Step 3: Type-check + run existing tests**

```bash
npx tsc --noEmit -p frontend/tsconfig.json
npm test --prefix frontend
```

Expected: no type errors; all existing tests still pass.

**Step 4: Manual smoke (live overlay only)**

```bash
npm run db   # background
npm run be   # background
npm run fe   # foreground
```

Open the app, load a case with labels, verify they render visually identical to before pan/zoom/edit color or shape, all four font sizes, all four shapes.

**Step 5: Stop. Do not commit.** Run `git status`.

---

## Task 3: Build the off-screen export overlay

**Files:**
- Create: `frontend/src/lib/exportLabelOverlay.ts`
- Test:   `frontend/src/lib/exportLabelOverlay.test.ts`

**Step 1: Write the failing tests**

Create `frontend/src/lib/exportLabelOverlay.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { renderExportLabelOverlay } from './exportLabelOverlay';
import { EXPORT_PADDING } from './labelGeometry';
import type { TraceLabel } from '@/types/investigation';

function makeFakeCy(opts: {
  bb: { x1: number; y1: number; x2: number; y2: number; w: number; h: number };
  nodes?: Record<string, { x: number; y: number }>;
}) {
  return {
    getElementById: (id: string) => {
      const pos = opts.nodes?.[id];
      if (!pos) return { length: 0 } as any;
      return {
        length: 1,
        isNode: () => true,
        isEdge: () => false,
        position: () => pos,
      } as any;
    },
    edges: () => ({ filter: () => [] }),
  } as any;
}

const BB_DEFAULT = { x1: 0, y1: 0, x2: 1000, y2: 500, w: 1000, h: 500 };

describe('renderExportLabelOverlay', () => {
  it('sizes the overlay to bb + 2 * padding', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT });
    const result = renderExportLabelOverlay(cy, [], BB_DEFAULT, EXPORT_PADDING);
    expect(result.overlayEl.style.width).toBe('1100px');
    expect(result.overlayEl.style.height).toBe('600px');
    result.dispose();
  });

  it('positions the overlay off-screen via position:absolute (not fixed)', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT });
    const result = renderExportLabelOverlay(cy, [], BB_DEFAULT, EXPORT_PADDING);
    expect(result.overlayEl.style.position).toBe('absolute');
    expect(parseInt(result.overlayEl.style.left, 10)).toBeLessThan(-10000);
    result.dispose();
  });

  it('appends one child wrapper per resolvable label', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT, nodes: { n1: { x: 200, y: 100 } } });
    const labels: { traceId: string; label: TraceLabel }[] = [
      { traceId: 't', label: { id: 'L1', text: 'Foundation', anchor: { type: 'node', anchorId: 'n1', dx: 0, dy: 0 } } },
      { traceId: 't', label: { id: 'L2', text: 'Free', anchor: { type: 'free', x: 50, y: 50 } } },
    ];
    const result = renderExportLabelOverlay(cy, labels, BB_DEFAULT, EXPORT_PADDING);
    expect(result.overlayEl.querySelectorAll('.label-wrapper').length).toBe(2);
    result.dispose();
  });

  it('positions a node-anchored label at model + dx/dy + padding offset', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT, nodes: { n1: { x: 200, y: 100 } } });
    const labels = [{
      traceId: 't',
      label: { id: 'L1', text: 'x', anchor: { type: 'node' as const, anchorId: 'n1', dx: 10, dy: -20 } },
    }];
    const result = renderExportLabelOverlay(cy, labels, BB_DEFAULT, EXPORT_PADDING);
    const wrapper = result.overlayEl.querySelector('.label-wrapper') as HTMLElement;
    expect(wrapper.style.left).toBe('260px'); // 200 + 10 + 50
    expect(wrapper.style.top).toBe('130px');  // 100 - 20 + 50
    result.dispose();
  });

  it('position is independent of cy.zoom() and cy.pan() (the bug regression)', () => {
    const cyA: any = {
      zoom: () => 1, pan: () => ({ x: 0, y: 0 }),
      getElementById: () => ({
        length: 1, isNode: () => true, isEdge: () => false, position: () => ({ x: 300, y: 200 }),
      }),
      edges: () => ({ filter: () => [] }),
    };
    const cyB: any = {
      zoom: () => 0.4, pan: () => ({ x: 999, y: -500 }),
      getElementById: cyA.getElementById,
      edges: cyA.edges,
    };
    const labels = [{
      traceId: 't',
      label: { id: 'L1', text: 'x', anchor: { type: 'node' as const, anchorId: 'n1', dx: 0, dy: 0 } },
    }];
    const a = renderExportLabelOverlay(cyA, labels, BB_DEFAULT, EXPORT_PADDING);
    const b = renderExportLabelOverlay(cyB, labels, BB_DEFAULT, EXPORT_PADDING);
    const wA = a.overlayEl.querySelector('.label-wrapper') as HTMLElement;
    const wB = b.overlayEl.querySelector('.label-wrapper') as HTMLElement;
    expect(wA.style.left).toBe(wB.style.left);
    expect(wA.style.top).toBe(wB.style.top);
    a.dispose(); b.dispose();
  });

  it('skips labels whose anchor cannot be resolved', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT });
    const labels = [{
      traceId: 't',
      label: { id: 'L1', text: 'x', anchor: { type: 'node' as const, anchorId: 'gone', dx: 0, dy: 0 } },
    }];
    const result = renderExportLabelOverlay(cy, labels, BB_DEFAULT, EXPORT_PADDING);
    expect(result.overlayEl.querySelectorAll('.label-wrapper').length).toBe(0);
    result.dispose();
  });

  it('dispose() removes the overlay element AND unmounts each label React root', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT, nodes: { n1: { x: 100, y: 100 } } });
    const labels = [{
      traceId: 't',
      label: { id: 'L1', text: '**bold**', anchor: { type: 'node' as const, anchorId: 'n1', dx: 0, dy: 0 } },
    }];
    const result = renderExportLabelOverlay(cy, labels, BB_DEFAULT, EXPORT_PADDING);
    // React 18 commit happens synchronously via flushSync — DOM should already have bold tag.
    expect(result.overlayEl.querySelector('strong')?.textContent).toBe('bold');

    expect(document.body.contains(result.overlayEl)).toBe(true);
    result.dispose();
    expect(document.body.contains(result.overlayEl)).toBe(false);
    // Roots-leak guard: re-disposing should not throw (unmount is idempotent in our impl).
    expect(() => result.dispose()).not.toThrow();
  });
});
```

**Step 2: Verify tests fail**

```bash
npm test --prefix frontend -- exportLabelOverlay
```

Expected: `Cannot find module './exportLabelOverlay'`.

**Step 3: Implement `exportLabelOverlay.ts`**

Create `frontend/src/lib/exportLabelOverlay.ts`:

```ts
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Core } from 'cytoscape';
import type { TraceLabel } from '@/types/investigation';
import { exportContextFromCy, resolveLabelRenderedPosition } from './labelGeometry';
import {
  LABEL_WRAPPER_BASE_CSS,
  applyLabelWrapperStyles,
} from '@/components/Graph/labelStyling';
import { LabelOverlay } from '@/components/Graph/LabelOverlay';

export interface ExportLabelOverlayResult {
  overlayEl: HTMLDivElement;
  dispose: () => void;
}

/**
 * Build a hidden off-screen overlay sized to the full-extent bounding box of
 * the cy elements (+ padding on each side). Position every resolvable label
 * inside it using the synthetic export GeometryContext.
 *
 * The caller is responsible for:
 *   1. Rasterizing via html2canvas (use scale = 2 * devicePixelRatio to match cy.png).
 *   2. Calling dispose() to remove the overlay element + unmount React roots.
 *
 * Why `position: absolute; left: -100000px` (not `fixed`): html2canvas's iframe-cloning
 * path has documented issues with `position: fixed` elements at extreme offsets
 * (html2canvas#2493, #2658). Absolute positioning at a large negative offset is the
 * safe pattern.
 *
 * Why `flushSync` instead of `requestAnimationFrame`: `createRoot.render()` is async
 * under React 18 concurrent mode; one RAF tick is not a reliable commit barrier.
 * `flushSync` forces synchronous commit so html2canvas captures fully-rendered markdown.
 */
export function renderExportLabelOverlay(
  cy: Core,
  labels: { traceId: string; label: TraceLabel }[],
  bb: { x1: number; y1: number; x2: number; y2: number; w: number; h: number },
  padding: number,
): ExportLabelOverlayResult {
  const width = bb.w + 2 * padding;
  const height = bb.h + 2 * padding;

  const overlayEl = document.createElement('div');
  overlayEl.style.cssText =
    `position:absolute;left:-100000px;top:0;width:${width}px;height:${height}px;` +
    `pointer-events:none;overflow:hidden;`;
  document.body.appendChild(overlayEl);

  const ctx = exportContextFromCy(cy, bb, padding);
  const roots: Root[] = [];
  let disposed = false;

  for (const { label } of labels) {
    const pos = resolveLabelRenderedPosition(label.anchor, ctx);
    if (!pos) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'label-wrapper';
    wrapper.style.cssText = LABEL_WRAPPER_BASE_CSS;
    wrapper.style.left = `${pos.x}px`;
    wrapper.style.top = `${pos.y}px`;
    applyLabelWrapperStyles(wrapper, label);

    const markdownContainer = document.createElement('div');
    wrapper.appendChild(markdownContainer);
    overlayEl.appendChild(wrapper);

    const root = createRoot(markdownContainer);
    flushSync(() => {
      root.render(<LabelOverlay text={label.text} />);
    });
    roots.push(root);
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const root of roots) {
      try { root.unmount(); } catch { /* unmount of already-unmounted root is benign */ }
    }
    overlayEl.remove();
  };

  return { overlayEl, dispose };
}
```

Note: this file uses JSX, so save as `exportLabelOverlay.tsx`. Update the test import accordingly (`./exportLabelOverlay` resolves to `.tsx` via the existing tsconfig + jest config).

**Step 4: Verify tests pass**

```bash
npm test --prefix frontend -- exportLabelOverlay
```

Expected: all seven tests pass, including the regression test that proves position independence from cy.zoom/pan.

**Step 5: Stop. Do not commit.** Run `git status`.

---

## Task 4: Rewrite the composite path + extract pure `composeExport`

**Files:**
- Modify: `frontend/src/hooks/useCytoscape.ts` (lines 286-354)
- Create: `frontend/src/hooks/useCytoscape.export.test.ts`

**Step 1: Write the failing test for `composeExport`**

Create `frontend/src/hooks/useCytoscape.export.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { composeExport } from './useCytoscape';

function makeCanvas(width: number, height: number, fillColor?: string, dot?: { x: number; y: number; color: string }) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  if (fillColor) { ctx.fillStyle = fillColor; ctx.fillRect(0, 0, width, height); }
  if (dot) { ctx.fillStyle = dot.color; ctx.fillRect(dot.x, dot.y, 1, 1); }
  return c;
}

describe('composeExport', () => {
  it('produces a composite sized to bb + 2 * padding * scale (overlay dimensions)', async () => {
    const baseCanvas = makeCanvas(200, 100, 'red');                  // bb.w * scale × bb.h * scale
    const overlayCanvas = makeCanvas(300, 200, undefined);            // (bb + 2*padding) * scale
    const result = composeExport(baseCanvas, overlayCanvas, 50, 1);
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
  });

  it('draws the base PNG offset by (padding * scale, padding * scale)', () => {
    // Base: 1 red pixel at (0, 0). Padding inset should push it to (50, 50) in the composite.
    const baseCanvas = makeCanvas(2, 2, undefined, { x: 0, y: 0, color: 'red' });
    const overlayCanvas = makeCanvas(102, 102);
    const composite = composeExport(baseCanvas, overlayCanvas, 50, 1);
    const ctx = composite.getContext('2d')!;
    const pixel = ctx.getImageData(50, 50, 1, 1).data;
    expect(pixel[0]).toBe(255); // red
    expect(pixel[3]).toBe(255); // opaque
  });

  it('draws the overlay at (0, 0) on top of the base', () => {
    const baseCanvas = makeCanvas(2, 2, 'red');
    // Overlay: 1 blue pixel at (50, 50) (model space + padding, scale 1).
    const overlayCanvas = makeCanvas(102, 102, undefined, { x: 50, y: 50, color: 'blue' });
    const composite = composeExport(baseCanvas, overlayCanvas, 50, 1);
    const ctx = composite.getContext('2d')!;
    const pixel = ctx.getImageData(50, 50, 1, 1).data;
    expect(pixel[2]).toBe(255); // blue — overlay covers base at this position
  });

  it('scales the padding offset for the base PNG by `scale`', () => {
    const baseCanvas = makeCanvas(2, 2, 'red');
    const overlayCanvas = makeCanvas(204, 204);
    // scale=2: padding inset = 100 px in the composite, base should land at (100, 100).
    const composite = composeExport(baseCanvas, overlayCanvas, 50, 2);
    const ctx = composite.getContext('2d')!;
    expect(ctx.getImageData(99, 99, 1, 1).data[3]).toBe(0);     // outside base
    expect(ctx.getImageData(100, 100, 1, 1).data[0]).toBe(255); // base starts here, red
  });
});
```

**Step 2: Implement `composeExport` and rewrite the composite block**

Open `frontend/src/hooks/useCytoscape.ts`.

1. Add this exported pure function near the top of the file (after imports, before `useCytoscape`):

   ```ts
   /**
    * Compose the export image: a transparent canvas the size of the overlay,
    * with the base PNG drawn at `(padding * scale, padding * scale)` and the
    * overlay drawn at (0, 0) on top.
    *
    * Exported so it can be unit-tested without jsdom's missing html2canvas/cy.png.
    */
   export function composeExport(
     baseCanvas: HTMLCanvasElement,
     overlayCanvas: HTMLCanvasElement,
     padding: number,
     scale: number,
   ): HTMLCanvasElement {
     const composite = document.createElement('canvas');
     composite.width = overlayCanvas.width;
     composite.height = overlayCanvas.height;
     const ctx = composite.getContext('2d')!;
     ctx.drawImage(baseCanvas, padding * scale, padding * scale);
     ctx.drawImage(overlayCanvas, 0, 0);
     return composite;
   }
   ```

2. Replace the entire html2canvas composite block (lines 286-354 in the current file) with:

   ```ts
   // ── Export label overlay: rasterize annotation labels at full-extent coords ──
   // The live DOM overlay is viewport-bound and zoom-dependent — compositing it
   // onto the full-extent PNG required brittle math that drifted at any zoom !=
   // fit-zoom. Instead, build a dedicated off-screen overlay sized to the same
   // bbox as the PNG, render each label via a synthetic GeometryContext at
   // zoom=1, then composite with no zoom math.
   const labelsForExport = (investigationRef.current?.traces ?? [])
     .filter((t) => t.visible)
     .flatMap((t) => (t.labels ?? []).map((label) => ({ traceId: t.id, label })));

   if (labelsForExport.length > 0) {
     const { renderExportLabelOverlay } = await import('@/lib/exportLabelOverlay');
     const { EXPORT_PADDING } = await import('@/lib/labelGeometry');
     const bb = cy.elements().boundingBox();
     const overlay = renderExportLabelOverlay(cy, labelsForExport, bb, EXPORT_PADDING);
     try {
       // Match cy.png's effective scale: cy multiplies by getPixelRatio() when
       // maxWidth/maxHeight is unset (cytoscape.cjs.js:34744-34748). Pass the
       // same effective scale to html2canvas so both layers are at the same
       // resolution.
       const dpr = window.devicePixelRatio ?? 1;
       const effectiveScale = 2 * dpr;

       const overlayCanvas = await html2canvas(overlay.overlayEl, {
         backgroundColor: null,
         scale: effectiveScale,
         logging: false,
         useCORS: true,
       });

       const baseImg = new Image();
       await new Promise<void>((resolve, reject) => {
         baseImg.onload = () => resolve();
         baseImg.onerror = () => reject(new Error('Failed to load base PNG'));
         baseImg.src = dataUrl;
       });

       // Convert the base Image back into a canvas so composeExport can draw it.
       const baseCanvas = document.createElement('canvas');
       baseCanvas.width = baseImg.width;
       baseCanvas.height = baseImg.height;
       baseCanvas.getContext('2d')!.drawImage(baseImg, 0, 0);

       const composite = composeExport(baseCanvas, overlayCanvas, EXPORT_PADDING, effectiveScale);
       dataUrl = composite.toDataURL('image/png');
     } finally {
       overlay.dispose();
     }
   }
   ```

3. Search the file for `overlayHandleRef` / `getOverlayElement`. After Task 4, the only consumer of `overlayHandleRef` is the deleted composite block. Remove the declaration in `useCytoscape.ts` and the corresponding `getOverlayElement` from `OverlayHandle` in `useCytoscapeOverlays.ts`. If grep shows any other consumer, leave it.

**Step 3: Type-check + run all tests**

```bash
npx tsc --noEmit -p frontend/tsconfig.json
npm test --prefix frontend
```

Expected: clean. The `composeExport` tests pass, the existing tests still pass.

**Step 4: Stop. Do not commit.** Run `git status`.

---

## Task 5: Manual smoke verification (both export paths, both formats)

**Files:** None — verification only.

**Step 1: Start the stack**

```bash
npm run db   # background
npm run be   # background
npm run fe   # foreground
```

**Step 2: Verify the in-view PNG export path**

1. Open `http://localhost:3001` and load a case with annotation labels (the APENFT investigation with the "Foundation Cluster" label is a good fixture).
2. Pan and zoom to a non-fit position (e.g., zoom in to 1.5×, pan off-center).
3. Click Export → PNG. Open the downloaded file.
4. **Expected:** every annotation label sits at the same logical position relative to its anchor (edge midpoint / node corner / free position) as in the live view at fit-zoom. The "Foundation Cluster" label is flush with the orange parent box, not drifting off to the side.

**Step 3: Verify the in-view PDF export path**

1. Same view as Step 2. Click Export → PDF.
2. Open the PDF in Preview.
3. **Expected:** labels match the live view; orientation is sane (the new PNG aspect = `(bb.w + 100) / (bb.h + 100)`; if the PDF defaults misbehave, flag for follow-up).

**Step 4: Verify the exhibit-builder snapshot path**

1. Open the Productions / Exhibit Builder modal.
2. Add the same investigation as an exhibit.
3. Export.
4. Open the resulting file.
5. **Expected:** labels match the live view even though this path uses `useGraphSnapshot.ts` which mounts a fresh `GraphCanvas` at 1400×900 off-screen with no `cy.fit()` settle.

**Step 5: Edge cases to spot-check**

- **Zero annotation labels:** export skips the overlay path; verify PNG is produced normally.
- **Label anchored inside a hidden trace:** the trace filter (`t.visible`) drops it; verify it doesn't appear in the export.
- **Label anchored to a `txEdge` whose underlying edge is bundled:** label appears at the bundled edge midpoint (via `getEdgeByTxHash`).
- **Retina vs non-retina:** if you have a non-retina monitor handy or can force `devicePixelRatio` via DevTools sensors, verify exports on both. The label positions should be identical; only resolution differs.

**Step 6: If anything still drifts**

Capture two screenshots: the live view at fit-zoom, and the export. Note which labels drift and by how much in pixels. The most likely remaining causes:
- html2canvas font metric differences (markdown rendering) — flag as a follow-up; not a positioning bug.
- `cy.png` adding internal padding we missed — re-read `cytoscape.cjs.js:34740-34800` and compare against the assumption that `cy.png({ full: true })` has zero internal padding (already verified for current cytoscape version).

**Step 7: Stop. Do not commit.** Run `git status`. Hand the working tree to the user.

---

## Task 6: Final cleanup pass

**Files:**
- `frontend/src/hooks/useCytoscape.ts` — remove any residual dead code (`overlayHandleRef` if unused).
- `frontend/src/hooks/useCytoscapeOverlays.ts` — if `getOverlayElement` has no remaining consumers, remove from `OverlayHandle`.

**Step 1: Find dead code**

```bash
grep -rn "getOverlayElement\|overlayHandleRef" /Users/Sam/Work/Incite/dev/daubert/frontend/src
```

If only-producers are in `useCytoscapeOverlays.ts` and `useCytoscape.ts`, delete both ends.

**Step 2: Final type-check + tests**

```bash
npx tsc --noEmit -p frontend/tsconfig.json
npm test --prefix frontend
```

Expected: clean.

**Step 3: Stop. Do not commit.** Run `git status`. Hand the working tree back to the user for final review.
