# MCP Declaration Parity Implementation Plan

**Goal:** Give BYOA (MCP) agents the same declaration capabilities the built-in agent has — discoverable declaration create/edit, the `declarations` skill, and the two org-scoped read tools (`get_declarants`, `get_declaration_library`).

## Summary

- **What & why:** Declaration creation/editing already *works* over MCP by accident of shared plumbing (`create_production` validates `type` via `z.nativeEnum(ProductionType)` and `update_production` forwards raw `ops` to the shared `ProductionsService.applyOps()`), but an external agent can't discover any of it: the MCP tool descriptions still say "report, chart, or chronology", the `declarations` skill isn't advertised, and there are **no** MCP equivalents of `get_declarants` / `get_declaration_library` — so the qualifications-auto-fill workflow the `declarations` skill instructs ("Call `get_declarants` first") is impossible over MCP. This plan closes the gap: two new org-scoped read tools, updated descriptions, and skill advertisement.
- **Key product decisions:** MCP tool behavior and response shapes mirror the built-in agent's exactly (same projections, same `kind` filter restricted to `boilerplate`) — one mental model for both agent surfaces.
- **Load-bearing architecture decisions:**
  - The new tools are **org-wide reads with no case scope and no role assertion**, exactly like the existing `query_labeled_entities`: the MCP session is bound to one organization (`principal.organizationId`, re-verified against org membership on every request by `McpAuthHelper`; guests are rejected at auth), so `listForOrg(principal.organizationId)` is the entire access model. No case lookup (unlike the built-in agent, which resolves org via the case because it is case-scoped).
  - Read tools do **not** audit (module convention: audit is mutation-only, `WriteToolsService` security criterion #4).
  - `get_skill`'s advertised-names list and error message are made **dynamic from `SKILL_REGISTRY`** instead of restating a hardcoded list — fixes today's staleness (list omits `daubert-overview` and `declarations`) and the error's reference to a nonexistent `query_skills` tool, and can't go stale again.
- **Risk:** low — all three tasks follow existing in-module precedent verbatim. No task is opus-tagged.
- **Known limitation (accepted):** MCP tool results are capped at 8 KB (`RESULT_CAP_BYTES`, `tool-utils.ts:32`) with a truncation suffix — a large declarant list with long qualifications may truncate. This is the module-wide cap every MCP read lives with; not changed here.

## Engineering decisions made

- New tools live in `read-tools.ts` beside `query_labeled_entities` (the closest precedent: org-wide, no `caseAccess.assertRole`, no audit).
- Response projections copied from the built-in agent's dispatch in `ai.service.ts` (drop `organizationId`; `get_declarants` returns 12 fields, `get_declaration_library` returns 5).
- `get_declaration_library`'s `kind` filter is `z.enum(['boilerplate']).optional()` — mirroring the built-in tool's schema; `declarant_profile` blocks were migrated into `declarants` and are no longer offered.
- Adding `DeclarantsModule` + `DeclarationLibraryModule` to `McpModule.imports` is sufficient DI (both export their services; verified).
- Adding two constructor params to `ReadToolsService` breaks the existing `read-tools.spec.ts` `buildService` helper — that spec is updated in the same task (mandatory, not optional).
- No commits: leave all changes in the working tree; run `git status` at the end of each task (repo rule in `CLAUDE.md`).

---

> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task. Do **NOT** commit — leave all changes in the working tree and run `git status` at the end of each task. No `Co-Authored-By` trailer anywhere.

## Atomized Changes

| # | File | Action | What changes |
|---|------|--------|--------------|
| 1 | `backend/src/modules/mcp/mcp.module.ts` | Modify | Import `DeclarantsModule` + `DeclarationLibraryModule` |
| 1 | `backend/src/modules/mcp/tools/read-tools.ts` | Modify | Inject the two services; register `get_declarants` + `get_declaration_library` |
| 1 | `backend/src/modules/mcp/tools/read-tools.spec.ts` | Modify | Update `buildService` for the new constructor; add test blocks for both new tools |
| 2 | `backend/src/modules/mcp/tools/write-tools.ts` | Modify | `create_production` + `update_production` descriptions document declarations |
| 2 | `backend/src/modules/mcp/tools/read-tools.ts` | Modify | `get_skill` description + error message derived from `SKILL_REGISTRY` |
| 2 | `backend/src/modules/mcp/mcp.tools.ts` | Modify | Add `declarations` to `PROMPT_SKILL_HANDLES` |
| 3 | — | — | Full verification sweep (build + backend tests + git status) |

---

## Task 1: New MCP read tools — `get_declarants` + `get_declaration_library` (TDD)

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/mcp/mcp.module.ts` (imports array, ~lines 55-66), `backend/src/modules/mcp/tools/read-tools.ts` (constructor ~45-52, `registerAll` — add tools after `get_skill`), `backend/src/modules/mcp/tools/read-tools.spec.ts` (the `buildService` helper + new `describe` blocks).

**Context an implementer needs (verified):**
- `ReadToolsService.registerAll(server: McpServer, auth: AuthSuccess)` destructures `const { principal } = auth;` — `principal.organizationId` is the session's bound org (`AccessPrincipal` mcp variant, `backend/src/modules/auth/access-principal.ts:4-7`).
- Service signatures: `DeclarantsService.listForOrg(organizationId: string): Promise<DeclarantEntity[]>` (`backend/src/modules/declarants/declarants.service.ts:54-59`); `DeclarationLibraryService.listForOrg(organizationId: string, kind?: DeclarationLibraryBlockKind)` (`backend/src/modules/declaration-library/declaration-library.service.ts:54-62`). `DeclarationLibraryBlockKind` is in `backend/src/database/entities/declaration-library-block.entity.ts` (`BOILERPLATE = 'boilerplate'`).
- Helpers `textResult` / `errorResult` from `./tool-utils`. Input schemas are **raw zod shapes** (not `z.object(...)`), per the module convention documented in `navigate-tools.ts:32-34`.
- The file's long block-comment header style is the module's documentation convention — extend it for the new tools.

**Step 1 — failing tests.** In `read-tools.spec.ts`:
1. Update `buildService(overrides)` to pass two new mocked deps to `new ReadToolsService(...)` (after `labeledEntitiesService`): `declarants: { listForOrg: jest.fn().mockResolvedValue([]) }` and `declarationLibrary: { listForOrg: jest.fn().mockResolvedValue([]) }` (overridable like the existing deps).
2. Add two `describe` blocks modeled on the existing `query_labeled_entities` block (~lines 250-283):

```ts
describe('get_declarants', () => {
  it('lists declarants for the session org, projected like the built-in agent', async () => {
    const listForOrg = jest.fn().mockResolvedValue([
      {
        id: 'd1', displayName: 'Dr. Jane Smith', title: 'Forensic Accountant',
        firm: 'Smith LLC', qualifications: [{ id: 'q1', text: 'Qualified.', subItems: [], exhibitIds: [], footnotes: [] }],
        cvExhibit: null, priorTestimony: [], hourlyRate: '$500/hour',
        nonContingencyDisclosure: null, dateOfBirth: null, address: null,
        userId: null, organizationId: ORG_ID, createdAt: new Date(), updatedAt: new Date(),
      },
    ]);
    const { server } = buildService({ declarants: { listForOrg } });
    const result = await callTool(server, 'get_declarants', {});
    expect(listForOrg).toHaveBeenCalledWith(ORG_ID);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.declarants).toHaveLength(1);
    expect(payload.declarants[0]).toMatchObject({ id: 'd1', displayName: 'Dr. Jane Smith' });
    expect(payload.declarants[0].organizationId).toBeUndefined(); // dropped from projection
  });

  it('does NOT require a case (no assertRole called)', async () => {
    const assertRole = jest.fn();
    const { server } = buildService({ caseAccess: { assertRole } });
    await callTool(server, 'get_declarants', {});
    expect(assertRole).not.toHaveBeenCalled();
  });

  it('returns errorResult on service failure', async () => {
    const listForOrg = jest.fn().mockRejectedValue(new Error('db down'));
    const { server } = buildService({ declarants: { listForOrg } });
    const result = await callTool(server, 'get_declarants', {});
    expect(result.isError).toBe(true);
  });
});

describe('get_declaration_library', () => {
  it('lists boilerplate blocks for the session org', async () => {
    const listForOrg = jest.fn().mockResolvedValue([
      { id: 'b1', kind: 'boilerplate', name: 'Chain primer', category: 'primer',
        content: { paragraphs: [] }, organizationId: ORG_ID, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const { server } = buildService({ declarationLibrary: { listForOrg } });
    const result = await callTool(server, 'get_declaration_library', {});
    expect(listForOrg).toHaveBeenCalledWith(ORG_ID, undefined);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.blocks[0]).toMatchObject({ id: 'b1', kind: 'boilerplate', name: 'Chain primer' });
    expect(payload.blocks[0].organizationId).toBeUndefined();
  });

  it('passes the kind filter through', async () => {
    const listForOrg = jest.fn().mockResolvedValue([]);
    const { server } = buildService({ declarationLibrary: { listForOrg } });
    await callTool(server, 'get_declaration_library', { kind: 'boilerplate' });
    expect(listForOrg).toHaveBeenCalledWith(ORG_ID, 'boilerplate');
  });

  it('does NOT require a case (no assertRole called)', async () => {
    const assertRole = jest.fn();
    const { server } = buildService({ caseAccess: { assertRole } });
    await callTool(server, 'get_declaration_library', {});
    expect(assertRole).not.toHaveBeenCalled();
  });
});
```

Adapt fixture/helper names to the file's actual local conventions (read them first) — the `callTool` helper and `ORG_ID` fixture already exist there.

**Step 2 — confirm red.** `npm test --prefix backend -- read-tools` → the new tests fail (tools not registered; constructor mismatch may also surface — that's expected).

**Step 3 — implement.**
1. `mcp.module.ts`: add `DeclarantsModule` and `DeclarationLibraryModule` to `imports` (with the same one-line `// exports X` comment style as the neighbors); import both at the top.
2. `read-tools.ts`: add constructor params `private readonly declarantsService: DeclarantsService` and `private readonly declarationLibraryService: DeclarationLibraryService` (imports from `../../declarants/declarants.service` and `../../declaration-library/declaration-library.service`; also import `DeclarationLibraryBlockKind` from `../../../database/entities/declaration-library-block.entity`).
3. Register both tools inside `registerAll`, after `get_skill`, with the module's block-comment header style:

```ts
    // -----------------------------------------------------------------------
    // get_declarants / get_declaration_library — org-wide declaration reads.
    //
    // The MCP session is bound to exactly one organization
    // (principal.organizationId, re-verified per request by McpAuthHelper),
    // so these are pure org reads: no case scope, no assertRole — same
    // access model as query_labeled_entities. Projections mirror the
    // built-in agent's dispatches in ai.service.ts for parity; the
    // organizationId column is dropped from row shapes. Reads don't audit.
    // -----------------------------------------------------------------------
    server.registerTool(
      'get_declarants',
      {
        description:
          "List the organization's saved declarants (expert witnesses / affiants) with their profile fields — display name, title, firm, qualifications paragraphs, prior testimony, CV exhibit, rate, and disclosures. Use before drafting a declaration to fill the declarant's qualifications and background (see the `declarations` skill).",
        inputSchema: {},
      },
      async () => {
        try {
          const declarants = await this.declarantsService.listForOrg(
            principal.organizationId,
          );
          return textResult({
            declarants: declarants.map((d) => ({
              id: d.id,
              displayName: d.displayName,
              title: d.title,
              firm: d.firm,
              qualifications: d.qualifications,
              cvExhibit: d.cvExhibit,
              priorTestimony: d.priorTestimony,
              hourlyRate: d.hourlyRate,
              nonContingencyDisclosure: d.nonContingencyDisclosure,
              dateOfBirth: d.dateOfBirth,
              address: d.address,
              userId: d.userId,
            })),
          });
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    server.registerTool(
      'get_declaration_library',
      {
        description:
          "List the organization's reusable boilerplate declaration blocks (technical chain primers, authentication language) with their paragraph content. Use before drafting background/authentication sections. For a declarant's qualifications, use `get_declarants` instead.",
        inputSchema: {
          kind: z.enum(['boilerplate']).optional(),
        },
      },
      async ({ kind }) => {
        try {
          const blocks = await this.declarationLibraryService.listForOrg(
            principal.organizationId,
            kind as DeclarationLibraryBlockKind | undefined,
          );
          return textResult({
            blocks: blocks.map((b) => ({
              id: b.id,
              kind: b.kind,
              name: b.name,
              category: b.category,
              content: b.content,
            })),
          });
        } catch (e) {
          return errorResult(e);
        }
      },
    );
```

**Step 4 — confirm green.** `npm test --prefix backend -- read-tools` → all pass (existing + new). `npm run build --prefix backend` → clean. `git status`.

## Task 2: Descriptions + skill advertisement

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/mcp/tools/write-tools.ts` (~lines 250-251 and 296-297), `backend/src/modules/mcp/tools/read-tools.ts` (`get_skill`, ~lines 218-236), `backend/src/modules/mcp/mcp.tools.ts` (`PROMPT_SKILL_HANDLES`, ~lines 39-45).

**Step 1 — `create_production` description.** Replace the string at `write-tools.ts:250-251` with:

```ts
        description:
          'Create a new production (report, chart, chronology, or declaration) under a case. Requires editor access. For declarations pass `data: { formatId, caption?, declarantName?, declarantDateOfBirth?, declarantAddress? }` — `formatId` is one of `ca-declaration`, `ny-affirmation`, `federal-1746`, `tx-declaration`, `fl-declaration`; the server seeds the section skeleton and renders the jurisdiction\'s oath, caption chrome, and numbering automatically. `tx-declaration` additionally requires `declarantDateOfBirth` and `declarantAddress`. Build declaration content afterwards with `update_production` declaration ops — read the `declarations` skill first.',
```

**Step 2 — `update_production` description.** Replace the string at `write-tools.ts:296-297` with:

```ts
        description:
          'Update a production: rename, replace its `data` payload, or apply atomic `ops`. `data` and `ops` are mutually exclusive. Requires editor access. Chronology/chart ops are documented in the `productions` skill; declaration ops (declaration_set_caption, declaration_add_section, declaration_add_paragraph, declaration_add_exhibit, …) in the `declarations` skill — read the relevant skill before applying ops.',
```

**Step 3 — dynamic `get_skill` names.** In `read-tools.ts`, import `SKILL_REGISTRY` alongside `getSkillContent` from `'../../../skills/skill-registry'`, then build the list once inside `registerAll` (before the `get_skill` registration):

```ts
    const skillNames = SKILL_REGISTRY.map((s) => s.name).join(', ');
```

Use it in both the description and the error message (this also fixes the stale reference to the nonexistent `query_skills` tool):

```ts
        description: `Read a skill document by name. Valid names: ${skillNames}.`,
```
```ts
            return textResult({
              error: `Unknown skill: "${name}". Valid names: ${skillNames}.`,
            });
```

**Step 4 — advertise the skill as an MCP prompt.** In `mcp.tools.ts`, add `'declarations'` to `PROMPT_SKILL_HANDLES` (after `'productions'`). No other plumbing — `registerPromptsForScope` already resolves the description from `SKILL_REGISTRY` (the `declarations.md` frontmatter description covers the five jurisdiction formats).

**Step 5 — verify.** `npm test --prefix backend -- mcp` → all MCP suites pass (if any spec asserted the old `get_skill` description or the old production descriptions, update those assertions — check `read-tools.spec.ts` / `write-tools.spec.ts` for string matches). `npm run build --prefix backend` → clean. `git status`.

## Task 3: Verification sweep

**Implementer:** sonnet

1. `npm run build --prefix backend` → clean.
2. `npm test --prefix backend` → full suite green (any e2e failures from a missing local Postgres are environmental — report them separately, not as regressions).
3. Sanity-grep: `grep -rn "query_skills" backend/src` → zero hits (stale reference gone); `grep -n "declarations" backend/src/modules/mcp/mcp.tools.ts` → present in `PROMPT_SKILL_HANDLES`.
4. `git status` → full manifest of changed files; nothing committed.
