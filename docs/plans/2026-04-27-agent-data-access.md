# Agent Data Access Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent the AI agent from blowing its context window by redesigning how it accesses investigation data — lightweight overview by default, targeted queries when needed, and script-based processing for mechanical tasks. Restore script mutation capability (broken since the dev-auth fallback was removed) by extending the auth model to support an `AccessPrincipal` that can represent either a user or a case-scoped script.

**Architecture:** Split the monolithic `get_case_data` into two tools: a cheap case overview (`get_case_data`) and a queryable investigation reader (`get_investigation`) with address/token filtering. Add dual-auth — the global `AuthGuard` accepts either a Firebase Bearer token or a case-scoped HMAC `X-Script-Token`, attaching an `AccessPrincipal` to every authenticated request. Scripts call the existing trace/investigation endpoints directly. Loopback in production is gated by `SCRIPT_ALLOW_LOOPBACK`.

**Tech Stack:** NestJS, TypeORM, isolated-vm (script sandbox), Anthropic Claude tool use

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Slim `get_case_data` to overview-only, add `get_investigation` tool definition |
| 2 | `backend/src/modules/ai/tools/index.ts` | Modify | Export new `GET_INVESTIGATION_TOOL` |
| 3 | `backend/src/modules/ai/investigation-data.utils.ts` | Create | Pure functions for stripping visual metadata and filtering trace data |
| 4 | `backend/src/modules/ai/ai.service.ts` | Modify | Implement overview, investigation query with filtering, pass caseId to script execution |
| 5 | `backend/src/modules/ai/ai.module.ts` | Modify | Add `TraceEntity`, `DataRoomConnectionEntity`, `ScriptModule` import |
| 6 | `backend/src/modules/auth/access-principal.ts` | Create | `AccessPrincipal` type + `getPrincipal(req)` helper |
| 7 | `backend/src/modules/auth/case-access.service.ts` | Modify | `assertAccess` takes `AccessPrincipal`; never optional |
| 8 | `backend/src/modules/auth/auth.guard.ts` | Modify | Accept `Authorization: Bearer` (existing) OR `X-Script-Token` (new); attach `req.principal` |
| 9 | `backend/src/modules/script/script-token.service.ts` | Create | HMAC sign/verify for case-scoped script tokens |
| 10 | `backend/src/modules/script/script.module.ts` | Create | Provides `ScriptTokenService` |
| 11 | `backend/src/app.module.ts` | Modify | Register `ScriptModule` |
| 12 | `backend/src/modules/auth/auth.module.ts` | Modify | Import `ScriptModule` so `AuthGuard` can inject `ScriptTokenService` |
| 13 | `backend/src/modules/traces/traces.{service,controller}.ts` | Modify | Take `AccessPrincipal` instead of `userId?`; `assertAccess` always runs |
| 14 | `backend/src/modules/investigations/investigations.{service,controller}.ts` | Modify | Same principal refactor |
| 15 | `backend/src/modules/ai/services/script-execution.service.ts` | Modify | `SCRIPT_ALLOW_LOOPBACK` env flag, accept `caseId`, sign token, inject `X-Script-Token` into localhost requests |
| 16 | `backend/src/prompts/investigator.ts` | Modify | Teach agent the new tools + that scripts can call existing endpoints directly |
| 17 | `backend/src/skills/graph-mutations.md` | Modify | Show scripts using existing trace/investigation endpoints |
| 18 | `backend/src/skills/product-knowledge.md` | Modify | Document new data access tools and workflow |

Tests:

| # | File | Action | Purpose |
|---|------|--------|---------|
| 19 | `backend/src/modules/ai/investigation-data.utils.spec.ts` | Create | Unit tests for strip/filter |
| 20 | `backend/src/modules/script/script-token.service.spec.ts` | Create | HMAC round-trip, tamper, expiry |
| 21 | `backend/src/modules/auth/case-access.service.spec.ts` | Create | `assertAccess` for both principal kinds |
| 22 | `backend/src/modules/auth/auth.guard.spec.ts` | Create | Both auth paths produce a principal; admin routes still reject script tokens |

---

## Background

### Problem

`get_case_data` returns the full JSONB `data` blob for every trace in the case — all nodes, edges, positions, colors, groups. For a case with 122 nodes and 305 edges across 3 traces, this is tens of thousands of tokens. The agent loads it all into context, leaving no room to reason or act.

Additionally: scripts have been silently 401-ing on mutations since the dev-auth fallback in `AuthGuard` was removed. Per `script_runs` analysis, scripts have historically called these endpoints (counts from 198 successful runs):

| Method | Path | Calls | Purpose |
|---|---|---|---|
| POST | `/traces/:id/import-transactions` | 59 | Bulk ingest blockchain txns |
| PATCH | `/traces/:id/edges/:id` | 28 | Edit edge metadata |
| PATCH | `/traces/:id/nodes/:id` | 16 | Edit node metadata |
| GET | `/traces/:id` | 14 | Read trace |
| POST | `/traces/:id/groups` | 6 | Create node group |
| PATCH | `/traces/:id/groups/:id` | 5 | Edit group |
| DELETE | `/traces/:id/nodes/:id` | 3 | Remove node |
| GET | `/investigations/:id` | 2 | Read investigation |
| POST | `/investigations/:id/traces` | 2 | Create trace |
| GET | `/traces/:id/edges/:id` | 1 | Read edge |

These are the endpoints the dual-auth path must support.

### Current data shape

Trace `data` JSONB structure (the heavy blob):
```json
{
  "nodes": [
    { "id": "uuid", "label": "Sun Main", "address": "0xabc...", "chain": "ethereum",
      "position": { "x": 100, "y": 200 }, "color": "#f59e0b", "shape": "diamond",
      "size": 60, "notes": "...", "tags": [], "parentTrace": "trace-id",
      "addressType": "unknown", "explorerUrl": "https://...", "groupId": "..." }
  ],
  "edges": [
    { "id": "uuid", "from": "node-id-1", "to": "node-id-2", "txHash": "0x...",
      "chain": "ethereum", "timestamp": "1709500000", "amount": "1.5", "token": "ETH",
      "blockNumber": 19000000, "notes": "", "tags": [], "crossTrace": false,
      "color": null, "lineStyle": null, "label": null }
  ],
  "groups": [
    { "id": "uuid", "name": "Exchange Wallets", "color": "#f59e0b", "traceId": "...", "collapsed": false }
  ],
  "edgeBundles": [
    { "id": "uuid", "fromNodeId": "...", "toNodeId": "...", "token": "ETH",
      "collapsed": false, "edgeIds": ["..."], "color": null }
  ]
}
```

Notes:
- Edges use `from`/`to` as **node IDs**, not addresses. Filtering by address requires cross-referencing nodes.
- `addressType`, `crossTrace`, `groupId`, and `blockNumber` are **semantic/forensic** fields, not visual. They must be preserved for agent reasoning.
- `groups` carry user-applied semantic labels. They should be included in a slim form.
- True visual fields (dropped for agent): `position`, `color`, `shape`, `size`, `explorerUrl`, `lineStyle`, `parentTrace`.

### Security model — dual-auth

`AuthGuard` is registered globally via `APP_GUARD` and runs on every route except `@Public()`. Today it requires a Firebase Bearer token. After this change, it accepts either:

- **Firebase Bearer** → verifies the JWT, looks up the user, attaches `req.user` AND `req.principal = { kind: 'user', userId }`.
- **`X-Script-Token`** → verifies HMAC, attaches `req.principal = { kind: 'script', caseId }`. **Does NOT set `req.user`** — keeps `IsAdminGuard` and `CaseMemberGuard` (which both read `req.user`) script-impervious.

Service-layer access checks become mandatory: instead of `if (userId) assertAccess(...)`, every case-scoped service method takes `principal: AccessPrincipal` and unconditionally calls `caseAccess.assertAccess(principal, resourceCaseId)`. The `if (userId)` skip was the original bug — now every authenticated request validates resource ownership.

`assertAccess` semantics:
- **User principal** → check membership row in `case_members`.
- **Script principal** → check `principal.caseId === resourceCaseId`. Reject otherwise.

### Behavior change: `investigationId` removal from `get_case_data`

The current `get_case_data` dispatch overrides the tool's `investigationId` input with the conversation's `investigationId` context (ai.service.ts:478-482). This behavior goes away — `get_case_data` becomes params-less. The new `get_investigation` tool inherits the investigation context instead.

### Why no separate `/script/*` controller

An earlier draft proposed mirroring read endpoints under `/script/*` with their own controller. That added duplication (8 endpoints scripts touch, all already exist) without security benefit (the case-scoped HMAC token is the actual auth control, not the URL prefix). Dual-auth on existing endpoints is simpler and forces the `if (userId)` access-check bug to be fixed properly.

---

## Task 1: Refactor `get_case_data` to lightweight overview

**Files:**
- Modify: `backend/src/modules/ai/tools/tool-definitions.ts`
- Modify: `backend/src/modules/ai/ai.service.ts`
- Modify: `backend/src/modules/ai/ai.module.ts`

### Step 1: Add `TraceEntity` and `DataRoomConnectionEntity` to `AiModule` imports

```typescript
import { TraceEntity } from '../../database/entities/trace.entity';
import { DataRoomConnectionEntity } from '../../database/entities/data-room-connection.entity';

// In TypeOrmModule.forFeature([...]):
TraceEntity,
DataRoomConnectionEntity,
```

### Step 2: Inject the new repos into `AiService`

```typescript
@InjectRepository(TraceEntity)
private readonly traceRepo: Repository<TraceEntity>,
@InjectRepository(DataRoomConnectionEntity)
private readonly dataRoomRepo: Repository<DataRoomConnectionEntity>,
```

### Step 3: Update `GET_CASE_DATA_TOOL` definition

```typescript
export const GET_CASE_DATA_TOOL: Anthropic.Tool = {
  name: 'get_case_data',
  description:
    'Get a high-level overview of this case: investigations (names, trace counts), productions (names, types), and data room connection status. Does NOT return graph data — use get_investigation for that.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};
```

### Step 4: Rewrite `executeCaseDataTool`

```typescript
private async executeCaseDataTool(caseId: string): Promise<unknown> {
  const investigations = await this.investigationRepo.find({
    where: { caseId },
    relations: ['traces'],
    order: { createdAt: 'ASC' },
  });

  const investigationSummaries = investigations.map((inv) => ({
    id: inv.id,
    name: inv.name,
    traceCount: inv.traces.length,
    totalNodes: inv.traces.reduce(
      (sum, t) => sum + ((t.data as any)?.nodes?.length || 0), 0,
    ),
    totalEdges: inv.traces.reduce(
      (sum, t) => sum + ((t.data as any)?.edges?.length || 0), 0,
    ),
  }));

  // userId=undefined — access already verified at conversation level
  const productions = await this.productionsService.findAllForCase(caseId, undefined);
  const productionSummaries = (productions as any[]).map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
  }));

  const drConn = await this.dataRoomRepo.findOneBy({ caseId });
  const dataRoom = drConn
    ? { connected: true, folderName: drConn.folderName, status: drConn.status }
    : { connected: false };

  return { investigations: investigationSummaries, productions: productionSummaries, dataRoom };
}
```

### Step 5: Update the dispatch case

```typescript
case GET_CASE_DATA_TOOL.name: {
  if (!caseId) {
    return { error: 'No case context. Ask the user to select an investigation.' };
  }
  return this.executeCaseDataTool(caseId);
}
```

### Step 6: Verify build

`cd backend && npx tsc --noEmit`

### Step 7: Commit

```bash
git add backend/src/modules/ai/
git commit -m "refactor: slim get_case_data to lightweight case overview"
```

---

## Task 2: Investigation-data utils + `get_investigation` tool

**Files:**
- Create: `backend/src/modules/ai/investigation-data.utils.ts`
- Modify: `backend/src/modules/ai/tools/tool-definitions.ts`
- Modify: `backend/src/modules/ai/tools/index.ts`
- Modify: `backend/src/modules/ai/ai.service.ts`

### Step 1: Create `investigation-data.utils.ts`

Typed interfaces and pure functions. Keeps semantic fields (`addressType`, `crossTrace`, `groupId`, `blockNumber`). Includes slim `groups` and `edgeBundles`. Drops only true visual fields (`position`, `color`, `shape`, `size`, `explorerUrl`, `lineStyle`, `parentTrace`).

```typescript
// backend/src/modules/ai/investigation-data.utils.ts

export interface AgentNode {
  id: string;
  address: string;
  chain: string;
  label: string;
  tags: string[];
  notes?: string;
  addressType?: string;
  groupId?: string;
}

export interface AgentEdge {
  id: string;
  from: string;
  to: string;
  fromAddress: string | null;
  toAddress: string | null;
  txHash: string;
  chain: string;
  timestamp: string;
  amount: string;
  token: string;
  blockNumber?: number;
  tags: string[];
  notes?: string;
  crossTrace?: boolean;
}

export interface AgentGroup {
  id: string;
  name: string;
  nodeIds: string[];
}

export interface AgentEdgeBundle {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  token: string;
  edgeIds: string[];
}

export interface AgentTraceData {
  nodes: AgentNode[];
  edges: AgentEdge[];
  groups: AgentGroup[];
  edgeBundles: AgentEdgeBundle[];
}

export function stripTraceForAgent(data: Record<string, unknown>): AgentTraceData {
  const rawNodes: any[] = (data as any)?.nodes || [];
  const rawEdges: any[] = (data as any)?.edges || [];
  const rawGroups: any[] = (data as any)?.groups || [];
  const rawBundles: any[] = (data as any)?.edgeBundles || [];

  const nodeIdToAddress = new Map<string, string>();
  for (const n of rawNodes) {
    if (n.id && n.address) nodeIdToAddress.set(n.id, n.address);
  }

  const nodes: AgentNode[] = rawNodes.map((n) => ({
    id: n.id,
    address: n.address,
    chain: n.chain,
    label: n.label,
    tags: n.tags ?? [],
    notes: n.notes || undefined,
    addressType: n.addressType || undefined,
    groupId: n.groupId || undefined,
  }));

  const edges: AgentEdge[] = rawEdges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    fromAddress: nodeIdToAddress.get(e.from) ?? null,
    toAddress: nodeIdToAddress.get(e.to) ?? null,
    txHash: e.txHash,
    chain: e.chain,
    timestamp: e.timestamp,
    amount: e.amount,
    token: e.token,
    blockNumber: e.blockNumber || undefined,
    tags: e.tags ?? [],
    notes: e.notes || undefined,
    crossTrace: e.crossTrace || undefined,
  }));

  const groupNodeIds = new Map<string, string[]>();
  for (const n of rawNodes) {
    if (n.groupId) {
      const list = groupNodeIds.get(n.groupId) || [];
      list.push(n.id);
      groupNodeIds.set(n.groupId, list);
    }
  }
  const groups: AgentGroup[] = rawGroups.map((g) => ({
    id: g.id,
    name: g.name,
    nodeIds: groupNodeIds.get(g.id) || [],
  }));

  const edgeBundles: AgentEdgeBundle[] = rawBundles.map((b) => ({
    id: b.id,
    fromNodeId: b.fromNodeId,
    toNodeId: b.toNodeId,
    token: b.token,
    edgeIds: b.edgeIds ?? [],
  }));

  return { nodes, edges, groups, edgeBundles };
}

export function filterTraceData(
  data: AgentTraceData,
  address?: string,
  token?: string,
): AgentTraceData {
  if (!address && !token) return data;

  let { nodes, edges, groups, edgeBundles } = data;

  const addressMatchIds = new Set<string>();
  if (address) {
    const addr = address.toLowerCase();
    for (const n of nodes) {
      if (n.address?.toLowerCase() === addr) addressMatchIds.add(n.id);
    }
    edges = edges.filter(
      (e) => addressMatchIds.has(e.from) || addressMatchIds.has(e.to),
    );
  }

  if (token) {
    const tok = token.toLowerCase();
    edges = edges.filter((e) => e.token?.toLowerCase() === tok);
  }

  const edgeNodeIds = new Set(edges.flatMap((e) => [e.from, e.to]));
  const keepNodeIds = new Set([...addressMatchIds, ...edgeNodeIds]);
  nodes = nodes.filter((n) => keepNodeIds.has(n.id));

  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const edgeIdSet = new Set(edges.map((e) => e.id));

  groups = groups
    .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => nodeIdSet.has(id)) }))
    .filter((g) => g.nodeIds.length > 0);

  edgeBundles = edgeBundles
    .map((b) => ({ ...b, edgeIds: b.edgeIds.filter((id) => edgeIdSet.has(id)) }))
    .filter((b) => b.edgeIds.length > 0);

  return { nodes, edges, groups, edgeBundles };
}
```

### Step 2: Define and register `GET_INVESTIGATION_TOOL`

```typescript
export const GET_INVESTIGATION_TOOL: Anthropic.Tool = {
  name: 'get_investigation',
  description:
    'Query investigation data. Without investigationId: returns summaries of all investigations (per-trace node/edge counts). With investigationId: returns full graph data (nodes, edges, groups, bundles — visual metadata stripped, edges denormalized with addresses). Optional address and token filters narrow the result. For very large datasets, prefer execute_script that fetches data via the local API and processes it without entering the conversation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      investigationId: { type: 'string', description: 'Investigation ID. Omit for summaries.' },
      address: { type: 'string', description: 'Filter to nodes matching this address and their incident edges.' },
      token: { type: 'string', description: 'Filter to edges with this token symbol (e.g. "ETH", "USDT").' },
    },
    required: [],
  },
};
```

Add to `tools/index.ts` exports and the `AGENT_TOOLS` array (after `GET_CASE_DATA_TOOL`).

### Step 3: Implement `executeInvestigationTool`

```typescript
import { stripTraceForAgent, filterTraceData } from './investigation-data.utils';
import { GET_INVESTIGATION_TOOL } from './tools';

// Dispatch:
case GET_INVESTIGATION_TOOL.name: {
  if (!caseId) {
    return { error: 'No case context. Ask the user to select an investigation.' };
  }
  const input = toolUse.input as {
    investigationId?: string;
    address?: string;
    token?: string;
  };
  return this.executeInvestigationTool(caseId, input, investigationId);
}

// Method:
private async executeInvestigationTool(
  caseId: string,
  input: { investigationId?: string; address?: string; token?: string },
  contextInvestigationId?: string,
): Promise<unknown> {
  const invId = input.investigationId || contextInvestigationId;

  if (!invId) {
    const investigations = await this.investigationRepo.find({
      where: { caseId },
      relations: ['traces'],
      order: { createdAt: 'ASC' },
    });
    return investigations.map((inv) => ({
      id: inv.id,
      name: inv.name,
      notes: inv.notes,
      traces: inv.traces.map((t) => ({
        id: t.id,
        name: t.name,
        nodeCount: ((t.data as any)?.nodes?.length) || 0,
        edgeCount: ((t.data as any)?.edges?.length) || 0,
      })),
    }));
  }

  const investigation = await this.investigationRepo.findOne({
    where: { id: invId, caseId },
    relations: ['traces'],
  });
  if (!investigation) return { error: `Investigation ${invId} not found` };

  const traces = investigation.traces.map((t) => {
    const stripped = stripTraceForAgent(t.data);
    const filtered = filterTraceData(stripped, input.address, input.token);
    return { id: t.id, name: t.name, ...filtered };
  });

  return { id: investigation.id, name: investigation.name, notes: investigation.notes, traces };
}
```

### Step 4: Verify build + commit

```bash
cd backend && npx tsc --noEmit
git add backend/src/modules/ai/
git commit -m "feat: add get_investigation tool with address/token filtering"
```

---

## Task 3: `AccessPrincipal` + `ScriptTokenService`

**Files:**
- Create: `backend/src/modules/auth/access-principal.ts`
- Modify: `backend/src/modules/auth/case-access.service.ts`
- Create: `backend/src/modules/script/script-token.service.ts`
- Create: `backend/src/modules/script/script.module.ts`
- Modify: `backend/src/app.module.ts`

### Step 1: `AccessPrincipal` type + helper

```typescript
// backend/src/modules/auth/access-principal.ts
import { ForbiddenException } from '@nestjs/common';

export type AccessPrincipal =
  | { kind: 'user'; userId: string }
  | { kind: 'script'; caseId: string };

/**
 * Read the principal off a request. Throws if neither auth path attached one
 * — every authenticated request must have a principal.
 */
export function getPrincipal(req: any): AccessPrincipal {
  const p = req?.principal as AccessPrincipal | undefined;
  if (!p) {
    throw new ForbiddenException('No access principal on request');
  }
  return p;
}
```

### Step 2: `CaseAccessService.assertAccess` takes a principal

```typescript
// backend/src/modules/auth/case-access.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { AccessPrincipal } from './access-principal';

@Injectable()
export class CaseAccessService {
  constructor(
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
  ) {}

  /**
   * Assert that the principal can access the given case.
   * - User principal: must be a member of the case.
   * - Script principal: token's caseId must match the resource's caseId.
   * Throws ForbiddenException on mismatch.
   */
  async assertAccess(
    principal: AccessPrincipal,
    caseId: string,
  ): Promise<CaseMemberEntity | null> {
    if (principal.kind === 'script') {
      if (principal.caseId !== caseId) {
        throw new ForbiddenException('cross_case_access');
      }
      return null;
    }
    const membership = await this.memberRepo.findOneBy({
      userId: principal.userId,
      caseId,
    });
    if (!membership) {
      throw new ForbiddenException('You do not have access to this case');
    }
    return membership;
  }
}
```

### Step 3: `ScriptTokenService` (HMAC sign/verify)

```typescript
// backend/src/modules/script/script-token.service.ts
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const TOKEN_TTL_MS = 60_000; // scripts timeout at 30s, give 60s slack

@Injectable()
export class ScriptTokenService {
  private readonly key = crypto.randomBytes(32);

  sign(caseId: string): string {
    const ts = Date.now();
    const hmac = crypto
      .createHmac('sha256', this.key)
      .update(`${caseId}|${ts}`)
      .digest('hex');
    return Buffer.from(`${caseId}.${ts}.${hmac}`, 'utf8').toString('base64url');
  }

  verify(token: string): { caseId: string } | null {
    let decoded: string;
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const parts = decoded.split('.');
    if (parts.length !== 3) return null;
    const [caseId, tsStr, hmacHex] = parts;
    const ts = Number(tsStr);
    if (!caseId || !Number.isFinite(ts) || !hmacHex) return null;

    const expected = crypto
      .createHmac('sha256', this.key)
      .update(`${caseId}|${ts}`)
      .digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(hmacHex, 'hex');
    } catch {
      return null;
    }
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      return null;
    }
    if (Date.now() - ts > TOKEN_TTL_MS) return null;
    return { caseId };
  }
}
```

### Step 4: `ScriptModule`

```typescript
// backend/src/modules/script/script.module.ts
import { Module } from '@nestjs/common';
import { ScriptTokenService } from './script-token.service';

@Module({
  providers: [ScriptTokenService],
  exports: [ScriptTokenService],
})
export class ScriptModule {}
```

### Step 5: Register in `AppModule`

```typescript
import { ScriptModule } from './modules/script/script.module';

// In imports[]:
ScriptModule,
```

### Step 6: Verify build + commit

```bash
cd backend && npx tsc --noEmit
git add backend/src/modules/auth/access-principal.ts \
        backend/src/modules/auth/case-access.service.ts \
        backend/src/modules/script/ \
        backend/src/app.module.ts
git commit -m "feat: AccessPrincipal type + ScriptTokenService

assertAccess now accepts either a user or a script principal. Script
principals are case-scoped via HMAC-signed tokens (per-process random
key, 60s TTL)."
```

---

## Task 4: Dual-auth in `AuthGuard`

**Files:**
- Modify: `backend/src/modules/auth/auth.guard.ts`
- Modify: `backend/src/modules/auth/auth.module.ts`

### Step 1: Import `ScriptModule` into `AuthModule`

```typescript
// backend/src/modules/auth/auth.module.ts
import { ScriptModule } from '../script/script.module';

// In imports[]:
ScriptModule,
```

### Step 2: Update `AuthGuard` to accept either auth path

Replace the body of `canActivate` after the `@Public()` short-circuit:

```typescript
import { ScriptTokenService } from '../script/script-token.service';
import { AccessPrincipal } from './access-principal';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(FIREBASE_ADMIN) private readonly firebaseApp: admin.app.App,
    private readonly usersService: UsersService,
    private readonly reflector: Reflector,
    private readonly scriptToken: ScriptTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();

    // --- Path 1: script token ---
    const scriptHeader = request.headers['x-script-token'];
    if (scriptHeader) {
      const result = this.scriptToken.verify(
        Array.isArray(scriptHeader) ? scriptHeader[0] : scriptHeader,
      );
      if (!result) throw new UnauthorizedException('invalid_script_token');
      const principal: AccessPrincipal = { kind: 'script', caseId: result.caseId };
      request.principal = principal;
      // NOTE: do NOT set request.user — keeps IsAdminGuard / CaseMemberGuard
      // (which both read request.user) impervious to script tokens.
      console.log(
        `[script-auth] ${request.method} ${request.url} caseId=${result.caseId}`,
      );
      return true;
    }

    // --- Path 2: Firebase Bearer ---
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    const token = authHeader.slice(7);

    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await this.firebaseApp.auth().verifyIdToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    let user = await this.usersService.findByFirebaseUid(decoded.uid);
    if (!user && decoded.email) {
      user = await this.usersService.findByEmail(decoded.email);
      if (user) {
        user = await this.usersService.linkFirebaseUid(user.id, decoded.uid, {
          name: decoded.name || user.name,
          avatarUrl: decoded.picture || null,
        });
      }
    }
    if (!user) {
      throw new ForbiddenException({
        code: 'NO_ACCOUNT',
        message: `No account found for ${decoded.email}. Contact your administrator.`,
      });
    }

    request.user = user;
    request.principal = { kind: 'user', userId: user.id } satisfies AccessPrincipal;
    return true;
  }
}
```

### Step 3: Verify build + commit

```bash
cd backend && npx tsc --noEmit
git add backend/src/modules/auth/
git commit -m "feat: AuthGuard accepts X-Script-Token (case-scoped) or Firebase Bearer

Either path attaches an AccessPrincipal to the request. Script tokens
do NOT populate req.user, preserving IsAdminGuard isolation. Structured
log emitted on every script-path request for audit."
```

---

## Task 5: Refactor traces + investigations to use `AccessPrincipal`

**Files:**
- Modify: `backend/src/modules/traces/traces.{controller,service}.ts`
- Modify: `backend/src/modules/investigations/investigations.{controller,service}.ts`

### Step 1: `TracesService` — replace `userId?:` with `principal: AccessPrincipal`

Every method changes from:

```typescript
async findOne(id: string, userId?: string) {
  const trace = await this.repo.findOneBy({ id });
  if (!trace) throw new NotFoundException(`Trace ${id} not found`);
  if (userId) {
    const inv = await this.invRepo.findOneBy({ id: trace.investigationId });
    if (inv) await this.caseAccess.assertAccess(userId, inv.caseId);
  }
  return trace;
}
```

To:

```typescript
async findOne(id: string, principal: AccessPrincipal) {
  const trace = await this.repo.findOneBy({ id });
  if (!trace) throw new NotFoundException(`Trace ${id} not found`);
  const inv = await this.invRepo.findOneBy({ id: trace.investigationId });
  if (!inv) throw new NotFoundException(`Investigation ${trace.investigationId} not found`);
  await this.caseAccess.assertAccess(principal, inv.caseId);
  return trace;
}
```

Apply to all methods: `findAllForInvestigation`, `findOne`, `create`, `update`, `remove`, `updateNode`, `updateEdge`, `deleteNode`, `deleteEdge`, `createGroup`, `updateGroup`, `deleteGroup`, `listEdgeBundles`, `deleteEdgeBundle`, `importTransactions`. The `if (userId)` guard is removed everywhere — `assertAccess` is always called.

### Step 2: `TracesController` — extract principal and forward

```typescript
import { getPrincipal } from '../auth/access-principal';

// Each handler:
@Get('traces/:id')
findOne(@Param('id') id: string, @Req() req: any) {
  return this.service.findOne(id, getPrincipal(req));
}
```

Apply to all handlers.

### Step 3: Same refactor for `InvestigationsService` + `InvestigationsController`

Mirror the pattern. Inspect existing methods and replace `userId?:` with `principal: AccessPrincipal`; remove `if (userId)` skips.

### Step 4: Verify build + run existing tests

```bash
cd backend && npx tsc --noEmit
cd backend && npx jest --testPathPattern '(traces|investigations)\.service\.spec'
```

Existing service tests will fail because the signature changed. Update them to pass a principal — typically `{ kind: 'user', userId: 'u1' }`.

### Step 5: Commit

```bash
git add backend/src/modules/traces/ backend/src/modules/investigations/
git commit -m "refactor: traces + investigations use AccessPrincipal

Mandatory access checks via assertAccess (drops the if (userId) skip
that masked auth bypass when req.user was missing). Both user and
script principals supported."
```

---

## Task 6: Loopback env flag + token injection in fetch bridge

**Files:**
- Modify: `backend/src/modules/ai/services/script-execution.service.ts`
- Modify: `backend/src/modules/ai/ai.service.ts`
- Modify: `backend/src/modules/ai/ai.module.ts`

### Step 1: Gate loopback with `SCRIPT_ALLOW_LOOPBACK`

```typescript
// OLD:
const isProd = this.configService.get<string>('NODE_ENV') === 'production';
const loopback = isProd ? [] : LOOPBACK_DOMAINS;

// NEW:
const allowLoopback =
  this.configService.get<string>('NODE_ENV') !== 'production' ||
  this.configService.get<string>('SCRIPT_ALLOW_LOOPBACK') === 'true';
const loopback = allowLoopback ? LOOPBACK_DOMAINS : [];
```

Update comment on `LOOPBACK_DOMAINS`:

```typescript
/**
 * Loopback — allows scripts to call the local backend API.
 * Enabled by default in dev. In production, requires SCRIPT_ALLOW_LOOPBACK=true.
 */
const LOOPBACK_DOMAINS = ['localhost', '127.0.0.1'];
```

### Step 2: Inject `ScriptTokenService` and accept `caseId`

```typescript
import { ScriptTokenService } from '../../script/script-token.service';

// Add to constructor:
private readonly scriptToken: ScriptTokenService,

// New execute signature:
async execute(
  investigationId: string,
  caseId: string,
  name: string,
  code: string,
): Promise<ScriptResult & { savedRun: ScriptRunEntity }> {
  const token = this.scriptToken.sign(caseId);
  const result = await this.runInIsolate(code, token);

  const savedRun = await this.scriptRunRepo.save(
    this.scriptRunRepo.create({
      investigationId, name, code,
      output: result.output,
      status: result.status,
      durationMs: result.durationMs,
    }),
  );
  return { ...result, savedRun };
}
```

Thread `scriptToken` through `runInIsolate(code, scriptToken?)` and `executeInContext(isolate, code, start, scriptToken?)`.

### Step 3: Inject `X-Script-Token` header on localhost requests

In the `_fetchBridge` callback, after `opts.redirect = 'error'`:

```typescript
const parsed = new URL(url);
if (LOOPBACK_DOMAINS.includes(parsed.hostname) && scriptToken) {
  opts.headers = {
    ...(opts.headers || {}),
    'X-Script-Token': scriptToken,
  };
}
```

### Step 4: Update `AiService` to pass `caseId`

```typescript
case EXECUTE_SCRIPT_TOOL.name: {
  if (!investigationId || !caseId) {
    return { error: 'No investigation context. Ask the user to select an investigation.' };
  }
  const { name, code } = toolUse.input as { name: string; code: string };
  return this.scriptExecutionService.execute(investigationId, caseId, name, code);
}
```

### Step 5: Update `AiModule` to import `ScriptModule`

```typescript
import { ScriptModule } from '../script/script.module';

// In imports[]:
ScriptModule,
```

### Step 6: Verify build + commit

```bash
cd backend && npx tsc --noEmit
git add backend/src/modules/ai/
git commit -m "feat: SCRIPT_ALLOW_LOOPBACK env flag + X-Script-Token injection

Sandbox signs a case-scoped token before each run. Bridge injects
X-Script-Token header on localhost requests; script code never sees it.
Loopback is gated by env flag in production."
```

---

## Task 7: Update system prompt and skills

**Files:**
- Modify: `backend/src/prompts/investigator.ts`
- Modify: `backend/src/skills/graph-mutations.md`
- Modify: `backend/src/skills/product-knowledge.md`

### Step 1: Update the system prompt

In `investigator.ts`:

**Edit 1** — Replace the `get_case_data` line:

```
// OLD:
- get_case_data: fetch the investigation graph for this case (wallet nodes, transaction edges, traces)

// NEW:
- get_case_data: get a high-level case overview (investigation names and trace counts, productions, data room status). Does NOT return graph data.
- get_investigation: query investigation data. No params = summaries of all investigations. With investigationId = full graph data (visual metadata stripped, edges denormalized with addresses). Optional address/token filters narrow the result.
```

**Edit 2** — Append after the multi-API-call guidelines:

```
- Start with get_case_data to orient. Then use get_investigation to drill in.
- For analytical reasoning, use get_investigation with address/token filters.
- For mechanical processing (sums, aggregations, statistics), prefer execute_script. Scripts can call the local API directly (e.g. GET {API_URL}/traces/{id} or POST {API_URL}/traces/{id}/import-transactions) and process data without it entering the conversation.
- When the user asks for totals or aggregated numbers, default to a script.
```

### Step 2: Update `graph-mutations.md`

Add a section at the top, before "## Import Endpoint":

```markdown
## Reading Investigation Data from Scripts

Scripts can read investigation and trace data directly from the local API. Auth is handled automatically via an injected `X-Script-Token` — just call the endpoints.

### Read a trace (full data)

` ` `js
const API_URL = process.env.API_URL;
const TRACE_ID = 'TRACE_ID_HERE';

const res = await fetch(`${API_URL}/traces/${TRACE_ID}`);
const trace = await res.json();
const nodes = trace.data.nodes || [];
const edges = trace.data.edges || [];

// Example: sum ETH transactions
const ethTotal = edges
  .filter(e => e.token === 'ETH')
  .reduce((sum, e) => sum + parseFloat(e.amount), 0);
console.log(`Total ETH flow: ${ethTotal}`);
` ` `

### Read an investigation (with all traces)

` ` `js
const res = await fetch(`${API_URL}/investigations/${INVESTIGATION_ID}`);
const inv = await res.json();
// inv.traces[] — IDs and names. Fetch /traces/:id for full data.
` ` `

### When to use scripts vs get_investigation

| Scenario | Use |
|----------|-----|
| Quick look at an address's activity | `get_investigation` with `address` filter |
| Identify patterns or suspicious flows | `get_investigation` with filters |
| Sum amounts, compute balances | Script |
| Generate chart/report from data | Script to compute, then `create_production` |
| Process 100+ edges | Script — data stays server-side |
```

(Triple-backtick fences shown with spaces; remove when implementing.)

The existing "## Import Endpoint" section requires no change — its examples already use `${API_URL}/traces/{id}/import-transactions`.

### Step 3: Update `product-knowledge.md`

Update the "AI Assistant" section's capabilities list:

```
- **Get case overview** — see investigations, productions, data room status with `get_case_data`
- **Query investigation data** — drill into specific investigations with `get_investigation`, optionally filtering by address or token
- **Run scripts** — JavaScript in a sandboxed V8 isolate. Scripts can read AND mutate via the local API (`/traces/:id`, `/traces/:id/import-transactions`, etc.) without data entering the conversation
```

### Step 4: Commit

```bash
git add backend/src/prompts/investigator.ts backend/src/skills/
git commit -m "docs: update prompt and skills for new data access workflow"
```

---

## Task 8: Tests

**Files:**
- Create: `backend/src/modules/ai/investigation-data.utils.spec.ts`
- Create: `backend/src/modules/script/script-token.service.spec.ts`
- Create: `backend/src/modules/auth/case-access.service.spec.ts`
- Create: `backend/src/modules/auth/auth.guard.spec.ts`
- Update: existing `traces`/`investigations` service specs to pass `AccessPrincipal`

### Step 1: Strip/filter unit tests

`investigation-data.utils.spec.ts` — covers semantic field preservation, visual field stripping, address filter (including isolated nodes), token filter, group/bundle pruning, case-insensitivity. (Test bodies as in the previous plan revision.)

### Step 2: `ScriptTokenService` tests

```typescript
describe('ScriptTokenService', () => {
  let service: ScriptTokenService;
  beforeEach(() => { service = new ScriptTokenService(); });

  it('round-trips', () => {
    expect(service.verify(service.sign('case-1'))).toEqual({ caseId: 'case-1' });
  });
  it('rejects tampered token', () => {
    const t = service.sign('case-1');
    expect(service.verify(t.slice(0, -3) + 'xxx')).toBeNull();
  });
  it('rejects token from a different instance', () => {
    expect(service.verify(new ScriptTokenService().sign('case-1'))).toBeNull();
  });
  it('rejects expired token', () => {
    const t = service.sign('case-1');
    const real = Date.now;
    Date.now = () => real() + 61_000;
    try { expect(service.verify(t)).toBeNull(); } finally { Date.now = real; }
  });
  it('rejects garbage', () => {
    expect(service.verify('')).toBeNull();
    expect(service.verify('not-a-token')).toBeNull();
  });
});
```

### Step 3: `CaseAccessService` tests

```typescript
describe('CaseAccessService.assertAccess', () => {
  let service: CaseAccessService;
  const memberRepo = { findOneBy: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CaseAccessService(memberRepo as any);
  });

  it('user principal: returns membership when found', async () => {
    memberRepo.findOneBy.mockResolvedValue({ userId: 'u1', caseId: 'c1' });
    await expect(
      service.assertAccess({ kind: 'user', userId: 'u1' }, 'c1'),
    ).resolves.toBeTruthy();
  });
  it('user principal: throws when not a member', async () => {
    memberRepo.findOneBy.mockResolvedValue(null);
    await expect(
      service.assertAccess({ kind: 'user', userId: 'u1' }, 'c1'),
    ).rejects.toThrow();
  });
  it('script principal: passes when caseId matches', async () => {
    await expect(
      service.assertAccess({ kind: 'script', caseId: 'c1' }, 'c1'),
    ).resolves.toBeNull();
  });
  it('script principal: throws on cross-case', async () => {
    await expect(
      service.assertAccess({ kind: 'script', caseId: 'c1' }, 'c2'),
    ).rejects.toThrow('cross_case_access');
  });
});
```

### Step 4: `AuthGuard` integration test

Build a NestJS testing module wiring `AuthGuard` with mocked `firebaseApp`, `usersService`, `reflector`, and a real `ScriptTokenService`. Test:

- Missing both headers → 401
- Valid `X-Script-Token` → `req.principal.kind === 'script'`, `req.user` undefined
- Invalid `X-Script-Token` → 401 (does not fall through to Firebase path)
- Valid Firebase token → `req.principal.kind === 'user'`, `req.user` populated

### Step 5: Update existing service specs

The `traces` and `investigations` service specs pass `'user-1'` as the `userId` parameter. Mechanically replace with `{ kind: 'user' as const, userId: 'user-1' }`.

### Step 6: Run all tests

```bash
cd backend && npx jest --testPathPattern '(investigation-data|script-token|case-access|auth\.guard|traces\.service|investigations\.service)'
```

### Step 7: Commit

```bash
git add backend/src/
git commit -m "test: cover dual-auth, principal-based access, strip/filter utils"
```

---

## Task 9: End-to-end verification

### Step 1: Start backend

`npm run be` — confirms boot with the dual-auth `AuthGuard`.

### Step 2: Confirm script auth works in dev

In a chat, ask the agent to import some test transactions. Watch for:

- A `[script-auth] POST /traces/<id>/import-transactions caseId=<id>` log line.
- A 200 response in the script's output.
- The graph updates in the UI.

### Step 3: Confirm cross-case rejection

In the agent's script, manually fetch a trace from a different case (substitute a known foreign trace ID). Expect a 403 with `cross_case_access` in the body.

### Step 4: Confirm admin endpoints stay locked

In the agent's script:

```js
const r = await fetch(`${process.env.API_URL}/admin/cases`);
console.log(r.status); // expect 403
```

### Step 5: Confirm Firebase auth still works for users

Open the frontend, sign in, navigate to a case, mutate a trace — should work identically to before.

### Step 6: Final commit

```bash
git add -A
git commit -m "feat: agent data access redesign — overview tools + dual-auth scripts"
```
