# Investigations always have a trace

**Problem.** An investigation can exist with zero traces, but nothing in the graph can be
authored without one. `TransactionForm` and `WalletForm` both resolve the target trace to
`''` in that state and call `onSave('')`; `mapTrace` in the reducer matches no trace and
returns state unchanged, so the wallet nodes and the edge are silently discarded while the
panel closes and the details panel shows the phantom item. Reported against investigation
"Tracing Polygon" (case `889270dc-…`), which has no traces.

**Approach.** Option C (every investigation is born with a trace) removes the invalid state
at the source. Option A (forms auto-create a trace on submit) stays as the fallback for the
one way the state can still be reached: the user deletes every trace. On top of both, the
reducer stops accepting writes addressed to a trace that does not exist.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `shared/trace-colors.ts` | Create | Single source of truth for the trace colour palette, so backend and frontend agree on what colour trace *n* gets |
| 2 | `frontend/src/hooks/useGraphContextMenu.ts` | Modify | Uses the shared palette instead of its own copy |
| 3 | `frontend/src/hooks/useBatchNodeOps.ts` | Modify | Uses the shared palette instead of its own copy |
| 4 | `contracts/schemas/investigations.yaml` | Modify | `CreateInvestigationRequest` accepts an optional `initialTraceName`; callers that know the trace's name get it right on creation |
| 5 | `contracts/paths/investigations.yaml` | Modify | Documents that the create response carries the investigation's traces |
| 6 | `backend/src/modules/investigations/dto/create-investigation.dto.ts` | Modify | Validates `initialTraceName` |
| 7 | `backend/src/modules/investigations/investigations.service.ts` | Modify | **Every new investigation is created with one trace** — REST, the onboarding wizard, and the MCP `create_investigation` tool all go through here |
| 8 | `backend/src/modules/investigations/investigations.service.spec.ts` | Create | Locks in "create always yields exactly one trace" and the `initialTraceName` override |
| 9 | `backend/src/database/migrations/<ts>-BackfillDefaultTrace.ts` | Create | Existing trace-less investigations (including "Tracing Polygon") get a trace, so the graph works on them without the user doing anything |
| 10 | `frontend/src/hooks/useCaseSeed.ts` | Modify | Seeding names the auto-created trace instead of creating a second one — no stray empty "Trace 1" after onboarding |
| 11 | `frontend/src/components/Forms/TransactionForm.tsx` | Modify | **Saving a transaction with no trace present creates one instead of dropping the work**, and a failure surfaces an error rather than closing the panel |
| 12 | `frontend/src/components/Forms/WalletForm.tsx` | Modify | Same fallback for the address form |
| 13 | `frontend/src/components/Forms/TransactionForm.test.tsx` | Create | Covers the zero-trace submit path and the create-fails path |
| 14 | `frontend/src/hooks/useInvestigation.ts` | Modify | **A write addressed to a non-existent trace is now loud instead of silent** — this class of data loss becomes a visible error at the moment it happens |
| 15 | `frontend/src/hooks/useInvestigation.test.ts` | Modify | Covers the new `mapTrace` behaviour |

### What changes (UX and DX)

**For the user (UX):**
- Creating an investigation drops you into a workspace that is immediately usable — no "create a trace first" step, no empty graph that silently rejects everything you add.
- The existing "Tracing Polygon" investigation (and any other trace-less one) starts working after the migration runs, with no manual cleanup.
- If you delete every trace and then add an address or transaction, the app creates a trace for you rather than eating the input.
- If trace creation genuinely fails (offline, permission), the panel stays open with an error instead of closing as though it worked.

**For the developer (DX):**
- Zero-trace investigations stop existing, so new authoring surfaces do not each have to re-invent the empty-state dance.
- `mapTrace` fails loudly on an unresolved trace id, so the next stale-id bug shows up as an error in dev instead of a vanished write in prod.
- The trace colour palette lives in one place instead of three.

---

## Tasks

### Task 1 — Shared trace colour palette

Create `shared/trace-colors.ts`:

```ts
/**
 * Colour palette for traces, in assignment order. A new trace takes
 * `TRACE_COLORS[existingTraceCount % TRACE_COLORS.length]`, so the first trace on
 * an investigation is always `TRACE_COLORS[0]`.
 *
 * Shared because the backend now mints the default trace on investigation
 * creation while the frontend mints every subsequent one — they have to agree on
 * the sequence or colours repeat immediately.
 */
export const TRACE_COLORS = [
  '#3b82f6', '#10b981', '#f97316', '#8b5cf6',
  '#ec4899', '#06b6d4', '#eab308', '#ef4444',
] as const;

export function traceColorForIndex(index: number): string {
  return TRACE_COLORS[index % TRACE_COLORS.length];
}
```

Run `npm run gen` so it lands in `frontend/src/generated/shared/` and
`backend/src/generated/shared/`.

Replace the local `TRACE_COLORS` const in `frontend/src/hooks/useGraphContextMenu.ts` (line 12)
and `frontend/src/hooks/useBatchNodeOps.ts` (line 7) with an import of `traceColorForIndex`
from `@/generated/shared/trace-colors`, and swap the two
`TRACE_COLORS[(investigation?.traces.length || 0) % TRACE_COLORS.length]` expressions for
`traceColorForIndex(investigation?.traces.length || 0)`.

### Task 2 — Contract: `initialTraceName`

In `contracts/schemas/investigations.yaml`, add to `CreateInvestigationRequest`:

```yaml
    initialTraceName:
      type: string
      description: >-
        Name for the trace created alongside the investigation. Every investigation
        is created with exactly one trace; omit this to get the default name.
```

In `contracts/paths/investigations.yaml`, change the `createInvestigation` 201 description to
`Created investigation, including its default trace`.

Run `npm run gen`.

### Task 3 — Backend: create the default trace

`backend/src/modules/investigations/dto/create-investigation.dto.ts` — add:

```ts
  @IsOptional()
  @IsString()
  initialTraceName?: string;
```

`backend/src/modules/investigations/investigations.service.ts` — `create()` becomes:

```ts
  /**
   * Creates an investigation together with its first trace.
   *
   * The trace is not optional. A trace is the only container the graph can write
   * into: nodes, edges, groups and bundles all live inside `trace.data`, and every
   * authoring path resolves a target trace id before it writes. An investigation
   * with zero traces is therefore a state in which the workspace exists but cannot
   * accept any input, which is what this guarantees away.
   *
   * Written through `traceRepo` rather than `TracesService.create` deliberately:
   * the access check already ran (`@RequireRole('editor')` on the REST route,
   * `assertRole` in the MCP write tool), and going through the service would add a
   * circular module dependency for a second, redundant gate.
   */
  async create(caseId: string, dto: CreateInvestigationDto) {
    const c = await this.caseRepo.findOneBy({ id: caseId });
    if (!c) throw new NotFoundException(`Case ${caseId} not found`);

    const entity = this.repo.create({
      name: dto.name,
      notes: dto.notes || null,
      caseId,
    });
    const saved = await this.repo.save(entity);

    await this.traceRepo.save(
      this.traceRepo.create({
        name: dto.initialTraceName?.trim() || DEFAULT_TRACE_NAME,
        color: traceColorForIndex(0),
        visible: true,
        collapsed: false,
        data: { nodes: [], edges: [] },
        investigationId: saved.id,
      }),
    );

    return this.repo.findOne({ where: { id: saved.id }, relations: ['traces'] });
  }
```

with `const DEFAULT_TRACE_NAME = 'Trace 1';` at module scope and
`traceColorForIndex` imported from `../../generated/shared/trace-colors`.

Note the return type changes from `InvestigationEntity` to `InvestigationEntity | null`;
`findOne` on a row that was just written cannot be null in practice, so use a non-null
assertion at the return rather than widening every caller.

`duplicate()` needs no change — it copies the source's traces, and the source now always has
at least one. But its `sourceTraces.length === 0` early return is now only reachable for
pre-migration rows; leave it as the defensive branch it already is.

### Task 4 — Backend test

`backend/src/modules/investigations/investigations.service.spec.ts` — follow the existing
repository-mock style used elsewhere in `backend/src/modules/**/*.spec.ts`. Cover:

- `create()` saves exactly one trace, on the new investigation, named `Trace 1`, coloured `TRACE_COLORS[0]`, with `data = { nodes: [], edges: [] }`.
- `create()` with `initialTraceName: 'Polygon flow'` uses that name.
- `create()` with `initialTraceName: '   '` falls back to `Trace 1`.
- `create()` returns the investigation with the `traces` relation populated.

### Task 5 — Backfill migration

Generate the file with `./migrations.sh --dev --create-empty BackfillDefaultTrace`
(`--generate` diffs the schema, and this is a data-only change, so it would produce an empty
migration).

`up()`:

```sql
INSERT INTO traces (id, name, color, visible, collapsed, data, investigation_id, created_at, updated_at)
SELECT gen_random_uuid(), 'Trace 1', '#3b82f6', true, false,
       '{"nodes": [], "edges": []}'::jsonb, i.id, NOW(), NOW()
FROM investigations i
WHERE NOT EXISTS (SELECT 1 FROM traces t WHERE t.investigation_id = i.id);
```

Confirm the actual `traces` column names and whether `created_at`/`updated_at` carry defaults
by reading `backend/src/database/entities/base.entity.ts` before writing the statement, and
match it. `gen_random_uuid()` requires `pgcrypto`; check whether an earlier migration already
enables it and add `CREATE EXTENSION IF NOT EXISTS pgcrypto;` only if not.

`down()`: delete the backfilled traces — empty `Trace 1` rows that are the sole trace on their
investigation.

```sql
DELETE FROM traces t
WHERE t.name = 'Trace 1'
  AND t.data = '{"nodes": [], "edges": []}'::jsonb
  AND NOT EXISTS (SELECT 1 FROM traces o WHERE o.investigation_id = t.investigation_id AND o.id <> t.id);
```

**Do not run the migration.** Leave the file for review; the user applies it with
`./migrations.sh --prod --run`.

Dev needs the same backfill to see the fix locally (`synchronize: true` does not do data
work). Apply the `up()` SQL as a one-shot against the dev database only, per the exception in
`CLAUDE.md`.

### Task 6 — Seed path uses the default trace

`frontend/src/hooks/useCaseSeed.ts` (lines 156–159): pass the computed trace name into
`createInvestigation` and read the id back off the response instead of creating a second
trace.

```ts
  const traceName =
    addresses.length > 1
      ? `${shortAddress(addresses[0])} +${addresses.length - 1} more`
      : shortAddress(addresses[0]);
  const inv = await apiClient.createInvestigation(caseId, {
    name: 'Fund tracing',
    initialTraceName: traceName,
  });
  const trace = inv.traces![0];
```

Update `frontend/src/hooks/useCaseSeed.test.ts`: the `createInvestigation` mocks currently
resolve to `{ id: 'inv-1' }` and the test asserts against a separate `createTrace` call.
Mocks now need `traces: [{ id: 'trace-1', … }]`, and the `createTrace` assertions become
assertions on the `initialTraceName` argument.

### Task 7 — Form fallback: create a trace on submit

`frontend/src/components/Forms/TransactionForm.tsx`.

`handleSubmit` becomes async and resolves the trace before saving:

```ts
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const fromTrace = findTraceForWallet(from);
    const toTrace = findTraceForWallet(to);
    const crossTrace = !!(fromTrace && toTrace && fromTrace !== toTrace);

    /**
     * An edge has to land in a trace — `mapTrace` in the reducer drops any write
     * whose trace id does not resolve. Normally an investigation always has one
     * (the backend creates it), so this only fires when the user has deleted every
     * trace. Creating one here is what keeps the input from being lost.
     */
    let resolvedTraceId = fromTrace || traceId || traces[0]?.id || '';
    if (!resolvedTraceId) {
      if (!onCreateTrace) {
        setSaveError('This transaction needs a trace, and none could be created.');
        return;
      }
      setSaving(true);
      const newId = await onCreateTrace();
      setSaving(false);
      if (!newId) {
        setSaveError('Could not create a trace. Check your connection and try again.');
        return;
      }
      resolvedTraceId = newId;
    }
    setSaveError(null);

    onSave(resolvedTraceId, { /* unchanged */ });
  };
```

In the trace section, replace the `traces.length === 0` branch (the `+ Create Trace` button)
with a static hint, and drop the now-unused `creatingTrace` state and the mount effect that
syncs `traceId` off an empty list:

```tsx
          {traces.length === 0 ? (
            <p className="text-xs text-canvas-muted/60">
              No traces yet. One will be created when you save.
            </p>
          ) : ( /* existing select + "+" button, unchanged */ )}
```

Render `saveError` above the button row in `text-redline text-xs`, and set `disabled={saving}`
on the submit button with its label switching to `Saving…`.

Apply the same three changes to `frontend/src/components/Forms/WalletForm.tsx`
(`handleSubmit` at line 64, the zero-trace branch at line 74, the `traceId` fallback at
line 29).

### Task 8 — Form tests

`frontend/src/components/Forms/TransactionForm.test.tsx`, following the RTL style already in
`frontend/src/components/**/*.test.tsx`:

- With `traces: []` and typed from/to addresses, submitting calls `onCreateTrace` and then `onSave` with the returned id — never with `''`.
- With `traces: []` and an `onCreateTrace` that resolves `undefined`, `onSave` is not called and an error message renders.
- With a non-empty `traces`, `onCreateTrace` is not called and the selected trace id is passed through (regression guard on the normal path).

### Task 9 — `mapTrace` stops swallowing writes

`frontend/src/hooks/useInvestigation.ts` (line 128):

```ts
/**
 * Applies `fn` to the trace `traceId` names.
 *
 * A caller that names a trace which is not on the investigation has a bug: the
 * write it intended is not applied anywhere, and the caller cannot tell. That
 * silence is how a whole transaction (two nodes and an edge) was lost when a form
 * resolved its target trace to `''`. Unresolved ids are therefore reported, and
 * throw outside production so they surface during development and in tests, while
 * a user in production keeps their session.
 */
function mapTrace(state: Investigation | null, traceId: string, fn: (trace: Trace) => Trace): Investigation | null {
  if (!state) return state;
  if (!state.traces.some((t) => t.id === traceId)) {
    const message = `mapTrace: no trace ${JSON.stringify(traceId)} on investigation ${state.id} — write discarded`;
    console.error(message);
    if (process.env.NODE_ENV !== 'production') throw new Error(message);
    return state;
  }
  return {
    ...state,
    traces: state.traces.map((t) => (t.id === traceId ? fn(t) : t)),
  };
}
```

Add coverage to `frontend/src/hooks/useInvestigation.test.ts` for the throw, and run the full
frontend suite — any existing test that dispatches against a stale trace id will now fail, and
each such failure is a real bug to fix rather than a test to relax.

### Task 10 — Verify

- `npm run gen`
- `npm run build:be` and `npm run build:fe`
- `npm test --prefix backend` and `npm test --prefix frontend`
- Leave the migration unapplied on prod; report `git status` at the end.

---

## Engineering decisions made

- **Default trace via `traceRepo`, not `TracesService.create`** — the role gate has already run on both entry paths, and routing through the service would introduce a circular module dependency for a redundant check.
- **`initialTraceName` on the create request** rather than having the seed path rename the auto-created trace — one round trip instead of two, and the trace is never briefly mis-named.
- **The `+ Create Trace` button in both forms is replaced by a hint line.** With the backend guaranteeing a trace and the form creating one on submit, a button the user must remember to press is the exact failure this plan removes. Say so if you would rather keep it.
- **`mapTrace` throws outside production, logs everywhere.** Loud in dev and CI, non-fatal for a user mid-investigation.
- **`down()` deletes only empty, sole `Trace 1` rows**, so a rollback cannot destroy a trace someone has since put work into.
