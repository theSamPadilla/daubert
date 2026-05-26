# Graph Annotation Labels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users and the agent place freeform markdown labels on the investigation graph. Labels can float freely, tether to nodes, or tether to edges. They render as HTML overlays above the Cytoscape canvas, are draggable, persist on the trace, and survive PNG/PDF export.

**Architecture:** Labels live in a new `labels: TraceLabel[]` array on each `Trace`, parallel to `nodes`/`edges`/`groups`. They are **not** Cytoscape elements — they are HTML `<div>`s rendered by an extension to `useCytoscapeOverlays`, positioned each `render` frame using model→rendered projection. Three anchor modes are encoded in the same shape:

- **Free-floating:** `{ x, y }` in **model** coordinates.
- **Node-tethered:** `{ anchorType: 'node', anchorId, dx, dy }` — offset in model coords from the anchor's center.
- **Edge-tethered:** `{ anchorType: 'edge', anchorId, t, perpOffset }` — `t` in `[0, 1]` along the edge from source to target; `perpOffset` perpendicular distance (model coords) from the edge line. Survives endpoint movement.

Text is markdown, rendered with `react-markdown` + `rehype-sanitize`. Edit UX is a small floating popover (textarea + live preview) that opens on double-click. Drag-to-move uses the same model→rendered pattern as the existing resize handle in `useCytoscapeOverlays.ts:131-163`. Selection is single-mode across labels and Cytoscape elements: selecting a label clears the Cytoscape selection and vice versa.

The agent gets five dedicated tools: `add_label`, `update_label`, `delete_label`, `move_label`, `tether_label`. Each maps to a server-side action that loads the trace, mutates `data.labels`, and saves — same persistence path as node/edge edits.

PNG export: labels are injected as transparent Cytoscape nodes at their resolved rendered positions just before `cy.png()` and removed after, mirroring the address-sublabel folding trick in `useCytoscape.ts:169-202`. Markdown styling is reduced to plain text in the PNG (browser view keeps full markdown).

**Tech Stack:** NestJS, TypeORM, Postgres (JSONB), Next.js 14, React, Cytoscape.js, `react-markdown`, `rehype-sanitize`.

---

## Atomized Changes

| #  | File | Action | Purpose |
|----|------|--------|---------|
| 1  | `backend/src/modules/traces/label-schema.ts` | Create | `TraceLabel` type, `validateLabels()`, `normalizeLabels()` — single source of truth for label shape + validation |
| 2  | `backend/src/modules/traces/traces.service.ts` | Modify | Validate `data.labels` on create/update; reject malformed shapes early |
| 3  | `backend/src/modules/traces/traces.service.spec.ts` | Modify | TDD coverage for label validation paths |
| 4  | `backend/src/modules/ai/tools/label-tools.ts` | Create | Five new tool definitions: `add_label`, `update_label`, `delete_label`, `move_label`, `tether_label` |
| 5  | `backend/src/modules/ai/tools/index.ts` | Modify | Register label tools in `AGENT_TOOLS` |
| 6  | `backend/src/modules/ai/ai.service.ts` | Modify | Tool-call dispatcher: route label tool calls into trace updates |
| 7  | `backend/src/modules/ai/ai.service.spec.ts` (or sibling) | Modify | Tool-call routing tests for the five new tools |
| 8  | `frontend/src/types/investigation.ts` | Modify | Add `TraceLabel` union type; add `labels?: TraceLabel[]` to `Trace` |
| 9  | `frontend/src/lib/labelGeometry.ts` | Create | Pure functions: resolve node-tether and edge-tether to rendered coords; resolve drag delta back to model-space offset |
| 10 | `frontend/src/hooks/useInvestigation.ts` | Modify | New reducer actions: `ADD_LABEL`, `UPDATE_LABEL`, `DELETE_LABEL`, `MOVE_LABEL`, `TETHER_LABEL` — all flow through existing trace-save pipeline |
| 11 | `frontend/src/hooks/useCytoscapeOverlays.ts` | Modify | Fourth overlay pass: render label divs, drag handler, double-click → edit |
| 12 | `frontend/src/components/Graph/LabelOverlay.tsx` | Create | Per-label React component: markdown render, drag affordance, selection ring, edit button |
| 13 | `frontend/src/components/Graph/LabelEditPopover.tsx` | Create | Floating popover with `<textarea>` (markdown source) + live preview; Esc cancels, click-outside saves |
| 14 | `frontend/src/components/Graph/GraphCanvas.tsx` | Modify | "Add label" entry point (toolbar pill + double-click-background + context menu); wire reducer callbacks |
| 15 | `frontend/src/components/Graph/ContextMenu.tsx` | Modify | Add "Add label here" (background), "Attach label to this node/edge" (element-targeted) |
| 16 | `frontend/src/hooks/useCytoscape.ts` | Modify | PNG-export: rasterize overlay div via `html2canvas`, composite onto Cytoscape PNG so labels render with full markdown fidelity |
| 17 | `frontend/src/app/cases/[caseId]/investigations/page.tsx` | Modify | Include `labels` in the auto-save `traceData` payload (line 410-418) — without this, label edits dispatch locally but never persist |
| 18 | `frontend/package.json` | Modify | Add `react-markdown@^9`, `rehype-sanitize@^6`, `html2canvas@^1.4` |
| 19 | `backend/src/modules/ai/ai.module.ts` | Modify | Import `TracesModule` so `AiService` can inject `TracesService` for label tool calls |
| 20 | `docs/plans/2026-05-26-graph-annotation-labels.md` | Create | This file |

### What changes (UX and DX)

**For the user (UX):**
- The graph gains freeform annotation. A toolbar button or double-click on empty canvas drops a label at that location. Right-clicking a node/edge offers "Attach label here".
- Labels are draggable. Tethered labels follow their anchor — drag a wallet node, its labels move with it; bend an edge, its midpoint label slides.
- Double-click any label to edit its markdown in a small popover with live preview. **/Markdown**, `[links](url)`, line breaks, and inline code work out of the box.
- Labels are shared with all case members (owner + guests) since they live on the trace. Anyone who can edit the trace can edit the labels.
- Labels appear in PNG/PDF exhibit exports as plain text (styling stripped) at the same on-screen position.

**For the agent / DX:**
- Five new tools the agent can call: `add_label({ traceId, text, position | anchor })`, `update_label`, `delete_label`, `move_label`, `tether_label`. Each is atomic and token-cheap.
- The agent can annotate findings in real time during an investigation ("flag this address as OFAC SDN", "mark this hop as the mixer entry"). Labels are first-class evidence that travel with the trace into exhibits.
- A new `TraceLabel` type is exported once from the contracts/schema layer and mirrored on the frontend — no schema drift.

### Architectural call-outs (read before implementing)

1. **Label coords are model-space, not rendered-space.** Every persisted position must be in Cytoscape's model coordinate system so that pan/zoom doesn't invalidate persistence. The overlay layer projects to rendered coords every frame via `node.renderedPosition()` for tethered labels, or via `cy.pan()` + `cy.zoom()` math for free-floating ones. The geometry helpers in `frontend/src/lib/labelGeometry.ts` are the single source of truth for this projection.
2. **Edge tethering uses `(t, perpOffset)`, not raw `(dx, dy)`.** If an edge endpoint moves, a `(dx, dy)` offset from the midpoint goes wrong direction. Storing parameterized position (`t` along the line, `perpOffset` perpendicular) keeps the label visually attached to the same logical part of the edge. The math: `point = source + t * (target - source) + perpOffset * perpendicular_unit_vector`.
3. **One selection model across both layers.** Today Cytoscape owns selection via `.cy-sel` class (see `useCytoscape.ts:102-114`). Labels add a second clickable surface — they must clear Cytoscape selection on click, and Cytoscape clicks must clear label selection. Implement in `bindCytoscapeEvents` + the label drag handler.
4. **PNG export sees only the canvas.** `cy.png()` does not capture HTML overlays — that's why date pills and address sublabels are temporarily folded into Cytoscape labels during export (`useCytoscape.ts:169-202`). Labels follow the same pattern but with one twist: free-floating labels have no host element to fold into, so we create temporary `type: 'label-export'` nodes at the resolved rendered position, render them with `background-opacity: 0` and the plain text of the label, capture, then remove. Reuse the existing batch/restore pattern.
5. **Markdown rendering must be sanitized.** Labels are shared (any case member can author them); we cannot render arbitrary HTML. Use `rehype-sanitize` with the default schema. No `dangerouslySetInnerHTML` anywhere in this PR.
6. **Validation runs on the backend.** Don't trust the frontend. `validateLabels()` in `label-schema.ts` rejects malformed shapes (missing required fields, anchor type that doesn't match anchor fields, text longer than the limit). The trace service calls it on every save.
7. **No new endpoint.** Labels persist via the existing `PATCH /traces/:id` route. The agent's label tools also flow through this route — no parallel persistence path. Means we get case-access enforcement, audit logging, and multi-user save-then-refetch behavior for free.
8. **Multi-user concurrency is last-write-wins, as today.** This plan does not introduce locking or operational transforms for labels. Two simultaneous label edits on the same trace will have the last save win. Matches existing trace-edit behavior; do not regress it.
9. **No new database migration.** `data` is opaque JSONB; the entity is unchanged. Existing traces will deserialize with `labels === undefined`, which the frontend treats as the empty list.
10. **No git commits in this plan.** Per project CLAUDE.md, leave changes in the working tree. Each task ends with `git status` for visibility.
11. **The save pipeline is in `investigations/page.tsx`, not `useInvestigation.ts`.** `useInvestigation` is a pure reducer with no network calls. Persistence happens in the debounced `useEffect` at `frontend/src/app/cases/[caseId]/investigations/page.tsx:402-432`, which builds `traceData` with an explicit field list (`criteria, nodes, edges, groups, edgeBundles, position, hideTitle`). Adding `labels?` to the `Trace` type is necessary but not sufficient — the save payload must be extended too. **If you skip the page.tsx edit, labels will appear locally on every dispatch and disappear on every page refresh.** Task 9 covers both.
12. **`AiService` dispatcher shape is `executeTool(toolUse, caseId?, investigationId?)` (line 565).** It is a `switch` over `toolUse.name`, returns `{ error: '...' }` strings for tool failures (does not throw — keeps tool calls non-fatal to the conversation), and uses a `{ kind: 'script', caseId }` principal when calling other services (see how `productionsService.update` is called at line 674). Label tools must follow this exact pattern: inject `TracesService` (requires `TracesModule` import in `ai.module.ts`), use the script principal, and never throw. Task 5 implementation matches this.
13. **React markdown re-render must be text-change gated.** `useCytoscapeOverlays`'s `render` event fires on every pan/zoom/mouseover — dozens of times per second. Calling `root.render(<LabelOverlay text={...} />)` every time will burn CPU rendering identical markdown. Track the last-rendered text per label id; only re-render the React subtree when text changes. Position changes mutate `wrapper.style.left/top` directly without touching React.
14. **Labels must reach the overlay hook through a ref, not a prop.** `useCytoscapeOverlays` already uses the ref-mirror pattern for callbacks (see how `callbacksRef` is used in `useCytoscape.ts:46-55`). The labels array changes identity on every reducer dispatch — passing it as a hook dependency would tear down and re-create the overlay layer mid-drag. Mirror it into `latestLabelsRef.current = labels` outside the effect deps. Same pattern for `selectedLabelId`.
15. **Edge id stability is a known limitation.** Bundling/aggregation regenerates edge UUIDs (see `useInvestigation.ts:92` and the bundle reducer paths). A label tethered to an edge whose id changes will resolve to `null` and be hidden (Task 7 returns `null` from `resolveLabelRenderedPosition` cleanly; Task 10 hides on null). For transaction edges, the `txHash` field on `TransactionEdge` is stable across aggregation — Phase 2 may switch the tether to use `txHash` for `kind === 'transaction'` edges. For Phase 1: document this in the tool description so the agent knows not to tether labels to bundled edges. Test coverage in Task 7 must include the missing-anchor case.
16. **Selection coordination requires explicit cross-clears.** `useCytoscape.ts:102-114` and `cytoscapeEvents.ts`'s `onTapBackground` already clear Cytoscape selection on background tap. But: label divs have `pointer-events:auto` and stop event propagation (otherwise Cytoscape would intercept their clicks). That means clicks on labels never reach Cytoscape and Cytoscape's `.cy-sel` stays painted unless we explicitly clear it. The label click handler must call `unselectAll()` from `useCytoscape`, and the existing `onSelectionChange` callback in `GraphCanvas` must clear `setSelectedLabelId(null)` whenever a non-null Cytoscape selection arrives. Both directions, no race conditions, integration-tested.

### Out of scope (Phase 2)

- Label-to-label edges or grouping.
- Per-label color/border/font styling beyond what markdown gives (bold, italic, links, inline code). Visual style is uniform: white text, dark translucent background, single accent color on the border.
- Drag-to-resize labels. Width is content-driven (`max-width` cap); no manual resize handle in v1.
- Author attribution per label (Phase 2 could add `createdBy` + edit-restriction-to-author option).
- Versioning / undo for label-only changes (relies on the trace's existing undo if any).
- Label inclusion in CSV/JSON exports of trace data — out of scope; PNG/PDF only.
- Z-order between overlapping labels. v1: insertion order = z-order.

---

## Task 0: Pre-flight — confirm rules and read existing patterns

**Files (read-only):**
- `/Users/Sam/Work/Incite/dev/daubert/CLAUDE.md`
- `/Users/Sam/Work/Incite/dev/daubert/frontend/src/hooks/useCytoscapeOverlays.ts`
- `/Users/Sam/Work/Incite/dev/daubert/frontend/src/hooks/useCytoscape.ts:152-242` (PNG export path)
- `/Users/Sam/Work/Incite/dev/daubert/backend/src/modules/traces/traces.service.ts`
- `/Users/Sam/Work/Incite/dev/daubert/backend/src/modules/ai/tools/tool-definitions.ts`
- `/Users/Sam/Work/Incite/dev/daubert/backend/src/modules/ai/tools/index.ts`

**Step 1:** Confirm no-commit + no-migration rules. This plan creates no migration (trace `data` is JSONB) and no commits.

**Step 2:** Confirm the overlay pattern. `useCytoscapeOverlays` appends a `position:absolute; pointer-events:none` div, then on every Cytoscape `render` event repositions child elements using `renderedPosition()`. Three existing passes: node sublabels, edge sublabels, resize handle. Labels add a fourth.

**Step 3:** Confirm the PNG export folding pattern. `useCytoscape.ts:169-202` runs in a `cy.batch()`, saves originals, mutates labels/styles, captures, then restores in a `try/finally`. Labels follow the same shape but use temporary injected nodes for the free-floating case.

---

## Task 1: Backend — create `label-schema.ts` (shared types + validation)

**Files:**
- Create: `backend/src/modules/traces/label-schema.ts`
- Create: `backend/src/modules/traces/label-schema.spec.ts`

**Step 1: Failing tests.**

```ts
// backend/src/modules/traces/label-schema.spec.ts
import { validateLabels, normalizeLabels, MAX_LABEL_TEXT_LENGTH } from './label-schema';

describe('label-schema', () => {
  describe('validateLabels', () => {
    it('accepts a valid free-floating label', () => {
      expect(() =>
        validateLabels([{ id: 'l1', text: 'hello', anchor: { type: 'free', x: 100, y: 50 } }]),
      ).not.toThrow();
    });

    it('accepts a valid node-tethered label', () => {
      expect(() =>
        validateLabels([{ id: 'l1', text: 'x', anchor: { type: 'node', anchorId: 'n1', dx: 10, dy: -20 } }]),
      ).not.toThrow();
    });

    it('accepts a valid edge-tethered label', () => {
      expect(() =>
        validateLabels([{ id: 'l1', text: 'x', anchor: { type: 'edge', anchorId: 'e1', t: 0.5, perpOffset: 8 } }]),
      ).not.toThrow();
    });

    it('rejects missing id', () => {
      expect(() => validateLabels([{ text: 'x', anchor: { type: 'free', x: 0, y: 0 } } as any])).toThrow(/id/);
    });

    it('rejects non-string text', () => {
      expect(() => validateLabels([{ id: 'l1', text: 123 as any, anchor: { type: 'free', x: 0, y: 0 } }])).toThrow(/text/);
    });

    it('rejects text longer than MAX_LABEL_TEXT_LENGTH', () => {
      const long = 'x'.repeat(MAX_LABEL_TEXT_LENGTH + 1);
      expect(() => validateLabels([{ id: 'l1', text: long, anchor: { type: 'free', x: 0, y: 0 } }])).toThrow(/length/);
    });

    it('rejects mismatched anchor shape (node anchor missing anchorId)', () => {
      expect(() => validateLabels([{ id: 'l1', text: 'x', anchor: { type: 'node', dx: 0, dy: 0 } as any }])).toThrow(/anchorId/);
    });

    it('rejects edge anchor with t outside [0, 1]', () => {
      expect(() => validateLabels([{ id: 'l1', text: 'x', anchor: { type: 'edge', anchorId: 'e1', t: 1.5, perpOffset: 0 } }])).toThrow(/t.*0.*1/i);
    });

    it('rejects duplicate ids in the same array', () => {
      expect(() => validateLabels([
        { id: 'l1', text: 'a', anchor: { type: 'free', x: 0, y: 0 } },
        { id: 'l1', text: 'b', anchor: { type: 'free', x: 1, y: 1 } },
      ])).toThrow(/duplicate/i);
    });

    it('accepts an empty array', () => {
      expect(() => validateLabels([])).not.toThrow();
    });
  });

  describe('normalizeLabels', () => {
    it('returns empty array when input is undefined', () => {
      expect(normalizeLabels(undefined)).toEqual([]);
    });
    it('passes valid input through unchanged', () => {
      const labels = [{ id: 'l1', text: 'x', anchor: { type: 'free' as const, x: 0, y: 0 } }];
      expect(normalizeLabels(labels)).toEqual(labels);
    });
    it('strips unknown fields on each label', () => {
      const input = [{ id: 'l1', text: 'x', anchor: { type: 'free', x: 0, y: 0 }, evil: 'payload' } as any];
      expect(normalizeLabels(input)[0]).not.toHaveProperty('evil');
    });
  });
});
```

**Step 2:** `cd backend && npx jest label-schema.spec.ts` → expect FAIL (module not found).

**Step 3:** Implement.

```ts
// backend/src/modules/traces/label-schema.ts

export const MAX_LABEL_TEXT_LENGTH = 4000;

export type LabelAnchor =
  | { type: 'free'; x: number; y: number }
  | { type: 'node'; anchorId: string; dx: number; dy: number }
  | { type: 'edge'; anchorId: string; t: number; perpOffset: number };

export interface TraceLabel {
  id: string;
  text: string;
  anchor: LabelAnchor;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateAnchor(a: unknown, ctx: string): LabelAnchor {
  if (a === null || typeof a !== 'object') throw new Error(`${ctx}: anchor must be an object`);
  const r = a as Record<string, unknown>;
  switch (r.type) {
    case 'free':
      if (!isFiniteNumber(r.x) || !isFiniteNumber(r.y)) throw new Error(`${ctx}: free anchor requires finite x, y`);
      return { type: 'free', x: r.x, y: r.y };
    case 'node':
      if (typeof r.anchorId !== 'string' || !r.anchorId) throw new Error(`${ctx}: node anchor requires anchorId`);
      if (!isFiniteNumber(r.dx) || !isFiniteNumber(r.dy)) throw new Error(`${ctx}: node anchor requires finite dx, dy`);
      return { type: 'node', anchorId: r.anchorId, dx: r.dx, dy: r.dy };
    case 'edge':
      if (typeof r.anchorId !== 'string' || !r.anchorId) throw new Error(`${ctx}: edge anchor requires anchorId`);
      if (!isFiniteNumber(r.t) || r.t < 0 || r.t > 1) throw new Error(`${ctx}: edge anchor requires t in [0, 1]`);
      if (!isFiniteNumber(r.perpOffset)) throw new Error(`${ctx}: edge anchor requires finite perpOffset`);
      return { type: 'edge', anchorId: r.anchorId, t: r.t, perpOffset: r.perpOffset };
    default:
      throw new Error(`${ctx}: anchor.type must be "free" | "node" | "edge"`);
  }
}

export function validateLabels(input: unknown): TraceLabel[] {
  if (!Array.isArray(input)) throw new Error('labels must be an array');
  const out: TraceLabel[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    const ctx = `labels[${i}]`;
    if (raw === null || typeof raw !== 'object') throw new Error(`${ctx}: label must be an object`);
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id) throw new Error(`${ctx}: id must be a non-empty string`);
    if (seen.has(r.id)) throw new Error(`${ctx}: duplicate label id "${r.id}"`);
    seen.add(r.id);
    if (typeof r.text !== 'string') throw new Error(`${ctx}: text must be a string`);
    if (r.text.length > MAX_LABEL_TEXT_LENGTH) throw new Error(`${ctx}: text length ${r.text.length} exceeds max ${MAX_LABEL_TEXT_LENGTH}`);
    const anchor = validateAnchor(r.anchor, ctx);
    out.push({ id: r.id, text: r.text, anchor });
  });
  return out;
}

export function normalizeLabels(input: unknown): TraceLabel[] {
  if (input === undefined || input === null) return [];
  return validateLabels(input);
}
```

**Step 4:** `npx jest label-schema.spec.ts` → expect 13 PASS.

**Step 5:** `git status`.

---

## Task 2: Backend — wire label validation into `traces.service.ts`

**Files:**
- Modify: `backend/src/modules/traces/traces.service.ts`
- Modify: `backend/src/modules/traces/traces.service.spec.ts`

**Step 1: Failing tests** — add a `describe('label validation')` block to the service spec:

```ts
describe('label validation', () => {
  it('accepts a trace update with valid labels', async () => {
    const trace = await seedTrace();
    await expect(
      service.update(trace.id, { data: { ...trace.data, labels: [{ id: 'l1', text: 'x', anchor: { type: 'free', x: 0, y: 0 } }] } }, principal),
    ).resolves.toBeDefined();
  });

  it('rejects a trace update with malformed labels', async () => {
    const trace = await seedTrace();
    await expect(
      service.update(trace.id, { data: { ...trace.data, labels: [{ text: 'oops' }] as any } }, principal),
    ).rejects.toThrow(/labels\[0\]/);
  });

  it('strips unknown fields on labels', async () => {
    const trace = await seedTrace();
    const out = await service.update(trace.id, { data: { ...trace.data, labels: [{ id: 'l1', text: 'x', anchor: { type: 'free', x: 0, y: 0 }, evil: 'x' } as any] } }, principal);
    expect((out.data as any).labels[0]).not.toHaveProperty('evil');
  });

  it('treats missing labels as empty', async () => {
    const trace = await seedTrace();
    const out = await service.update(trace.id, { data: { ...trace.data } }, principal);
    // labels is optional; if not present in the saved data, it's absent.
    expect((out.data as any).labels === undefined || Array.isArray((out.data as any).labels)).toBe(true);
  });
});
```

**Step 2:** `npx jest traces.service.spec.ts -t 'label validation'` → expect FAIL.

**Step 3: Implement.** In `traces.service.ts`, find every code path that writes `trace.data` (create + update). Before persisting:

```ts
import { normalizeLabels } from './label-schema';

// inside update/create, right before save:
if (data && 'labels' in data) {
  data = { ...data, labels: normalizeLabels((data as any).labels) };
}
```

Validation errors should map to `BadRequestException` for HTTP correctness. Wrap the `normalizeLabels` call:

```ts
try {
  data = { ...data, labels: normalizeLabels((data as any).labels) };
} catch (err) {
  throw new BadRequestException(`Invalid labels: ${(err as Error).message}`);
}
```

**Step 4:** `npx jest traces.service.spec.ts -t 'label validation'` → expect PASS.

**Step 5:** Run the whole service spec to confirm no regressions. `npx jest traces.service.spec.ts`.

**Step 6:** `git status`.

---

## Task 3: Backend — create `label-tools.ts` (agent tool definitions)

**Files:**
- Create: `backend/src/modules/ai/tools/label-tools.ts`

**Step 1: Define the five tool schemas.**

```ts
// backend/src/modules/ai/tools/label-tools.ts
import type { Tool } from '@anthropic-ai/sdk/resources/messages';

const ANCHOR_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      required: ['type', 'x', 'y'],
      properties: {
        type: { type: 'string', enum: ['free'] },
        x: { type: 'number', description: 'Model-space X coordinate' },
        y: { type: 'number', description: 'Model-space Y coordinate' },
      },
    },
    {
      type: 'object',
      required: ['type', 'anchorId', 'dx', 'dy'],
      properties: {
        type: { type: 'string', enum: ['node'] },
        anchorId: { type: 'string', description: 'Wallet node ID' },
        dx: { type: 'number', description: 'X offset from node center (model coords)' },
        dy: { type: 'number', description: 'Y offset from node center (model coords)' },
      },
    },
    {
      type: 'object',
      required: ['type', 'anchorId', 't', 'perpOffset'],
      properties: {
        type: { type: 'string', enum: ['edge'] },
        anchorId: { type: 'string', description: 'Transaction edge ID' },
        t: { type: 'number', minimum: 0, maximum: 1, description: 'Position along edge (0=source, 1=target)' },
        perpOffset: { type: 'number', description: 'Perpendicular offset from edge line (model coords, signed)' },
      },
    },
  ],
} as const;

export const ADD_LABEL_TOOL: Tool = {
  name: 'add_label',
  description: 'Add a freeform markdown label to a trace. Labels annotate the graph and can be free-floating, tethered to a wallet node, or tethered to a transaction edge. Returns the created label\'s id.',
  input_schema: {
    type: 'object',
    required: ['traceId', 'text', 'anchor'],
    properties: {
      traceId: { type: 'string', format: 'uuid' },
      text: { type: 'string', description: 'Markdown content. Max 4000 chars. Bold, links, code, line breaks supported.' },
      anchor: ANCHOR_SCHEMA as any,
    },
  },
};

export const UPDATE_LABEL_TOOL: Tool = {
  name: 'update_label',
  description: 'Update the markdown text of an existing label. Anchor and position are unchanged.',
  input_schema: {
    type: 'object',
    required: ['traceId', 'labelId', 'text'],
    properties: {
      traceId: { type: 'string', format: 'uuid' },
      labelId: { type: 'string' },
      text: { type: 'string', description: 'New markdown content. Max 4000 chars.' },
    },
  },
};

export const DELETE_LABEL_TOOL: Tool = {
  name: 'delete_label',
  description: 'Remove a label from a trace. Irreversible (no soft-delete).',
  input_schema: {
    type: 'object',
    required: ['traceId', 'labelId'],
    properties: {
      traceId: { type: 'string', format: 'uuid' },
      labelId: { type: 'string' },
    },
  },
};

export const MOVE_LABEL_TOOL: Tool = {
  name: 'move_label',
  description: 'Move a label to a new position. Preserves the anchor type (free / node / edge) — only updates the position fields appropriate to that anchor type.',
  input_schema: {
    type: 'object',
    required: ['traceId', 'labelId', 'position'],
    properties: {
      traceId: { type: 'string', format: 'uuid' },
      labelId: { type: 'string' },
      position: {
        type: 'object',
        description: 'For free anchors: { x, y }. For node anchors: { dx, dy }. For edge anchors: { t, perpOffset }.',
        additionalProperties: true,
      },
    },
  },
};

export const TETHER_LABEL_TOOL: Tool = {
  name: 'tether_label',
  description: 'Change a label\'s anchor type — re-tether to a different node/edge, or convert between free-floating and tethered. Useful when an annotation should follow a specific element instead of staying at fixed coords.',
  input_schema: {
    type: 'object',
    required: ['traceId', 'labelId', 'anchor'],
    properties: {
      traceId: { type: 'string', format: 'uuid' },
      labelId: { type: 'string' },
      anchor: ANCHOR_SCHEMA as any,
    },
  },
};

export const LABEL_TOOLS = [
  ADD_LABEL_TOOL,
  UPDATE_LABEL_TOOL,
  DELETE_LABEL_TOOL,
  MOVE_LABEL_TOOL,
  TETHER_LABEL_TOOL,
];
```

**Step 2:** TypeScript check. `cd backend && npx tsc --noEmit` → expect PASS.

**Step 3:** `git status`.

---

## Task 4: Backend — register label tools in `AGENT_TOOLS`

**Files:**
- Modify: `backend/src/modules/ai/tools/index.ts`

**Step 1:** Add the export + import + spread into the array.

```ts
export {
  // ...existing
  ADD_LABEL_TOOL,
  UPDATE_LABEL_TOOL,
  DELETE_LABEL_TOOL,
  MOVE_LABEL_TOOL,
  TETHER_LABEL_TOOL,
  LABEL_TOOLS,
} from './label-tools';

import { LABEL_TOOLS } from './label-tools';

export const AGENT_TOOLS = [
  // ...existing
  ...LABEL_TOOLS,
];
```

**Step 2:** TS check. `npx tsc --noEmit` → PASS.

**Step 3:** `git status`.

---

## Task 5: Backend — integrate label tools into `AiService.executeTool`

**Files:**
- Modify: `backend/src/modules/ai/ai.module.ts` — add `TracesModule` to imports
- Modify: `backend/src/modules/ai/ai.service.ts:260-275` — inject `TracesService`
- Modify: `backend/src/modules/ai/ai.service.ts:565` — extend `executeTool` switch with five new cases
- Modify: existing AI service test (locate via `ls backend/src/modules/ai/*.spec.ts`)

**Pattern facts (verified in source):**
- `executeTool` signature: `private async executeTool(toolUse: Anthropic.ToolUseBlock, caseId?: string, investigationId?: string): Promise<unknown>` — a `switch` over `toolUse.name`.
- Other services are called via `private readonly productionsService: ProductionsService` (constructor injection at line 265).
- Principal for agent-driven service calls: `{ kind: 'script', caseId }` (see line 674 — `productionsService.update(..., { kind: 'script', caseId })`).
- **Failures return `{ error: 'string' }` objects — they do NOT throw.** Throwing would crash the tool-call loop. See lines 619, 621, 654, 661.

**Step 1: Module wiring.** In `ai.module.ts`, add `TracesModule` to the `imports` array (alongside `ProductionsModule`, `LabeledEntitiesModule`, etc.). In `ai.service.ts` constructor, add `private readonly tracesService: TracesService` next to the existing `productionsService` injection.

**Step 2: Failing tests** — locate the existing dispatcher test pattern (the existing `productionsService` cases will show the shape). Add a `describe('label tool calls')` block. Tests must drive `executeTool` via a `ToolUseBlock` fixture, not a non-existent `handleToolCall`:

```ts
describe('executeTool — label cases', () => {
  // Helper: build the input fixture the way Anthropic delivers it.
  function toolUse(name: string, input: Record<string, unknown>): Anthropic.ToolUseBlock {
    return { type: 'tool_use', id: 'tu_test', name, input } as Anthropic.ToolUseBlock;
  }

  it('add_label: returns { id } and writes label to trace.data.labels', async () => {
    const trace = await seedTrace({ caseId });
    const result = await (aiService as any).executeTool(
      toolUse('add_label', { traceId: trace.id, text: 'OFAC SDN', anchor: { type: 'free', x: 100, y: 50 } }),
      caseId,
    );
    expect(result).toHaveProperty('id');
    const reloaded = await tracesService.findOne(trace.id, { kind: 'script', caseId });
    expect((reloaded.data as any).labels).toHaveLength(1);
    expect((reloaded.data as any).labels[0].text).toBe('OFAC SDN');
  });

  it('add_label without caseId: returns { error } (no throw)', async () => {
    const result = await (aiService as any).executeTool(
      toolUse('add_label', { traceId: 'irrelevant', text: 'x', anchor: { type: 'free', x: 0, y: 0 } }),
      undefined,
    );
    expect(result).toEqual({ error: expect.stringMatching(/case context/i) });
  });

  it('add_label with traceId in a different case: returns { error } (access enforced by TracesService)', async () => {
    const otherCase = await seedCase();
    const trace = await seedTrace({ caseId: otherCase.id });
    const result = await (aiService as any).executeTool(
      toolUse('add_label', { traceId: trace.id, text: 'x', anchor: { type: 'free', x: 0, y: 0 } }),
      caseId, // wrong case
    );
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it('update_label: rewrites text in place', async () => {
    const trace = await seedTraceWithLabel({ caseId, id: 'l1', text: 'old' });
    await (aiService as any).executeTool(
      toolUse('update_label', { traceId: trace.id, labelId: 'l1', text: 'new' }),
      caseId,
    );
    const reloaded = await tracesService.findOne(trace.id, { kind: 'script', caseId });
    expect((reloaded.data as any).labels[0].text).toBe('new');
  });

  it('update_label with unknown labelId: returns { error }', async () => {
    const trace = await seedTrace({ caseId });
    const result = await (aiService as any).executeTool(
      toolUse('update_label', { traceId: trace.id, labelId: 'nope', text: 'x' }),
      caseId,
    );
    expect(result).toMatchObject({ error: expect.stringMatching(/not found/i) });
  });

  it('delete_label: removes by id', async () => {
    const trace = await seedTraceWithLabel({ caseId, id: 'l1' });
    await (aiService as any).executeTool(toolUse('delete_label', { traceId: trace.id, labelId: 'l1' }), caseId);
    const reloaded = await tracesService.findOne(trace.id, { kind: 'script', caseId });
    expect((reloaded.data as any).labels).toEqual([]);
  });

  it('move_label (free anchor): updates x,y', async () => {
    const trace = await seedTraceWithLabel({ caseId, id: 'l1', anchor: { type: 'free', x: 0, y: 0 } });
    await (aiService as any).executeTool(
      toolUse('move_label', { traceId: trace.id, labelId: 'l1', position: { x: 100, y: 200 } }),
      caseId,
    );
    const reloaded = await tracesService.findOne(trace.id, { kind: 'script', caseId });
    expect((reloaded.data as any).labels[0].anchor).toEqual({ type: 'free', x: 100, y: 200 });
  });

  it('move_label with incompatible position fields: returns { error }', async () => {
    const trace = await seedTraceWithLabel({ caseId, id: 'l1', anchor: { type: 'free', x: 0, y: 0 } });
    const result = await (aiService as any).executeTool(
      toolUse('move_label', { traceId: trace.id, labelId: 'l1', position: { t: 0.5, perpOffset: 0 } }),
      caseId,
    );
    expect(result).toMatchObject({ error: expect.stringMatching(/free anchor/i) });
  });

  it('tether_label: converts free → node anchor', async () => {
    const trace = await seedTraceWithLabel({ caseId, id: 'l1', anchor: { type: 'free', x: 0, y: 0 } });
    await (aiService as any).executeTool(
      toolUse('tether_label', { traceId: trace.id, labelId: 'l1', anchor: { type: 'node', anchorId: 'n1', dx: 10, dy: 0 } }),
      caseId,
    );
    const reloaded = await tracesService.findOne(trace.id, { kind: 'script', caseId });
    expect((reloaded.data as any).labels[0].anchor).toMatchObject({ type: 'node', anchorId: 'n1' });
  });
});
```

**Step 3:** Run tests → expect 9 FAIL with `Unknown tool: add_label` (the dispatcher's default case).

**Step 4: Implement** — add five cases to the `executeTool` switch, mirroring the `productionsService` cases. Use the script principal `{ kind: 'script', caseId }`. Return `{ error: 'string' }` for failures; never throw.

```ts
case ADD_LABEL_TOOL.name: {
  if (!caseId) return { error: 'No case context. Ask the user to open a case.' };
  const input = toolUse.input as { traceId: string; text: string; anchor: LabelAnchor };
  if (!input.traceId) return { error: 'traceId is required' };
  const principal = { kind: 'script' as const, caseId };
  try {
    const trace = await this.tracesService.findOne(input.traceId, principal);
    const labels = Array.isArray((trace.data as any)?.labels) ? [...(trace.data as any).labels] : [];
    const id = randomUUID();
    labels.push({ id, text: input.text, anchor: input.anchor });
    await this.tracesService.update(input.traceId, { data: { ...(trace.data as any), labels } }, principal);
    return { id };
  } catch (e) { return { error: (e as Error).message }; }
}

case UPDATE_LABEL_TOOL.name: {
  if (!caseId) return { error: 'No case context. Ask the user to open a case.' };
  const input = toolUse.input as { traceId: string; labelId: string; text: string };
  const principal = { kind: 'script' as const, caseId };
  try {
    const trace = await this.tracesService.findOne(input.traceId, principal);
    const labels = Array.isArray((trace.data as any)?.labels) ? [...(trace.data as any).labels] : [];
    const idx = labels.findIndex((l: any) => l.id === input.labelId);
    if (idx < 0) return { error: `Label ${input.labelId} not found on trace ${input.traceId}` };
    labels[idx] = { ...labels[idx], text: input.text };
    await this.tracesService.update(input.traceId, { data: { ...(trace.data as any), labels } }, principal);
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

case DELETE_LABEL_TOOL.name: {
  if (!caseId) return { error: 'No case context. Ask the user to open a case.' };
  const input = toolUse.input as { traceId: string; labelId: string };
  const principal = { kind: 'script' as const, caseId };
  try {
    const trace = await this.tracesService.findOne(input.traceId, principal);
    const labels = Array.isArray((trace.data as any)?.labels) ? (trace.data as any).labels : [];
    const next = labels.filter((l: any) => l.id !== input.labelId);
    if (next.length === labels.length) return { error: `Label ${input.labelId} not found on trace ${input.traceId}` };
    await this.tracesService.update(input.traceId, { data: { ...(trace.data as any), labels: next } }, principal);
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

case MOVE_LABEL_TOOL.name: {
  if (!caseId) return { error: 'No case context. Ask the user to open a case.' };
  const input = toolUse.input as { traceId: string; labelId: string; position: Record<string, unknown> };
  const principal = { kind: 'script' as const, caseId };
  try {
    const trace = await this.tracesService.findOne(input.traceId, principal);
    const labels = Array.isArray((trace.data as any)?.labels) ? [...(trace.data as any).labels] : [];
    const idx = labels.findIndex((l: any) => l.id === input.labelId);
    if (idx < 0) return { error: `Label ${input.labelId} not found on trace ${input.traceId}` };
    const current = labels[idx];
    let nextAnchor: LabelAnchor;
    switch (current.anchor.type) {
      case 'free':
        if (typeof input.position.x !== 'number' || typeof input.position.y !== 'number') {
          return { error: 'move_label on a free anchor requires { x, y }' };
        }
        nextAnchor = { type: 'free', x: input.position.x, y: input.position.y };
        break;
      case 'node':
        if (typeof input.position.dx !== 'number' || typeof input.position.dy !== 'number') {
          return { error: 'move_label on a node anchor requires { dx, dy }' };
        }
        nextAnchor = { ...current.anchor, dx: input.position.dx, dy: input.position.dy };
        break;
      case 'edge':
        if (typeof input.position.t !== 'number' || typeof input.position.perpOffset !== 'number') {
          return { error: 'move_label on an edge anchor requires { t, perpOffset }' };
        }
        nextAnchor = { ...current.anchor, t: Math.max(0, Math.min(1, input.position.t)), perpOffset: input.position.perpOffset };
        break;
    }
    labels[idx] = { ...current, anchor: nextAnchor };
    await this.tracesService.update(input.traceId, { data: { ...(trace.data as any), labels } }, principal);
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}

case TETHER_LABEL_TOOL.name: {
  if (!caseId) return { error: 'No case context. Ask the user to open a case.' };
  const input = toolUse.input as { traceId: string; labelId: string; anchor: LabelAnchor };
  const principal = { kind: 'script' as const, caseId };
  try {
    const trace = await this.tracesService.findOne(input.traceId, principal);
    const labels = Array.isArray((trace.data as any)?.labels) ? [...(trace.data as any).labels] : [];
    const idx = labels.findIndex((l: any) => l.id === input.labelId);
    if (idx < 0) return { error: `Label ${input.labelId} not found on trace ${input.traceId}` };
    labels[idx] = { ...labels[idx], anchor: input.anchor };
    await this.tracesService.update(input.traceId, { data: { ...(trace.data as any), labels } }, principal);
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
}
```

**Step 5:** Run tests → expect 9 PASS.

**Step 6:** `git status`.

---

## Task 6: Frontend — extend `Trace` type with labels

**Files:**
- Modify: `frontend/src/types/investigation.ts`

**Step 1:** Add the types.

```ts
export type LabelAnchor =
  | { type: 'free'; x: number; y: number }
  | { type: 'node'; anchorId: string; dx: number; dy: number }
  | { type: 'edge'; anchorId: string; t: number; perpOffset: number };

export interface TraceLabel {
  id: string;
  text: string;
  anchor: LabelAnchor;
}
```

Add to `Trace`:

```ts
export interface Trace {
  // ...existing
  labels?: TraceLabel[];
}
```

**Step 2:** `cd frontend && npx tsc --noEmit` → expect PASS (no consumers yet, just type definition).

**Step 3:** `git status`.

---

## Task 7: Frontend — create `labelGeometry.ts` (pure geometry helpers)

**Files:**
- Create: `frontend/src/lib/labelGeometry.ts`
- Create: `frontend/src/lib/labelGeometry.test.ts`

**Step 1: Failing tests.**

```ts
import { resolveLabelRenderedPosition, modelDeltaFromRenderedDelta, projectPointOntoEdge } from './labelGeometry';

describe('labelGeometry', () => {
  describe('resolveLabelRenderedPosition', () => {
    it('resolves a free anchor by applying pan + zoom', () => {
      const out = resolveLabelRenderedPosition(
        { type: 'free', x: 100, y: 50 },
        { pan: { x: 10, y: 20 }, zoom: 2 } as any,
      );
      expect(out).toEqual({ x: 210, y: 120 }); // x_rendered = x_model * zoom + panX
    });

    it('resolves a node anchor relative to the node\'s rendered position', () => {
      const fakeNode = { renderedPosition: () => ({ x: 300, y: 200 }) } as any;
      const out = resolveLabelRenderedPosition(
        { type: 'node', anchorId: 'n1', dx: 20, dy: -10 },
        { zoom: 2, getNode: (_id: string) => fakeNode } as any,
      );
      // dx/dy are model-space; convert to rendered by * zoom
      expect(out).toEqual({ x: 340, y: 180 });
    });

    it('resolves an edge anchor using t and perpOffset', () => {
      const fakeEdge = {
        source: () => ({ renderedPosition: () => ({ x: 0, y: 0 }) }),
        target: () => ({ renderedPosition: () => ({ x: 100, y: 0 }) }),
      } as any;
      const out = resolveLabelRenderedPosition(
        { type: 'edge', anchorId: 'e1', t: 0.5, perpOffset: 10 },
        { zoom: 1, getEdge: (_id: string) => fakeEdge } as any,
      );
      // midpoint (50, 0), perpendicular is (0, ±1) for a horizontal line; perpOffset=10 along (0, -1) per convention
      expect(out).toEqual({ x: 50, y: -10 });
    });

    it('returns null when the tethered element is missing', () => {
      const out = resolveLabelRenderedPosition(
        { type: 'node', anchorId: 'gone', dx: 0, dy: 0 },
        { zoom: 1, getNode: () => null } as any,
      );
      expect(out).toBeNull();
    });
  });

  describe('modelDeltaFromRenderedDelta', () => {
    it('divides by zoom to convert rendered pixels back to model units', () => {
      expect(modelDeltaFromRenderedDelta({ dx: 40, dy: 20 }, 2)).toEqual({ dx: 20, dy: 10 });
    });
  });

  describe('projectPointOntoEdge', () => {
    it('returns t=0.5 for a point at the midpoint of a horizontal edge', () => {
      const out = projectPointOntoEdge({ x: 50, y: 5 }, { x: 0, y: 0 }, { x: 100, y: 0 });
      expect(out.t).toBeCloseTo(0.5);
      expect(out.perpOffset).toBeCloseTo(5);
    });
    it('clamps t to [0, 1]', () => {
      const out = projectPointOntoEdge({ x: -50, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 });
      expect(out.t).toBe(0);
    });
  });
});
```

**Step 2:** `cd frontend && npx jest labelGeometry` → expect FAIL.

**Step 3: Implement.**

```ts
// frontend/src/lib/labelGeometry.ts
import type { LabelAnchor } from '@/types/investigation';
import type { Core } from 'cytoscape';

export interface GeometryContext {
  zoom: number;
  pan?: { x: number; y: number };
  getNode?: (id: string) => { renderedPosition: () => { x: number; y: number } } | null;
  getEdge?: (id: string) => {
    source: () => { renderedPosition: () => { x: number; y: number } };
    target: () => { renderedPosition: () => { x: number; y: number } };
  } | null;
}

export function contextFromCy(cy: Core): GeometryContext {
  return {
    zoom: cy.zoom(),
    pan: cy.pan(),
    getNode: (id: string) => {
      const n = cy.getElementById(id);
      return n && n.length > 0 && n.isNode() ? n : null;
    },
    getEdge: (id: string) => {
      const e = cy.getElementById(id);
      return e && e.length > 0 && e.isEdge() ? e : null;
    },
  };
}

export function resolveLabelRenderedPosition(
  anchor: LabelAnchor,
  ctx: GeometryContext,
): { x: number; y: number } | null {
  switch (anchor.type) {
    case 'free': {
      const pan = ctx.pan ?? { x: 0, y: 0 };
      return { x: anchor.x * ctx.zoom + pan.x, y: anchor.y * ctx.zoom + pan.y };
    }
    case 'node': {
      const n = ctx.getNode?.(anchor.anchorId);
      if (!n) return null;
      const p = n.renderedPosition();
      return { x: p.x + anchor.dx * ctx.zoom, y: p.y + anchor.dy * ctx.zoom };
    }
    case 'edge': {
      const e = ctx.getEdge?.(anchor.anchorId);
      if (!e) return null;
      const s = e.source().renderedPosition();
      const t = e.target().renderedPosition();
      const mx = s.x + (t.x - s.x) * anchor.t;
      const my = s.y + (t.y - s.y) * anchor.t;
      // Perpendicular unit vector. Convention: rotate edge direction by -90deg
      // (so positive perpOffset is "above" the edge in screen space).
      const len = Math.hypot(t.x - s.x, t.y - s.y) || 1;
      const px = -(t.y - s.y) / len;
      const py = (t.x - s.x) / len;
      const off = anchor.perpOffset * ctx.zoom;
      return { x: mx + px * off, y: my + py * off };
    }
  }
}

export function modelDeltaFromRenderedDelta(
  delta: { dx: number; dy: number },
  zoom: number,
): { dx: number; dy: number } {
  return { dx: delta.dx / zoom, dy: delta.dy / zoom };
}

export function projectPointOntoEdge(
  p: { x: number; y: number },
  source: { x: number; y: number },
  target: { x: number; y: number },
): { t: number; perpOffset: number } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { t: 0, perpOffset: 0 };
  const tRaw = ((p.x - source.x) * dx + (p.y - source.y) * dy) / len2;
  const t = Math.max(0, Math.min(1, tRaw));
  const closestX = source.x + dx * t;
  const closestY = source.y + dy * t;
  // Signed perpendicular distance via 2D cross product (consistent with resolveLabelRenderedPosition's convention).
  const len = Math.sqrt(len2);
  const perpOffset = ((p.x - closestX) * dy - (p.y - closestY) * dx) / len;
  return { t, perpOffset };
}
```

**Step 4:** `npx jest labelGeometry` → expect PASS.

**Step 5:** `git status`.

---

## Task 8: Frontend — install `react-markdown`, `rehype-sanitize`, `html2canvas`

**Files:**
- Modify: `frontend/package.json`

**Step 1:** `cd frontend && npm install react-markdown@^9 rehype-sanitize@^6 html2canvas@^1.4`.

**Step 2:** Confirm all three appear in `dependencies` and `package-lock.json` updates.

**Step 3:** `git status`.

---

## Task 9: Frontend — reducer actions for labels + wire labels into the save payload

**Files:**
- Modify: `frontend/src/hooks/useInvestigation.ts`
- Modify: `frontend/src/app/cases/[caseId]/investigations/page.tsx:402-432` — **critical:** add `labels` to the auto-save `traceData` object
- Modify: existing reducer tests if present

**Step 0 — the trap:** `useInvestigation` is a pure reducer with no network calls. The save happens in the debounced `useEffect` at `app/cases/[caseId]/investigations/page.tsx:402-432`, which builds `traceData` with an explicit field list. If you add `labels` to the reducer but skip the page.tsx edit, every label dispatch will appear locally and vanish on refresh. **Do the page.tsx edit in Step 5 of this task before anything else can be smoke-tested.**

**Step 1: Identify the reducer pattern.** Read the existing actions (e.g. `UPDATE_NODE`, `ADD_EDGE`) and follow the same shape — action constants, payload typing, reducer case, exported callback. Note `SKIP_HISTORY` at `useInvestigation.ts:34` — fast-fire actions like `UPDATE_NODE_POSITION` are excluded from undo to avoid spamming the 50-entry history.

**Step 2: Add the five actions.**

```ts
type LabelAction =
  | { type: 'ADD_LABEL'; traceId: string; label: TraceLabel }
  | { type: 'UPDATE_LABEL'; traceId: string; labelId: string; text: string }
  | { type: 'DELETE_LABEL'; traceId: string; labelId: string }
  | { type: 'MOVE_LABEL'; traceId: string; labelId: string; anchor: LabelAnchor }
  | { type: 'TETHER_LABEL'; traceId: string; labelId: string; anchor: LabelAnchor };
```

Reducer cases mutate `trace.labels` for the matching trace:

```ts
case 'ADD_LABEL':
  return updateTrace(state, action.traceId, (t) => ({
    ...t,
    labels: [...(t.labels ?? []), action.label],
  }));

case 'UPDATE_LABEL':
  return updateTrace(state, action.traceId, (t) => ({
    ...t,
    labels: (t.labels ?? []).map((l) => (l.id === action.labelId ? { ...l, text: action.text } : l)),
  }));

case 'DELETE_LABEL':
  return updateTrace(state, action.traceId, (t) => ({
    ...t,
    labels: (t.labels ?? []).filter((l) => l.id !== action.labelId),
  }));

case 'MOVE_LABEL':
case 'TETHER_LABEL':
  return updateTrace(state, action.traceId, (t) => ({
    ...t,
    labels: (t.labels ?? []).map((l) => (l.id === action.labelId ? { ...l, anchor: action.anchor } : l)),
  }));
```

**Step 2b: Add `MOVE_LABEL` to `SKIP_HISTORY`** at `useInvestigation.ts:34`. Drag fires `MOVE_LABEL` on every `mousemove`, which would otherwise blow out the undo stack and starve `ADD_LABEL` / `UPDATE_LABEL` / `DELETE_LABEL` / `TETHER_LABEL` entries (which DO belong in history). Mirrors how `UPDATE_NODE_POSITION` is excluded today.

```ts
const SKIP_HISTORY = new Set<Action['type']>([
  'SET_INVESTIGATION', 'UPDATE_NODE_POSITION', 'UNDO', 'REDO',
  'MOVE_LABEL',
]);
```

**Step 3:** Expose callback wrappers. The reducer is pure; persistence flows through the existing debounced auto-save in `investigations/page.tsx`, which is triggered whenever the `investigation` object reference changes:

```ts
const addLabel = useCallback((traceId: string, label: TraceLabel) => {
  dispatch({ type: 'ADD_LABEL', traceId, label });
}, []);

const updateLabel = useCallback((traceId: string, labelId: string, text: string) => {
  dispatch({ type: 'UPDATE_LABEL', traceId, labelId, text });
}, []);

const deleteLabel = useCallback((traceId: string, labelId: string) => {
  dispatch({ type: 'DELETE_LABEL', traceId, labelId });
}, []);

const moveLabel = useCallback((traceId: string, labelId: string, anchor: LabelAnchor) => {
  dispatch({ type: 'MOVE_LABEL', traceId, labelId, anchor });
}, []);

const tetherLabel = useCallback((traceId: string, labelId: string, anchor: LabelAnchor) => {
  dispatch({ type: 'TETHER_LABEL', traceId, labelId, anchor });
}, []);
```

Return them from the hook alongside the existing callbacks.

**Step 4:** TS check. `npx tsc --noEmit` → PASS.

**Step 5 — CRITICAL: extend the auto-save payload.** Open `frontend/src/app/cases/[caseId]/investigations/page.tsx` and find the `traceData` object at lines 410-418. Add `labels`:

```ts
const traceData = {
  criteria: trace.criteria,
  nodes: trace.nodes,
  edges: trace.edges,
  groups: trace.groups || [],
  edgeBundles: trace.edgeBundles || [],
  position: trace.position,
  hideTitle: trace.hideTitle ?? false,
  labels: trace.labels || [],   // ← ADD THIS LINE
};
```

Without this, every label reducer dispatch will mutate local state but never persist. The auto-save useEffect already re-runs on `investigation` reference changes (line 432 dependency), so the labels will ride out on the next debounce tick.

**Step 6:** Smoke check end-to-end persistence: in dev, dispatch an `ADD_LABEL`, wait 2 seconds, refresh — the label must still be there. (Quick browser console: `await fetch('/api/traces/<id>').then(r => r.json()).then(t => t.data.labels)` should show it.)

**Step 7:** `git status`.

---

## Task 10: Frontend — render labels in `useCytoscapeOverlays`

**Files:**
- Modify: `frontend/src/hooks/useCytoscapeOverlays.ts`

**Step 1: Expand the hook signature with ref-friendly props.** The labels array changes identity on every reducer dispatch. Passing it as a hook dependency would tear down and recreate the overlay layer mid-drag. Use the same pattern as the existing `callbacksRef` in `useCytoscape.ts:46-55`: accept the props, mirror them into refs outside the effect, and read from refs inside event handlers.

```ts
export function useCytoscapeOverlays(
  cy: Core | null,
  container: HTMLDivElement | null,
  onResizeNode: OnResizeNode,
  labels: { traceId: string; label: TraceLabel }[],
  onLabelMove: (traceId: string, labelId: string, anchor: LabelAnchor) => void,
  onLabelEdit: (traceId: string, labelId: string) => void,
  onLabelSelect: (labelId: string | null) => void,
  selectedLabelId: string | null,
  unselectAllCytoscape: () => void,   // ← passed from useCytoscape so label-click can clear cy selection
) {
  // Mirror into refs so the main effect's dep array stays minimal.
  const labelsRef = useRef(labels);
  const selectedLabelIdRef = useRef(selectedLabelId);
  const onLabelMoveRef = useRef(onLabelMove);
  const onLabelEditRef = useRef(onLabelEdit);
  const onLabelSelectRef = useRef(onLabelSelect);
  const unselectAllRef = useRef(unselectAllCytoscape);
  labelsRef.current = labels;
  selectedLabelIdRef.current = selectedLabelId;
  onLabelMoveRef.current = onLabelMove;
  onLabelEditRef.current = onLabelEdit;
  onLabelSelectRef.current = onLabelSelect;
  unselectAllRef.current = unselectAllCytoscape;
  // ...main effect with deps [cy, container, onResizeNode] only.
}
```

(Or — if the prop list is getting unwieldy — pass a single `labelControls` object. Match the surrounding style.)

**Step 2: Add a fourth overlay pass** for labels. Track last-rendered text per id so React re-renders are gated on actual text changes — Cytoscape fires `render` on every pan/zoom/mouseover (potentially dozens of times per second), but the markdown content rarely changes. Position updates must NOT touch React; only `wrapper.style.left/top`.

```ts
interface LabelEntry {
  wrapper: HTMLDivElement;
  markdownContainer: HTMLDivElement;  // child div the React root owns; wrapper stays under direct DOM control for drag
  cleanup: () => void;
  lastRenderedText: string;
}
const labelEls = new Map<string, LabelEntry>();

const updateLabels = () => {
  const activeIds = new Set<string>();
  const ctx = contextFromCy(cy);
  for (const { traceId, label } of labelsRef.current) {
    activeIds.add(label.id);
    const pos = resolveLabelRenderedPosition(label.anchor, ctx);
    if (!pos) {
      // Anchor element is gone (e.g. tethered to a bundled edge that just got aggregated).
      const existing = labelEls.get(label.id);
      if (existing) existing.wrapper.style.display = 'none';
      continue;
    }
    let entry = labelEls.get(label.id);
    if (!entry) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText =
        'position:absolute;transform:translate(-50%, -50%);pointer-events:auto;max-width:240px;' +
        'background:rgba(17,24,39,0.92);color:#f3f4f6;border:1px solid #374151;border-radius:6px;' +
        'padding:6px 8px;font-size:11px;line-height:1.35;cursor:move;user-select:none;' +
        'box-shadow:0 2px 8px rgba(0,0,0,0.4);z-index:5;';
      const markdownContainer = document.createElement('div');
      wrapper.appendChild(markdownContainer);
      overlayEl.appendChild(wrapper);

      const root = ReactDOM.createRoot(markdownContainer);
      const cleanup = () => { root.unmount(); wrapper.remove(); };
      const newEntry: LabelEntry = { wrapper, markdownContainer, cleanup, lastRenderedText: '\0' };
      labelEls.set(label.id, newEntry);
      entry = newEntry;

      attachLabelInteractions(wrapper, label.id, traceId);
    }
    // Position updates: direct DOM, no React.
    entry.wrapper.style.left = `${pos.x}px`;
    entry.wrapper.style.top = `${pos.y}px`;
    entry.wrapper.style.display = '';
    entry.wrapper.classList.toggle('label-selected', selectedLabelIdRef.current === label.id);
    // Markdown re-render: gated on text change. The `render` event fires on every pan/zoom;
    // re-rendering the React tree every time would burn CPU for no visible change.
    if (entry.lastRenderedText !== label.text) {
      renderLabelMarkdownInto(entry.markdownContainer, label.text);
      entry.lastRenderedText = label.text;
    }
  }
  // Tear down labels that no longer exist (must unmount the React root, not just remove the wrapper).
  labelEls.forEach((entry, id) => {
    if (!activeIds.has(id)) {
      entry.cleanup();
      labelEls.delete(id);
    }
  });
};
```

`attachLabelInteractions(wrapper, labelId, traceId)` is the drag + double-click handler. Mirrors the `onMouseDown` pattern at lines 131-163 for the resize handle:

```ts
function attachLabelInteractions(wrapper: HTMLDivElement, labelId: string, traceId: string) {
  let dragStart: { x: number; y: number } | null = null;
  let didDrag = false;

  wrapper.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    dragStart = { x: e.clientX, y: e.clientY };
    didDrag = false;
    const onMove = (ev: MouseEvent) => {
      if (!dragStart) return;
      const dxRendered = ev.clientX - dragStart.x;
      const dyRendered = ev.clientY - dragStart.y;
      if (Math.hypot(dxRendered, dyRendered) > 3) didDrag = true;
      if (!didDrag) return;
      // Recompute the label's anchor based on the drag.
      const label = findLabel(labelId);
      if (!label) return;
      const nextAnchor = computeDraggedAnchor(label.anchor, dxRendered, dyRendered, cy);
      onLabelMoveRef.current(traceId, labelId, nextAnchor);
      dragStart = { x: ev.clientX, y: ev.clientY };
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!didDrag) {
        // Click (not drag) = select this label. Also clear Cytoscape's selection so the
        // DetailsPanel and .cy-sel painted state don't show a stale wallet/edge selection.
        onLabelSelectRef.current(labelId);
        unselectAllRef.current();
      }
      dragStart = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  wrapper.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    onLabelEditRef.current(traceId, labelId);
  });
}
```

`computeDraggedAnchor` reads the current anchor type and applies the rendered delta in the right way:

- `free`: convert delta to model coords (`/zoom`) and add to `x, y`.
- `node`: convert delta to model coords and add to `dx, dy` (the offset moves; the node doesn't).
- `edge`: convert the new rendered position to `(t, perpOffset)` via `projectPointOntoEdge`. `projectPointOntoEdge` already clamps `t` to `[0, 1]` (user picked clamp-at-endpoint). When `t` clamps, **freeze `perpOffset` at its pre-drag value** rather than recomputing it — otherwise dragging past the endpoint silently teleports the label perpendicular to the edge (because the "closest point" shifts to the endpoint and perp distance is measured from there). Pre-drag value lives in a local variable initialized in the mousedown handler.

**Step 3:** Add `updateLabels()` to the `onRender` chain. Add `latestLabels.current = labels` and `latestSelectedLabelId.current = selectedLabelId` at the top of the effect so handlers see fresh values without re-creating.

**Step 4:** TS check + manual smoke deferred to Task 13.

**Step 5:** `git status`.

---

## Task 11: Frontend — `LabelOverlay.tsx` and `LabelEditPopover.tsx`

**Files:**
- Create: `frontend/src/components/Graph/LabelOverlay.tsx`
- Create: `frontend/src/components/Graph/LabelEditPopover.tsx`

**Step 1:** `LabelOverlay.tsx` is a tiny presentational component — renders the markdown using `react-markdown` + `rehype-sanitize`. (The drag/click logic lives in `useCytoscapeOverlays` since it touches the DOM directly.)

```tsx
// frontend/src/components/Graph/LabelOverlay.tsx
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

export function LabelOverlay({ text }: { text: string }) {
  return (
    <div className="label-markdown">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]} components={{
        a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        p: ({ node, ...props }) => <p {...props} style={{ margin: 0 }} />,
      }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
```

Export a helper that the overlay hook uses to render into a detached div:

```tsx
// in LabelOverlay.tsx
import { createRoot, Root } from 'react-dom/client';
const roots = new WeakMap<HTMLElement, Root>();
export function renderLabelMarkdownInto(el: HTMLElement, text: string) {
  let root = roots.get(el);
  if (!root) { root = createRoot(el); roots.set(el, root); }
  root.render(<LabelOverlay text={text} />);
}
```

(If two roots inside one wrapper get awkward — e.g. the drag handlers are attached to the same wrapper — split rendering so the markdown renders into a child div the React root owns, while the wrapper stays under direct DOM control. Iterate on what fits.)

**Step 2:** `LabelEditPopover.tsx` is the markdown source editor.

```tsx
// frontend/src/components/Graph/LabelEditPopover.tsx
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

interface Props {
  initialText: string;
  position: { x: number; y: number }; // rendered coords on the graph
  onSave: (text: string) => void;
  onCancel: () => void;
}

export function LabelEditPopover({ initialText, position, onSave, onCancel }: Props) {
  const [text, setText] = useState(initialText);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-outside saves; Esc cancels.
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onSave(text);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [text, onSave, onCancel]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y + 20,
        zIndex: 50,
        width: 320,
        background: '#0b1220',
        border: '1px solid #4b5563',
        borderRadius: 6,
        padding: 8,
        boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
      }}
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', minHeight: 80, background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, padding: 6, fontSize: 12, fontFamily: 'ui-monospace,SFMono-Regular,monospace' }}
        placeholder="Markdown supported. Esc to cancel, click outside to save."
      />
      <div style={{ marginTop: 6, padding: 6, background: '#111827', borderRadius: 4, fontSize: 11, color: '#d1d5db' }}>
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{text || '*preview*'}</ReactMarkdown>
      </div>
    </div>
  );
}
```

**Step 3:** TS check.

**Step 3b: Sanitization sanity test.** `rehype-sanitize`'s default schema strips `target` and `rel` attributes from anchors. The `components.a` override in `LabelOverlay` sets them after sanitization runs, so they survive in the rendered output — verify with a snapshot:

```tsx
// frontend/src/components/Graph/LabelOverlay.test.tsx
import { render } from '@testing-library/react';
import { LabelOverlay } from './LabelOverlay';

it('renders external links with target="_blank" rel="noopener noreferrer"', () => {
  const { container } = render(<LabelOverlay text="[link](https://example.com)" />);
  const a = container.querySelector('a');
  expect(a).toBeTruthy();
  expect(a!.getAttribute('target')).toBe('_blank');
  expect(a!.getAttribute('rel')).toBe('noopener noreferrer');
  expect(a!.getAttribute('href')).toBe('https://example.com');
});

it('strips inline event handlers and script tags', () => {
  const { container } = render(
    <LabelOverlay text={`<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>`} />,
  );
  expect(container.innerHTML).not.toContain('onerror');
  expect(container.innerHTML).not.toContain('<script');
});
```

**Step 4:** `git status`.

---

## Task 12: Frontend — wire `GraphCanvas` and `ContextMenu`

**Files:**
- Modify: `frontend/src/components/Graph/GraphCanvas.tsx`
- Modify: `frontend/src/components/Graph/ContextMenu.tsx`
- Modify: `frontend/src/components/Graph/CanvasToolPill.tsx` (optional — adds a label-create button)

**Step 1:** In `GraphCanvas`, pull the five label callbacks out of `useInvestigation`. Flatten labels across traces into one array for the overlay hook:

```ts
const flatLabels = useMemo(() => {
  if (!investigation) return [];
  return investigation.traces.flatMap((t) => (t.labels ?? []).map((label) => ({ traceId: t.id, label })));
}, [investigation]);
```

**Step 2:** Pass to `useCytoscapeOverlays` (via `useCytoscape`):

```ts
const { containerRef, /* ... */ } = useCytoscape(
  investigation,
  selectedNodeIds,
  selectedEdgeIds,
  {
    /* existing callbacks */
    labels: flatLabels,
    onLabelMove: moveLabel,
    onLabelEdit: (traceId, labelId) => setEditingLabel({ traceId, labelId }),
    onLabelSelect: setSelectedLabelId,
    selectedLabelId,
  },
);
```

**Step 3:** Add the "Add label here" entry points.

- **Double-click background:** existing `onDoubleClickBackground` callback. On fire, call:
  ```ts
  const newLabel: TraceLabel = {
    id: crypto.randomUUID(),
    text: 'New label',
    anchor: { type: 'free', x: position.x, y: position.y },
  };
  addLabel(activeTraceId, newLabel);
  setEditingLabel({ traceId: activeTraceId, labelId: newLabel.id });
  ```
  (`activeTraceId` resolution policy: use the trace the user most recently interacted with, or fall back to the first visible trace. Pick the simpler one and document.)

- **Context menu (background):** add "Add label here" item. Same handler.
- **Context menu (node):** add "Attach label to this node". Creates a `node`-anchored label at `dx: 0, dy: -nodeRadius` (above the node).
- **Context menu (edge):** add "Attach label to this edge". Creates an `edge`-anchored label at `t: 0.5, perpOffset: 12`.

**Step 4:** Render the edit popover when `editingLabel` is set:

```tsx
{editingLabel && (
  <LabelEditPopover
    initialText={findLabelText(editingLabel)}
    position={resolveLabelRenderedPositionFromEditingLabel(editingLabel)}
    onSave={(text) => {
      updateLabel(editingLabel.traceId, editingLabel.labelId, text);
      setEditingLabel(null);
    }}
    onCancel={() => setEditingLabel(null)}
  />
)}
```

**Step 5: Wire selection coordination — both directions, explicitly.**

- Label → Cytoscape: handled inside `useCytoscapeOverlays` via the `unselectAllCytoscape` callback (Task 10). Pass `unselectAll` from `useCytoscape` through.
- Cytoscape → Label: in `GraphCanvas`'s `onSelectionChange` handler, when the incoming payload has any `nodeIds.length` or `edgeIds.length` > 0, call `setSelectedLabelId(null)`. Also on `onTapBackground` (already fires `onSelectionChange({ nodeIds: [], edgeIds: [], focusItem: null })` per `cytoscapeEvents.ts`).
- Box-drag: `bindCytoscapeEvents` fires `boxend`/`boxselect` paths — make sure these also clear `selectedLabelId`.

Add a `Delete`/`Backspace` keyboard shortcut at the GraphCanvas level: if `selectedLabelId` is non-null, call `deleteLabel(traceId, selectedLabelId)` and then `setSelectedLabelId(null)`. Guard with the standard "not in an input/textarea" check used elsewhere.

Integration test: simulate a label click → assert `unselectAll` was called and `.cy-sel` is gone. Then simulate a node click → assert `selectedLabelId` is null. Both directions covered.

**Step 6:** Optional — add a "Label" pill to `CanvasToolPill.tsx`. Clicking enters "place label" mode where the next canvas click drops a free label there.

**Step 7:** TS check + manual smoke.

**Step 8:** `git status`.

---

## Task 13: Frontend — PNG export labels via `html2canvas` composite

**Files:**
- Modify: `frontend/src/hooks/useCytoscape.ts:152-242` (`exportPngDataUrl`)
- Modify: `frontend/src/hooks/useCytoscapeOverlays.ts` — expose the overlay div (or a stable ref to it) so the export path can rasterize it

**Approach:** The original plan injected temporary cytoscape nodes per label. That has three problems: (a) `cy.png({ full: true })` recomputes bounding box including injected nodes — they'd shift the framing of the exported image; (b) Cytoscape's `text-wrap: wrap` + `text-max-width` does not match browser font metrics, so line wrapping diverges from what the user sees; (c) markdown stripping would have meant `**bold**` rendering as literal asterisks. The user picked **html2canvas composite** for full fidelity — actual DOM rasterized, then layered over the Cytoscape PNG. Heavier (~50kb dep) but exact.

**Step 1:** Surface the overlay element from `useCytoscapeOverlays`. Today the hook creates `overlayEl` internally and never returns a handle. Return it (or store in a ref the parent can read):

```ts
// useCytoscapeOverlays.ts — add a return so callers can grab the element for rasterization.
export interface OverlayHandle {
  getOverlayElement: () => HTMLDivElement | null;
}
// ...inside the effect, expose via the ref:
const overlayRef = useRef<HTMLDivElement | null>(null);
// after creating overlayEl: overlayRef.current = overlayEl;
// cleanup: overlayRef.current = null;
return { getOverlayElement: () => overlayRef.current };
```

In `useCytoscape.ts`, capture the handle: `const overlayHandle = useCytoscapeOverlays(...)`.

**Step 2: Composite in `exportPngDataUrl`.** Keep the existing batched Cytoscape label folding for sublabels/date pills (those are not annotation labels — they're derived UI text and already work). After `cy.png()` returns, rasterize the overlay div and composite:

```ts
import html2canvas from 'html2canvas';

// ...inside exportPngDataUrl, after dataUrl = cy.png(...), still inside try block:

const overlayEl = overlayHandle.getOverlayElement();
if (!overlayEl || labelsAreEmpty()) return dataUrl;  // fast path — no labels, nothing to composite

// Temporarily hide the resize handle / non-label overlay elements so they don't end up in the export.
const childrenToHide: HTMLElement[] = Array.from(overlayEl.children).filter(
  (c) => !(c as HTMLElement).classList.contains('label-wrapper'),
) as HTMLElement[];
const savedDisplays = childrenToHide.map((c) => c.style.display);
childrenToHide.forEach((c) => { c.style.display = 'none'; });

let overlayCanvas: HTMLCanvasElement;
try {
  overlayCanvas = await html2canvas(overlayEl, {
    backgroundColor: null,        // transparent
    scale: 2,                     // matches cy.png({ scale: 2 })
    logging: false,
    useCORS: true,
  });
} finally {
  childrenToHide.forEach((c, i) => { c.style.display = savedDisplays[i]; });
}

// Composite overlayCanvas onto the cytoscape PNG.
const baseImg = new Image();
await new Promise<void>((resolve, reject) => {
  baseImg.onload = () => resolve();
  baseImg.onerror = () => reject(new Error('Failed to load base PNG'));
  baseImg.src = dataUrl;
});
const composite = document.createElement('canvas');
composite.width = baseImg.width;
composite.height = baseImg.height;
const ctx = composite.getContext('2d')!;
ctx.drawImage(baseImg, 0, 0);
// Overlay is positioned over the container; its scale matches the visible viewport.
// cy.png({ full: true }) captures the full graph extent — the overlay only shows what's currently visible.
// For PNG export to be WYSIWYG, draw the overlay at the position corresponding to the current viewport
// within the full-extent image. See Step 3 for the math.
ctx.drawImage(overlayCanvas, overlayDestX, overlayDestY, overlayDestW, overlayDestH);
dataUrl = composite.toDataURL('image/png');
```

**Step 3: Viewport-to-full-extent math.** `cy.png({ full: true, scale: 2 })` returns an image of the full graph extent, not the viewport. The overlay div only contains DOM for what's currently visible in the viewport. To composite correctly:

```ts
// Get the graph's bounding box (model coords).
const bb = cy.elements().boundingBox();
const padding = 50; // matches cy.fit() padding used in the existing code
const fullExtentWidth = (bb.w + 2 * padding) * 2;   // *2 for scale
const fullExtentHeight = (bb.h + 2 * padding) * 2;
const containerRect = containerRef.current!.getBoundingClientRect();
// The viewport position within the full-extent image:
const pan = cy.pan();
const zoom = cy.zoom();
// Model coord of the top-left visible pixel:
const visTopLeftModel = { x: -pan.x / zoom, y: -pan.y / zoom };
// Convert to position within the full-extent image (offset by bb.x1 - padding):
const overlayDestX = (visTopLeftModel.x - (bb.x1 - padding)) * 2;
const overlayDestY = (visTopLeftModel.y - (bb.y1 - padding)) * 2;
const overlayDestW = containerRect.width * 2;
const overlayDestH = containerRect.height * 2;
```

**Step 4: Skip-export consideration.** If `cy.png({ full: false })` were used instead, the overlay-to-base alignment is 1:1 (no offset math). But existing exports use `full: true` for completeness. Honor that contract.

**Step 5: Unit-test the geometry.** Add a test that mocks `cy` + `containerRef` + a flat label list, calls a refactored-out `computeOverlayDestRect(cy, container)` helper, and asserts the destination rect math.

**Step 6: Performance note.** `html2canvas` is sync-blocking on the main thread for the duration of the rasterization (typically 100–400ms for a viewport with ~10 labels). Acceptable for one-shot export. Do not call it during render loop.

**Step 7: Manual export smoke (browser).** Open an investigation with at least one of each anchor type, export PNG, verify:
- Bold markdown renders as bold in the PNG.
- Links render with their hyperlink text (clickability is irrelevant in PNG).
- Free-floating, node-tethered, and edge-tethered labels all appear at their visible on-screen position.
- A label whose anchor is off-screen does not appear in the export.

**Step 8: `git status`.**

---

## Task 14: End-to-end smoke

**Step 1:** Restart everything from scratch.

```bash
cd /Users/Sam/Work/Incite/dev/daubert && npm run db && npm run be & npm run fe
```

**Step 2:** Browser smoke at `http://localhost:3001`:

1. Open an investigation with at least one trace, multiple wallet nodes, and edges.
2. Double-click empty canvas → label popover opens. Type `**OFAC SDN** · [SDN list](https://example.com)`, click outside → label appears with bold + link.
3. Drag the label → moves smoothly, position persists on refresh.
4. Right-click a wallet node → "Attach label to this node" → label appears above node. Drag the node → label follows.
5. Right-click an edge → "Attach label to this edge" → label appears at midpoint. Move one endpoint → label re-projects along the edge.
6. Double-click a label → popover reopens with current text. Edit, click outside → saved.
7. Select a label → press Delete → label removed.
8. Export PNG → all labels appear at correct on-screen positions, with plain text.
9. As a second case member (separate browser/session), open the same investigation → all labels visible.
10. Have the agent run `add_label({ traceId, text: 'agent-placed', anchor: { type: 'node', anchorId: '<wallet id>', dx: 0, dy: -40 } })` → label appears in real time after refresh.

**Step 3:** Final `git status` + `git diff --stat`. Hand off to the user for review and commit.

---

## Decision points

### Resolved by the user (2026-05-26)

- **Data model home:** Labels live on `Trace` (as `Trace.labels`). Free-floating labels use the "most recently focused trace" owner rule; fall back to first visible trace.
- **Edge-tether drag UX:** Clamp `t` to `[0, 1]`. When `t` clamps during a drag, freeze `perpOffset` at its pre-drag value to avoid silent teleporting (see Task 10).
- **PNG export fidelity:** `html2canvas` composite — full markdown fidelity. Task 13 rewritten around this.

### Still open (resolve before implementation, or accept defaults below)

1. **"Add label here" entry points — which subset for v1?**
   - Plan-as-written: all three (double-click background, context menu background, context menu element).
   - Alternative: context menu only (minimal). Or: toolbar pill that toggles a "label place mode" instead of double-click.
   - **Default: all three — they cover different intents (quick drop / discoverable / element-targeted) with shared underlying code.**

2. **Tool naming — `add_label` vs `add_trace_label`?**
   - Plan-as-written: short — `add_label`, `update_label`, etc. Trace ID is in the args.
   - Alternative: prefixed — `add_trace_label`, etc. Reduces collision risk if other label-like concepts emerge.
   - **Default: short names for v1; rename later if collision occurs.**

3. **Max label text length — 4000 chars?**
   - Plan-as-written: 4000.
   - Alternative: smaller (500) to keep labels label-ish, not paragraphs.
   - **Default: 4000 — labels can hold paragraphs of context. UI `max-width: 240px` keeps them visually contained without truncation.**

4. **Bundled-edge tethering — accept Phase 1 fragility, or switch to txHash now?**
   - Plan-as-written: tether by edge UUID, accept that bundle/aggregation can orphan labels (they're hidden cleanly, not crashed).
   - Alternative: for transaction edges (i.e. anchors where the underlying edge has a `txHash`), use `txHash` as the anchor id. Stable across aggregation. Adds a `edge` vs `txEdge` anchor distinction.
   - **Default: edge UUID + accept fragility for v1. Promote to txHash in Phase 2 if users complain.**
