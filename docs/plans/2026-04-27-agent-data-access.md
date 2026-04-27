# Agent Data Access Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent the AI agent from blowing its context window by redesigning how it accesses investigation data — lightweight overview by default, targeted queries when needed, and script-based processing for mechanical tasks.

**Architecture:** Split the monolithic `get_case_data` into two tools: a cheap case overview (`get_case_data`) and a queryable investigation reader (`get_investigation`) with address/token filtering. Add case-scoped, HMAC-authenticated `/script/` endpoints so agent scripts can read investigation data without it passing through the LLM context. Gate localhost access behind an env flag (`SCRIPT_ALLOW_LOOPBACK`).

**Tech Stack:** NestJS, TypeORM, isolated-vm (script sandbox), Anthropic Claude tool use

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Slim `get_case_data` to overview-only, add `get_investigation` tool definition |
| 2 | `backend/src/modules/ai/tools/index.ts` | Modify | Export new `GET_INVESTIGATION_TOOL` |
| 3 | `backend/src/modules/ai/investigation-data.utils.ts` | Create | Pure functions for stripping visual metadata and filtering trace data, with typed interfaces |
| 4 | `backend/src/modules/ai/ai.service.ts` | Modify | Implement overview, investigation query with filtering, pass caseId to script execution |
| 5 | `backend/src/modules/ai/ai.module.ts` | Modify | Import `TraceEntity`, `DataRoomConnectionEntity`, and `ScriptModule` |
| 6 | `backend/src/modules/script/script-token.service.ts` | Create | HMAC sign/verify for case-scoped script tokens (per-process random key) |
| 7 | `backend/src/modules/script/script-token.guard.ts` | Create | NestJS guard — validates `X-Script-Token` header, attaches `caseId` to request |
| 8 | `backend/src/modules/script/script.controller.ts` | Create | Script-facing read endpoints, guarded by `ScriptTokenGuard`, case-scoped access checks |
| 9 | `backend/src/modules/script/script.module.ts` | Create | Module registration, exports `ScriptTokenService` |
| 10 | `backend/src/app.module.ts` | Modify | Register `ScriptModule` |
| 11 | `backend/src/modules/ai/services/script-execution.service.ts` | Modify | `SCRIPT_ALLOW_LOOPBACK` env flag, accept `caseId`, sign token, inject `X-Script-Token` into localhost fetch calls |
| 12 | `backend/src/prompts/investigator.ts` | Modify | Teach agent the new two-tool workflow + script-first for heavy processing |
| 13 | `backend/src/skills/graph-mutations.md` | Modify | Add script patterns for reading investigation data via local API |
| 14 | `backend/src/skills/product-knowledge.md` | Modify | Document new data access tools and workflow |

---

## Background

### Problem

`get_case_data` returns the full JSONB `data` blob for every trace in the case — all nodes, edges, positions, colors, groups. For a case with 122 nodes and 305 edges across 3 traces, this is tens of thousands of tokens. The agent loads it all into context, leaving no room to reason or act.

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

### Behavior change: `investigationId` removal from `get_case_data`

The current `get_case_data` dispatch overrides the tool's `investigationId` input with the conversation's `investigationId` context (ai.service.ts:478-482). This behavior goes away — `get_case_data` becomes params-less. The new `get_investigation` tool inherits the investigation context instead.

---

## Task 1: Refactor `get_case_data` to lightweight overview

**Files:**
- Modify: `backend/src/modules/ai/tools/tool-definitions.ts`
- Modify: `backend/src/modules/ai/ai.service.ts`
- Modify: `backend/src/modules/ai/ai.module.ts`

### Step 1: Add `TraceEntity` and `DataRoomConnectionEntity` to `AiModule` imports

The overview needs trace counts and data room status. In `ai.module.ts`, add to the `TypeOrmModule.forFeature` array and imports:

```typescript
import { TraceEntity } from '../../database/entities/trace.entity';
import { DataRoomConnectionEntity } from '../../database/entities/data-room-connection.entity';

// In @Module TypeOrmModule.forFeature array, add:
TraceEntity,
DataRoomConnectionEntity,
```

### Step 2: Inject the new repos into `AiService`

In `ai.service.ts`, add to constructor:

```typescript
import { TraceEntity } from '../../database/entities/trace.entity';
import { DataRoomConnectionEntity } from '../../database/entities/data-room-connection.entity';

// In constructor:
@InjectRepository(TraceEntity)
private readonly traceRepo: Repository<TraceEntity>,
@InjectRepository(DataRoomConnectionEntity)
private readonly dataRoomRepo: Repository<DataRoomConnectionEntity>,
```

### Step 3: Update `GET_CASE_DATA_TOOL` definition

In `tool-definitions.ts`, replace the existing definition. Remove the `investigationId` property — this tool is now always case-level:

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

Replace the existing method in `ai.service.ts`. Note: `productionsService.findAllForCase` accepts `(caseId, userId?, type?)` — we pass `undefined` for userId since access is already verified at the conversation level:

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

In the `executeTool` switch, simplify. The old code forwarded `investigationId` context — this behavior now lives in `get_investigation`:

```typescript
// OLD (remove):
case GET_CASE_DATA_TOOL.name: {
  if (!caseId) {
    return { error: 'No case context. Ask the user to select an investigation.' };
  }
  const toolInput = toolUse.input as { investigationId?: string };
  return this.executeCaseDataTool(
    caseId,
    investigationId ? { investigationId } : toolInput,
  );
}

// NEW:
case GET_CASE_DATA_TOOL.name: {
  if (!caseId) {
    return { error: 'No case context. Ask the user to select an investigation.' };
  }
  return this.executeCaseDataTool(caseId);
}
```

### Step 6: Verify build

Run: `cd backend && npx tsc --noEmit`
Expected: Clean.

### Step 7: Commit

```bash
git add backend/src/modules/ai/
git commit -m "refactor: slim get_case_data to lightweight case overview

Returns investigation summaries (trace counts), production list, and
data room status. No graph data — get_investigation handles that now.
Removes investigationId param; that context-override behavior moves to
the new get_investigation tool."
```

---

## Task 2: Add typed utils + `get_investigation` tool

**Files:**
- Create: `backend/src/modules/ai/investigation-data.utils.ts`
- Modify: `backend/src/modules/ai/tools/tool-definitions.ts`
- Modify: `backend/src/modules/ai/tools/index.ts`
- Modify: `backend/src/modules/ai/ai.service.ts`

### Step 1: Create `investigation-data.utils.ts`

Typed interfaces and pure functions for stripping and filtering. Keeps semantic fields (`addressType`, `crossTrace`, `groupId`, `blockNumber`). Includes slim `groups` and `edgeBundles`. Only drops true visual fields (`position`, `color`, `shape`, `size`, `explorerUrl`, `lineStyle`, `parentTrace`).

```typescript
// backend/src/modules/ai/investigation-data.utils.ts

// ---- Types ----

/** Node fields preserved for agent reasoning. */
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

/** Edge fields preserved for agent reasoning. Denormalized with addresses. */
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

/** Slim group — visual fields (color, collapsed) dropped. */
export interface AgentGroup {
  id: string;
  name: string;
  nodeIds: string[];
}

/** Slim edge bundle — visual fields (collapsed, color) dropped. */
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

// ---- Strip ----

/**
 * Strip visual metadata from raw trace JSONB. Keep semantic/forensic fields.
 * Denormalize edges with `fromAddress`/`toAddress` so the agent doesn't need
 * to cross-reference node IDs manually.
 *
 * Dropped (visual only): position, color, shape, size, explorerUrl, lineStyle, parentTrace.
 * Kept (semantic): addressType, crossTrace, groupId, blockNumber, tags, notes.
 */
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

  // Groups: derive nodeIds from nodes that reference this groupId
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

// ---- Filter ----

/**
 * Filter trace data by address and/or token.
 *
 * Address filter matches **nodes first** (by address), then pulls their
 * incident edges. A node with zero edges still appears in the result.
 * Token filter narrows edges by token symbol.
 * Groups and edge bundles are pruned to only reference surviving nodes/edges.
 *
 * Returns everything when no filters are provided.
 */
export function filterTraceData(
  data: AgentTraceData,
  address?: string,
  token?: string,
): AgentTraceData {
  if (!address && !token) return data;

  let { nodes, edges, groups, edgeBundles } = data;

  // Step 1: address filter — match nodes, pull incident edges
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

  // Step 2: token filter
  if (token) {
    const tok = token.toLowerCase();
    edges = edges.filter((e) => e.token?.toLowerCase() === tok);
  }

  // Step 3: determine surviving nodes — address matches + edge-connected
  const edgeNodeIds = new Set(edges.flatMap((e) => [e.from, e.to]));
  const keepNodeIds = new Set([...addressMatchIds, ...edgeNodeIds]);
  nodes = nodes.filter((n) => keepNodeIds.has(n.id));

  // Step 4: prune groups and bundles
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

### Step 2: Define the tool

In `tool-definitions.ts`, add after `GET_CASE_DATA_TOOL`:

```typescript
export const GET_INVESTIGATION_TOOL: Anthropic.Tool = {
  name: 'get_investigation',
  description:
    'Query investigation data. Without investigationId: returns summaries of all investigations (per-trace node/edge counts). With investigationId: returns full graph data for that investigation (nodes, edges, groups, bundles — visual metadata stripped, edges denormalized with addresses). Optional address and token filters narrow the result to matching nodes/edges. For large datasets, prefer writing a script with execute_script that fetches data from the local API and processes it — this keeps data out of the conversation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      investigationId: {
        type: 'string',
        description: 'Investigation ID. Omit to get summaries of all investigations in the case.',
      },
      address: {
        type: 'string',
        description: 'Filter: only nodes matching this address and their incident edges. Requires investigationId.',
      },
      token: {
        type: 'string',
        description: 'Filter: only edges for this token symbol (e.g. "ETH", "USDT", "TRX"). Requires investigationId.',
      },
    },
    required: [],
  },
};
```

### Step 3: Export and register the tool

In `tools/index.ts`, add `GET_INVESTIGATION_TOOL` to the exports and `AGENT_TOOLS` array (insert after `GET_CASE_DATA_TOOL`).

### Step 4: Implement `executeInvestigationTool`

In `ai.service.ts`, import the utils and add the dispatch + method:

```typescript
import { stripTraceForAgent, filterTraceData } from './investigation-data.utils';
import { GET_INVESTIGATION_TOOL } from './tools';
```

Dispatch case (add after `get_case_data`):

```typescript
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
```

Method:

```typescript
private async executeInvestigationTool(
  caseId: string,
  input: { investigationId?: string; address?: string; token?: string },
  contextInvestigationId?: string,
): Promise<unknown> {
  const invId = input.investigationId || contextInvestigationId;

  // No investigationId → summary of all investigations
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

  // With investigationId — load and optionally filter
  const investigation = await this.investigationRepo.findOne({
    where: { id: invId, caseId },
    relations: ['traces'],
  });
  if (!investigation) {
    return { error: `Investigation ${invId} not found` };
  }

  const traces = investigation.traces.map((t) => {
    const stripped = stripTraceForAgent(t.data);
    const filtered = filterTraceData(stripped, input.address, input.token);
    return { id: t.id, name: t.name, ...filtered };
  });

  return {
    id: investigation.id,
    name: investigation.name,
    notes: investigation.notes,
    traces,
  };
}
```

### Step 5: Verify build

Run: `cd backend && npx tsc --noEmit`

### Step 6: Commit

```bash
git add backend/src/modules/ai/
git commit -m "feat: add get_investigation tool with address/token filtering

Three tiers: no params = summaries, investigationId = full data (visual
metadata stripped, edges denormalized, groups/bundles included),
investigationId + address/token = filtered subset.

Address filter matches nodes first (isolated nodes still appear), then
pulls incident edges. Typed interfaces replace any[] casts."
```

---

## Task 3: Script token auth + script-facing endpoints

**Files:**
- Create: `backend/src/modules/script/script-token.service.ts`
- Create: `backend/src/modules/script/script-token.guard.ts`
- Create: `backend/src/modules/script/script.controller.ts`
- Create: `backend/src/modules/script/script.module.ts`
- Modify: `backend/src/app.module.ts`

### Security model

Scripts run in an isolated-vm sandbox triggered by authenticated users via the AI agent loop. But the sandbox code is agent-generated — we can't trust anything the script sends. The `/script/` endpoints must:

1. Bypass Firebase auth (scripts can't carry Firebase tokens) → `@Public()`
2. Require a case-scoped HMAC token instead → `ScriptTokenGuard`
3. Verify the requested resource belongs to the signed case → controller-level checks

The HMAC token is signed by `ScriptTokenService` before each script run (using a per-process random key) and injected by the fetch bridge into localhost requests. The script code never sees the token — the bridge handles it transparently.

### Step 1: Create `ScriptTokenService`

```typescript
// backend/src/modules/script/script-token.service.ts
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const TOKEN_TTL_MS = 60_000; // 60s — scripts timeout at 30s

@Injectable()
export class ScriptTokenService {
  /** Per-process random key. Tokens are only valid within the same process. */
  private readonly key = crypto.randomBytes(32);

  /** Sign a case-scoped token for script sandbox use. */
  sign(caseId: string): string {
    const ts = Date.now();
    const hmac = crypto
      .createHmac('sha256', this.key)
      .update(`${caseId}|${ts}`)
      .digest('hex');
    return Buffer.from(`${caseId}.${ts}.${hmac}`, 'utf8').toString('base64url');
  }

  /** Verify and extract caseId. Returns null on any failure. */
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
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    ) {
      return null;
    }
    if (Date.now() - ts > TOKEN_TTL_MS) return null;

    return { caseId };
  }
}
```

### Step 2: Create `ScriptTokenGuard`

```typescript
// backend/src/modules/script/script-token.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ScriptTokenService } from './script-token.service';

@Injectable()
export class ScriptTokenGuard implements CanActivate {
  constructor(private readonly tokens: ScriptTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['x-script-token'];
    if (!header) throw new UnauthorizedException('missing_script_token');

    const result = this.tokens.verify(header as string);
    if (!result) throw new UnauthorizedException('invalid_script_token');

    req.scriptCaseId = result.caseId;
    return true;
  }
}
```

### Step 3: Create the controller

Endpoints use `@Public()` to bypass Firebase auth, then `@UseGuards(ScriptTokenGuard)` for case-scoped auth. Every handler verifies the requested resource belongs to the signed case.

```typescript
// backend/src/modules/script/script.controller.ts
import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../auth/public.decorator';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { TraceEntity } from '../../database/entities/trace.entity';
import { ScriptTokenGuard } from './script-token.guard';

/**
 * Read endpoints for agent scripts running in the isolated-vm sandbox.
 *
 * Auth: Firebase auth is bypassed (`@Public()`). Instead, a case-scoped
 * HMAC token is required (`ScriptTokenGuard`). The fetch bridge injects
 * the token transparently — script code never sees it.
 *
 * Access: each handler verifies the requested resource belongs to the
 * case encoded in the token. Scripts cannot read cross-case data.
 */
@Controller('script')
export class ScriptController {
  constructor(
    @InjectRepository(InvestigationEntity)
    private readonly invRepo: Repository<InvestigationEntity>,
    @InjectRepository(TraceEntity)
    private readonly traceRepo: Repository<TraceEntity>,
  ) {}

  @Public()
  @UseGuards(ScriptTokenGuard)
  @Get('investigations/:id')
  async getInvestigation(@Param('id') id: string, @Req() req: any) {
    const inv = await this.invRepo.findOne({
      where: { id },
      relations: ['traces'],
    });
    if (!inv) throw new NotFoundException('investigation_not_found');
    if (inv.caseId !== req.scriptCaseId) {
      throw new ForbiddenException('case_mismatch');
    }
    return {
      id: inv.id,
      name: inv.name,
      notes: inv.notes,
      caseId: inv.caseId,
      traces: inv.traces.map((t) => ({
        id: t.id,
        name: t.name,
        data: t.data,
      })),
    };
  }

  @Public()
  @UseGuards(ScriptTokenGuard)
  @Get('traces/:id')
  async getTrace(@Param('id') id: string, @Req() req: any) {
    const trace = await this.traceRepo.findOneBy({ id });
    if (!trace) throw new NotFoundException('trace_not_found');
    // Verify trace's investigation belongs to the signed case
    const inv = await this.invRepo.findOneBy({ id: trace.investigationId });
    if (!inv || inv.caseId !== req.scriptCaseId) {
      throw new ForbiddenException('case_mismatch');
    }
    return {
      id: trace.id,
      name: trace.name,
      investigationId: trace.investigationId,
      data: trace.data,
    };
  }
}
```

### Step 4: Create the module

`ScriptTokenService` is exported so `AiModule` can inject it into `ScriptExecutionService`.

```typescript
// backend/src/modules/script/script.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { TraceEntity } from '../../database/entities/trace.entity';
import { ScriptTokenService } from './script-token.service';
import { ScriptTokenGuard } from './script-token.guard';
import { ScriptController } from './script.controller';

@Module({
  imports: [TypeOrmModule.forFeature([InvestigationEntity, TraceEntity])],
  controllers: [ScriptController],
  providers: [ScriptTokenService, ScriptTokenGuard],
  exports: [ScriptTokenService],
})
export class ScriptModule {}
```

### Step 5: Register in `AppModule` and update `AiModule`

In `app.module.ts`:

```typescript
import { ScriptModule } from './modules/script/script.module';

// Add to imports array:
ScriptModule,
```

In `ai.module.ts`, import `ScriptModule` so `ScriptExecutionService` can inject `ScriptTokenService`:

```typescript
import { ScriptModule } from '../script/script.module';

// Add to imports array:
ScriptModule,
```

### Step 6: Verify build

Run: `cd backend && npx tsc --noEmit`

### Step 7: Commit

```bash
git add backend/src/modules/script/ backend/src/app.module.ts backend/src/modules/ai/ai.module.ts
git commit -m "feat: case-scoped script token auth for /script/ endpoints

ScriptTokenService signs HMAC tokens scoped to a caseId. ScriptTokenGuard
validates X-Script-Token header and checks resource ownership. Script code
never sees the token — the fetch bridge injects it for localhost calls."
```

---

## Task 4: Loopback env flag + token injection in fetch bridge

**Files:**
- Modify: `backend/src/modules/ai/services/script-execution.service.ts`

### Step 1: Gate loopback with `SCRIPT_ALLOW_LOOPBACK` env flag

The existing code blocks localhost in production. Rather than always-on, gate it with an explicit env flag to limit SSRF surface. In the constructor:

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

Update the comment on `LOOPBACK_DOMAINS`:

```typescript
/**
 * Loopback — allows scripts to call the local backend API (e.g. /script/ endpoints).
 * Enabled by default in dev. In production, requires SCRIPT_ALLOW_LOOPBACK=true.
 */
const LOOPBACK_DOMAINS = ['localhost', '127.0.0.1'];
```

### Step 2: Accept `caseId` and inject `ScriptTokenService`

Change the `execute` method signature and inject the token service:

```typescript
import { ScriptTokenService } from '../../script/script-token.service';

// In constructor, add:
private readonly scriptToken: ScriptTokenService,
```

Update `execute`:

```typescript
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
      investigationId,
      name,
      code,
      output: result.output,
      status: result.status,
      durationMs: result.durationMs,
    }),
  );

  return { ...result, savedRun };
}
```

### Step 3: Thread the token through to the sandbox

Update `runInIsolate` and `executeInContext` signatures:

```typescript
private async runInIsolate(code: string, scriptToken?: string): Promise<ScriptResult> {
  // ... existing setup ...
  return await this.executeInContext(isolate, code, start, scriptToken);
  // ...
}

private async executeInContext(
  isolate: ivm.Isolate,
  code: string,
  start: number,
  scriptToken?: string,
): Promise<ScriptResult> {
```

### Step 4: Inject `X-Script-Token` header for localhost fetch calls

In `executeInContext`, inside the `_fetchBridge` callback, after the `isAllowedUrl` check and options parsing, add token injection before `injectApiKey`:

```typescript
// After: const opts = optsJson ? JSON.parse(optsJson) : {};
// After: opts.redirect = 'error';
// ADD:
const parsed = new URL(url);
if (LOOPBACK_DOMAINS.includes(parsed.hostname) && scriptToken) {
  opts.headers = {
    ...(opts.headers || {}),
    'X-Script-Token': scriptToken,
  };
}
```

Note: `scriptToken` is captured by closure from the `executeInContext` parameter. The script code has no access to it.

### Step 5: Update `AiService` to pass `caseId` to script execution

In `ai.service.ts`, update the `execute_script` dispatch case:

```typescript
case EXECUTE_SCRIPT_TOOL.name: {
  if (!investigationId || !caseId) {
    return { error: 'No investigation context. Ask the user to select an investigation.' };
  }
  const { name, code } = toolUse.input as { name: string; code: string };
  return this.scriptExecutionService.execute(investigationId, caseId, name, code);
}
```

### Step 6: Verify build

Run: `cd backend && npx tsc --noEmit`

### Step 7: Commit

```bash
git add backend/src/modules/ai/
git commit -m "feat: SCRIPT_ALLOW_LOOPBACK env flag + token injection in fetch bridge

Loopback is gated by env flag in production (limits SSRF surface).
ScriptExecutionService signs a case-scoped token before each run and
the fetch bridge injects X-Script-Token header on localhost requests.
Script code never sees the token."
```

---

## Task 5: Update system prompt and skills

**Files:**
- Modify: `backend/src/prompts/investigator.ts`
- Modify: `backend/src/skills/graph-mutations.md`
- Modify: `backend/src/skills/product-knowledge.md`

### Step 1: Update the system prompt

In `investigator.ts`, make these concrete edits:

**Edit 1** — Replace the `get_case_data` line in the "You have access to" block:

```
// OLD:
- get_case_data: fetch the investigation graph for this case (wallet nodes, transaction edges, traces)

// NEW:
- get_case_data: get a high-level case overview (investigation names and trace counts, productions, data room status). Does NOT return graph data.
- get_investigation: query investigation data. No params = summaries of all investigations. With investigationId = full graph data (visual metadata stripped, edges denormalized with addresses). Optional address/token filters narrow the result.
```

**Edit 2** — Replace the blockchain skill guidelines:

```
// OLD:
- Before constructing Etherscan API calls, load the etherscan-apis skill for exact endpoint formats and parameters.
- Before constructing Tronscan/TronGrid API calls, load the tronscan-apis skill for exact endpoint formats and parameters.
- For multi-API-call tasks (fetching transactions, balances, token transfers), prefer execute_script over sequential tool calls. Load the relevant API skill first for endpoint formats, then write a script.

// NEW:
- Before constructing Etherscan API calls, load the etherscan-apis skill for exact endpoint formats and parameters.
- Before constructing Tronscan/TronGrid API calls, load the tronscan-apis skill for exact endpoint formats and parameters.
- For multi-API-call tasks (fetching transactions, balances, token transfers), prefer execute_script over sequential tool calls. Load the relevant API skill first for endpoint formats, then write a script.
- Start with get_case_data to orient yourself on what exists. Then use get_investigation to drill into specific investigations.
- For analytical reasoning (pattern identification, summarizing flows), use get_investigation with address/token filters to load only the relevant subset into context.
- For mechanical processing (accounting, aggregation, statistics, counting, summing amounts), prefer execute_script. Scripts can read investigation data directly from the local API (GET {API_URL}/script/investigations/{id} or GET {API_URL}/script/traces/{traceId}) and process it without the data entering the conversation. This is critical for large datasets.
- When the user asks for totals, balances, or aggregated numbers, default to a script — it handles any data size and produces a concise result.
```

**Edit 3** — Replace the productions skill guideline:

```
// OLD:
- When asked to create a production (report, chart, or chronology), load the productions skill for format requirements before creating.

// NEW:
- When asked to create a production (report, chart, or chronology), load the productions skill for format requirements. For data-driven productions, use a script to compute the numbers first, then create the production.
```

### Step 2: Update `graph-mutations.md`

Add a new section **before** the existing "## Import Endpoint" section:

```markdown
## Reading Investigation Data from Scripts

Scripts can read investigation and trace data directly from the local API without it passing through the conversation context. Use this for large-dataset processing (sums, aggregation, statistics). The script token is injected automatically — just call the endpoints.

### Get full investigation with all traces

` ` `js
const API_URL = process.env.API_URL;
const INVESTIGATION_ID = 'INV_ID_HERE'; // from get_case_data or get_investigation

const res = await fetch(`${API_URL}/script/investigations/${INVESTIGATION_ID}`);
const investigation = await res.json();

// investigation.traces[].data.nodes[] — all wallet nodes
// investigation.traces[].data.edges[] — all transaction edges
console.log(`${investigation.name}: ${investigation.traces.length} traces`);
for (const t of investigation.traces) {
  const nodes = t.data.nodes || [];
  const edges = t.data.edges || [];
  console.log(`  ${t.name}: ${nodes.length} nodes, ${edges.length} edges`);
}
` ` `

### Get a single trace

` ` `js
const API_URL = process.env.API_URL;
const TRACE_ID = 'TRACE_ID_HERE'; // from get_investigation summary

const res = await fetch(`${API_URL}/script/traces/${TRACE_ID}`);
const trace = await res.json();
const nodes = trace.data.nodes || [];
const edges = trace.data.edges || [];

// Example: sum all ETH transactions
const ethTotal = edges
  .filter(e => e.token === 'ETH')
  .reduce((sum, e) => sum + parseFloat(e.amount), 0);
console.log(`Total ETH flow: ${ethTotal}`);
` ` `

### When to use scripts vs get_investigation

| Scenario | Use |
|----------|-----|
| Quick look at an address's activity | `get_investigation` with `address` filter |
| Identify patterns or suspicious flows | `get_investigation` with filters, reason in context |
| Sum up amounts, compute balances | Script — mechanical, no LLM reasoning needed |
| Generate a chart or report from data | Script to compute the numbers, then `create_production` |
| Process 100+ edges | Script — data stays server-side |
```

(Note: the triple-backtick fences above have spaces to avoid breaking the plan's own markdown. Remove the spaces when implementing.)

### Step 3: Update `product-knowledge.md`

Replace the "AI Assistant" section's capabilities list and add the "Data access workflow" subsection. See the product-knowledge.md diff in the atomized changes table.

### Step 4: Verify build

Run: `cd backend && npx tsc --noEmit`

### Step 5: Commit

```bash
git add backend/src/prompts/investigator.ts backend/src/skills/graph-mutations.md backend/src/skills/product-knowledge.md
git commit -m "docs: update prompt and skills for new data access workflow

Teach agent: get_case_data for orientation, get_investigation for
targeted queries with address/token filters, execute_script for
mechanical processing via /script/ endpoints."
```

---

## Task 6: Tests

**Files:**
- Create: `backend/src/modules/ai/investigation-data.utils.spec.ts`
- Create: `backend/src/modules/script/script-token.service.spec.ts`
- Create: `backend/src/modules/script/script.controller.spec.ts`

### Step 1: Unit tests for strip/filter utils

```typescript
// backend/src/modules/ai/investigation-data.utils.spec.ts
import { stripTraceForAgent, filterTraceData } from './investigation-data.utils';

const SAMPLE_DATA = {
  nodes: [
    {
      id: 'n1', address: '0xAAA', chain: 'ethereum', label: 'Wallet A',
      tags: ['exchange'], notes: 'Main wallet', addressType: 'eoa', groupId: 'g1',
      position: { x: 100, y: 200 }, color: '#fff', shape: 'diamond',
      size: 60, parentTrace: 't1', explorerUrl: 'https://etherscan.io/address/0xAAA',
    },
    {
      id: 'n2', address: '0xBBB', chain: 'ethereum', label: 'Wallet B',
      tags: [], notes: '', addressType: 'contract',
      position: { x: 300, y: 200 }, color: null, shape: 'ellipse',
      size: 40, parentTrace: 't1', explorerUrl: 'https://etherscan.io/address/0xBBB',
    },
    {
      id: 'n3', address: '0xCCC', chain: 'ethereum', label: 'Wallet C',
      tags: [], notes: '',
      position: { x: 500, y: 200 }, color: null, shape: 'ellipse',
      size: 40, parentTrace: 't1', explorerUrl: 'https://etherscan.io/address/0xCCC',
    },
    {
      id: 'n4', address: '0xDDD', chain: 'ethereum', label: 'Isolated Node',
      tags: [], notes: '',
      position: { x: 700, y: 200 }, color: null, shape: 'ellipse',
      size: 40, parentTrace: 't1', explorerUrl: 'https://etherscan.io/address/0xDDD',
    },
  ],
  edges: [
    {
      id: 'e1', from: 'n1', to: 'n2', txHash: '0x111',
      chain: 'ethereum', timestamp: '1700000000', amount: '1.5', token: 'ETH',
      blockNumber: 19000000, notes: '', tags: [], crossTrace: false,
      color: null, lineStyle: null,
    },
    {
      id: 'e2', from: 'n2', to: 'n3', txHash: '0x222',
      chain: 'ethereum', timestamp: '1700001000', amount: '100', token: 'USDT',
      blockNumber: 19000100, notes: '', tags: [], crossTrace: false,
      color: '#f00', lineStyle: 'dashed',
    },
    {
      id: 'e3', from: 'n1', to: 'n3', txHash: '0x333',
      chain: 'ethereum', timestamp: '1700002000', amount: '0.5', token: 'ETH',
      blockNumber: 19000200, notes: 'suspicious', tags: ['flagged'],
      crossTrace: true, color: null, lineStyle: null,
    },
  ],
  groups: [
    { id: 'g1', name: 'Exchange Cluster', color: '#f59e0b', traceId: 't1', collapsed: false },
  ],
  edgeBundles: [
    { id: 'b1', fromNodeId: 'n1', toNodeId: 'n2', token: 'ETH', collapsed: false, edgeIds: ['e1'], color: null },
  ],
};

describe('stripTraceForAgent', () => {
  it('keeps semantic fields on nodes (addressType, groupId)', () => {
    const { nodes } = stripTraceForAgent(SAMPLE_DATA);
    const n1 = nodes.find((n) => n.id === 'n1')!;
    expect(n1.addressType).toBe('eoa');
    expect(n1.groupId).toBe('g1');
  });

  it('drops visual fields from nodes', () => {
    const { nodes } = stripTraceForAgent(SAMPLE_DATA);
    const n1 = nodes.find((n) => n.id === 'n1')!;
    expect(n1).not.toHaveProperty('position');
    expect(n1).not.toHaveProperty('color');
    expect(n1).not.toHaveProperty('shape');
    expect(n1).not.toHaveProperty('size');
    expect(n1).not.toHaveProperty('explorerUrl');
    expect(n1).not.toHaveProperty('parentTrace');
  });

  it('denormalizes edges with addresses and keeps semantic fields', () => {
    const { edges } = stripTraceForAgent(SAMPLE_DATA);
    const e1 = edges.find((e) => e.id === 'e1')!;
    expect(e1.fromAddress).toBe('0xAAA');
    expect(e1.toAddress).toBe('0xBBB');
    expect(e1.blockNumber).toBe(19000000);
    const e3 = edges.find((e) => e.id === 'e3')!;
    expect(e3.crossTrace).toBe(true);
  });

  it('drops visual fields from edges', () => {
    const { edges } = stripTraceForAgent(SAMPLE_DATA);
    const e2 = edges.find((e) => e.id === 'e2')!;
    expect(e2).not.toHaveProperty('color');
    expect(e2).not.toHaveProperty('lineStyle');
  });

  it('includes slim groups with derived nodeIds', () => {
    const { groups } = stripTraceForAgent(SAMPLE_DATA);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({ id: 'g1', name: 'Exchange Cluster', nodeIds: ['n1'] });
    expect(groups[0]).not.toHaveProperty('color');
    expect(groups[0]).not.toHaveProperty('collapsed');
  });

  it('includes slim edge bundles', () => {
    const { edgeBundles } = stripTraceForAgent(SAMPLE_DATA);
    expect(edgeBundles).toHaveLength(1);
    expect(edgeBundles[0]).toEqual({
      id: 'b1', fromNodeId: 'n1', toNodeId: 'n2', token: 'ETH', edgeIds: ['e1'],
    });
    expect(edgeBundles[0]).not.toHaveProperty('collapsed');
    expect(edgeBundles[0]).not.toHaveProperty('color');
  });

  it('handles empty data', () => {
    const result = stripTraceForAgent({});
    expect(result).toEqual({ nodes: [], edges: [], groups: [], edgeBundles: [] });
  });
});

describe('filterTraceData', () => {
  const stripped = stripTraceForAgent(SAMPLE_DATA);

  it('returns all data when no filters', () => {
    const result = filterTraceData(stripped);
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(3);
  });

  it('filters by address — returns incident edges', () => {
    const result = filterTraceData(stripped, '0xAAA');
    expect(result.edges.map((e) => e.id).sort()).toEqual(['e1', 'e3']);
    expect(result.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('address filter includes isolated nodes with zero edges', () => {
    const result = filterTraceData(stripped, '0xDDD');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe('n4');
    expect(result.edges).toHaveLength(0);
  });

  it('filters by token', () => {
    const result = filterTraceData(stripped, undefined, 'USDT');
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].id).toBe('e2');
    expect(result.nodes.map((n) => n.id).sort()).toEqual(['n2', 'n3']);
  });

  it('combines address + token', () => {
    const result = filterTraceData(stripped, '0xAAA', 'ETH');
    expect(result.edges.map((e) => e.id).sort()).toEqual(['e1', 'e3']);
  });

  it('returns empty when nothing matches', () => {
    const result = filterTraceData(stripped, '0xZZZ');
    expect(result.edges).toEqual([]);
    expect(result.nodes).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(filterTraceData(stripped, '0xaaa').edges).toHaveLength(2);
    expect(filterTraceData(stripped, undefined, 'eth').edges).toHaveLength(2);
  });

  it('prunes groups to surviving nodes', () => {
    const result = filterTraceData(stripped, '0xBBB');
    // n1 is in group g1 but only if it's connected to 0xBBB edges
    // e1 (n1→n2) and e2 (n2→n3) survive — n1 is included
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].nodeIds).toEqual(['n1']);
  });

  it('prunes edge bundles to surviving edges', () => {
    const result = filterTraceData(stripped, '0xAAA', 'USDT');
    // No USDT edges from 0xAAA → bundle with e1 drops
    expect(result.edgeBundles).toHaveLength(0);
  });
});
```

### Step 2: Unit tests for `ScriptTokenService`

```typescript
// backend/src/modules/script/script-token.service.spec.ts
import { ScriptTokenService } from './script-token.service';

describe('ScriptTokenService', () => {
  let service: ScriptTokenService;

  beforeEach(() => {
    service = new ScriptTokenService();
  });

  it('sign → verify round-trip', () => {
    const result = service.verify(service.sign('case-123'));
    expect(result).toEqual({ caseId: 'case-123' });
  });

  it('rejects tampered token', () => {
    const token = service.sign('case-123');
    const tampered = token.slice(0, -3) + 'xxx';
    expect(service.verify(tampered)).toBeNull();
  });

  it('rejects token from a different instance (different key)', () => {
    const other = new ScriptTokenService();
    const token = other.sign('case-123');
    expect(service.verify(token)).toBeNull();
  });

  it('rejects expired token', () => {
    const token = service.sign('case-123');
    // Monkey-patch Date.now to simulate 61s later
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      expect(service.verify(token)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('rejects garbage input', () => {
    expect(service.verify('')).toBeNull();
    expect(service.verify('not-a-token')).toBeNull();
    expect(service.verify('abc.def')).toBeNull();
  });
});
```

### Step 3: Integration test for `ScriptController`

```typescript
// backend/src/modules/script/script.controller.spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, NotFoundException } from '@nestjs/common';
import * as request from 'supertest';
import { ScriptController } from './script.controller';
import { ScriptTokenService } from './script-token.service';
import { ScriptTokenGuard } from './script-token.guard';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { TraceEntity } from '../../database/entities/trace.entity';

describe('ScriptController', () => {
  let app: INestApplication;
  let tokenService: ScriptTokenService;
  const mockInvRepo = { findOne: jest.fn(), findOneBy: jest.fn() };
  const mockTraceRepo = { findOneBy: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ScriptController],
      providers: [
        ScriptTokenService,
        ScriptTokenGuard,
        { provide: getRepositoryToken(InvestigationEntity), useValue: mockInvRepo },
        { provide: getRepositoryToken(TraceEntity), useValue: mockTraceRepo },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    tokenService = module.get(ScriptTokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects requests without token', async () => {
    await request(app.getHttpServer())
      .get('/script/investigations/inv-1')
      .expect(401);
  });

  it('rejects requests with invalid token', async () => {
    await request(app.getHttpServer())
      .get('/script/investigations/inv-1')
      .set('X-Script-Token', 'garbage')
      .expect(401);
  });

  it('rejects cross-case access with 403', async () => {
    const token = tokenService.sign('case-A');
    mockInvRepo.findOne.mockResolvedValueOnce({
      id: 'inv-1', caseId: 'case-B', traces: [],
    });

    await request(app.getHttpServer())
      .get('/script/investigations/inv-1')
      .set('X-Script-Token', token)
      .expect(403);
  });

  it('returns investigation for valid same-case token', async () => {
    const token = tokenService.sign('case-A');
    mockInvRepo.findOne.mockResolvedValueOnce({
      id: 'inv-1', name: 'Test', notes: null, caseId: 'case-A',
      traces: [{ id: 't1', name: 'Trace 1', data: { nodes: [], edges: [] } }],
    });

    const res = await request(app.getHttpServer())
      .get('/script/investigations/inv-1')
      .set('X-Script-Token', token)
      .expect(200);

    expect(res.body.id).toBe('inv-1');
    expect(res.body.traces).toHaveLength(1);
  });
});
```

### Step 4: Run all tests

Run: `cd backend && npx jest --testPathPattern '(investigation-data|script-token|script.controller)' --verbose`
Expected: All pass.

### Step 5: Commit

```bash
git add backend/src/modules/ai/investigation-data.utils.spec.ts \
        backend/src/modules/script/script-token.service.spec.ts \
        backend/src/modules/script/script.controller.spec.ts
git commit -m "test: unit + integration tests for data access redesign

- Strip/filter utils: semantic field preservation, address filtering
  (including isolated nodes), group/bundle pruning, case-insensitivity
- ScriptTokenService: round-trip, tamper, cross-instance, expiry
- ScriptController: missing token (401), invalid token (401), cross-case
  rejection (403), valid same-case access (200)"
```

---

## Task 7: Verify end-to-end

### Step 1: Start the backend

Run: `npm run be`
Expected: Server starts on port 8081 without errors.

### Step 2: Test script endpoints require token

```bash
# Without token — should 401
curl -s http://localhost:8081/script/investigations/any-id | jq .statusCode
# Expected: 401
```

### Step 3: Verify the AI chat works

Open the frontend, start a conversation, and try:
1. Ask "What's in this case?" — should trigger `get_case_data` and return the lightweight overview
2. Ask about a specific address — should trigger `get_investigation` with the address filter
3. Ask for a sum or total — should use `execute_script` with a script that reads from `/script/traces/`

### Step 4: Final commit

```bash
git add -A
git commit -m "feat: agent data access redesign — overview, queryable investigation, script endpoints"
```
