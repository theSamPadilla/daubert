# Public Trace API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose a single rate-limited, API-key-guarded HTTP endpoint on the daubert backend that takes `(address, chain, hops)` and returns a labeled graph of recent on-chain activity, callable only by the marketing site's server-side proxy. Anonymous browsers never call this endpoint directly; the marketing site holds the key in server-only env and forwards requests.

**Architecture:** New NestJS module `external-trace` that reuses existing `BlockchainService.fetchHistory()` and `LabeledEntitiesService.lookupByAddress()`. The route is decorated `@Public()` to bypass `AuthGuard` (the Firebase guard for end-user sessions; existing pattern, see `/health` in `src/app.controller.ts` and `/data-room/oauth-callback` in `src/modules/data-room/data-room.controller.ts`) and additionally guarded by a new `WebsiteKeyGuard` that **requires** a matching `X-Daubert-Website-Key` header. The key is verified with `crypto.timingSafeEqual`. Rate limiting via `@nestjs/throttler@5` is applied locally on the controller (NOT global) using a `ForwardedIpThrottlerGuard` subclass that overrides `getTracker` to read `X-Forwarded-For`, so the throttler counts the real visitor IP rather than the proxy IP. CORS does NOT need the marketing site origin (calls are server-to-server, not browser-to-API).

**Tech Stack:** NestJS 10, `@nestjs/throttler@^5.2.0`, existing `BlockchainModule` + `LabeledEntitiesModule`, Jest + supertest (existing test conventions).

**Cross-reference:** The marketing site consumes the response shape defined in Task 6. The frontend plan lives at `../website-daubert/docs/plans/2026-05-17-interactive-trace-demo.md`.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/package.json` + `package-lock.json` | Modify | Add `@nestjs/throttler@^5.2.0` |
| 2 | `backend/src/modules/external-trace/dto/trace-query.dto.ts` | Create | Validate `address`, `chain`, `hops` query params |
| 3 | `backend/src/modules/external-trace/graph-builder.ts` | Create | Pure function: `TransactionResult[]` → `{nodes, edges}` |
| 4 | `backend/src/modules/external-trace/__tests__/graph-builder.spec.ts` | Create | Unit tests for the graph transform |
| 5 | `backend/src/modules/external-trace/external-trace.service.ts` | Create | Orchestrate `fetchHistory` + label lookup + multi-hop graph build |
| 6 | `backend/src/modules/external-trace/__tests__/external-trace.service.spec.ts` | Create | Service tests with mocked `BlockchainService` + `LabeledEntitiesService` |
| 7 | `backend/src/modules/external-trace/website-key.guard.ts` | Create | Required `X-Daubert-Website-Key` header check using `timingSafeEqual` |
| 8 | `backend/src/modules/external-trace/forwarded-ip.guard.ts` | Create | `ThrottlerGuard` subclass that reads `X-Forwarded-For` for the real visitor IP |
| 8b | `backend/src/modules/labeled-entities/labeled-entities.service.ts` | Modify | Add `lookupByAddresses(addresses: string[])` batch query so the trace path is not N+1 |
| 8c | `backend/src/modules/labeled-entities/__tests__/labeled-entities.service.spec.ts` | Create | Unit test for the new batch method |
| 8d | `backend/test/setup-external-trace.ts` | Create | Jest `setupFiles` entry that sets the test API key before the module registry initializes |
| 8e | `backend/jest.config.js` (or `package.json` `jest`) | Modify | Wire the setup file in for e2e specs |
| 9 | `backend/src/modules/external-trace/external-trace.controller.ts` | Create | `GET /external/trace` with `@Public()` + `@Throttle()` + `@UseGuards(ThrottlerGuard, WebsiteKeyGuard)` |
| 10 | `backend/src/modules/external-trace/external-trace.module.ts` | Create | Register controller + service, import `BlockchainModule` + `LabeledEntitiesModule` + `ThrottlerModule` |
| 11 | `backend/test/external-trace.e2e-spec.ts` | Create | End-to-end test of the route (missing key → 401, happy path, rate limit) |
| 12 | `backend/src/app.module.ts` | Modify | Import `ExternalTraceModule` |
| 13 | `backend/src/main.ts` | Modify | Add `app.set('trust proxy', true)` so Express trusts `X-Forwarded-For` from Cloud Run |
| 14 | `backend/.env.example` | Modify | Document required `DAUBERT_WEBSITE_API_KEY` |
| 15 | `backend/README.md` | Modify | Document the new external endpoint and curl example |

---

## Plain-English Summary

Today, the daubert backend only serves authenticated users. The marketing site can't call it at all. This plan adds a new URL — `GET /external/trace` — that only the marketing site's server is allowed to call. The marketing site holds a shared key in server-only env, attaches it to every request as a header, and the backend rejects anything without a matching key. Browsers never call this endpoint and never see the key.

What changes for the user: the marketing site server can embed a real working trace demo backed by daubert's actual blockchain and labels logic. No mocks, no fake data.

What is explicitly NOT changing: no new chains, no new providers, no new database tables. Authenticated routes and their behavior are untouched. No write access from this endpoint.

The trade: the endpoint shares the global Etherscan rate-limit bucket (5 RPS) with authenticated users. With an HTTP throttle of 10 requests per minute per visitor IP, the external path contributes at most ~0.16 RPS — comfortably under the bucket. If traffic ever spikes (a viral moment), we add a dedicated `RateLimiter` instance for the external path. That work is deferred.

There are three layers of protection:
1. **Website API key** (`X-Daubert-Website-Key`, required, checked with `timingSafeEqual`) — without the key, the request gets a `401`. Real auth. Key lives only in the marketing site's server env, never in browser code.
2. **Per-visitor rate limit** (10 req/min per `X-Forwarded-For` IP) — guards against a single visitor flooding even with a valid key.
3. **No CORS exposure** — the endpoint never needs to accept browser cross-origin requests, so the marketing site's domain does NOT get added to `ALLOWED_ORIGINS`. Smaller blast radius.

Follow-up: `../website-daubert/docs/plans/2026-05-17-interactive-trace-demo.md` consumes the response shape defined here. The marketing site adds a Next.js Route Handler (`/api/trace`) that holds the key in server env and proxies requests to this endpoint.

---

## Engineering Decisions Made

1. **Throttler version**: `@nestjs/throttler@^5.2.0`. v6 requires NestJS 11; v5 has a `^10.0.0` peer range matching the rest of the repo.
2. **Throttler scope**: `ThrottlerModule.forRoot` is configured but `ThrottlerGuard` is NOT registered as `APP_GUARD`. It's applied locally via `@UseGuards(ThrottlerGuard)` on the new controller only. This avoids any behavior change on authenticated routes.
3. **API-key auth (required)**: `WebsiteKeyGuard` reads `X-Daubert-Website-Key` and compares against `DAUBERT_WEBSITE_API_KEY` env var using `crypto.timingSafeEqual` (constant-time compare). If the env var is missing or empty at module construction, the guard throws — production cannot silently degrade to no-auth. Dev sets `DAUBERT_WEBSITE_API_KEY=dev` in `.env.local`; the marketing site's dev env sets `DAUBERT_API_KEY=dev` to match.
4. **Throttler tracker**: `ForwardedIpTracker` overrides `getTracker(req)` to return the first IP in `X-Forwarded-For`. `app.set('trust proxy', true)` is added in `main.ts` so Express also populates `req.ip` correctly. Without this, every visitor would share the proxy IP and one flood would lock everyone out.
5. **No CORS update**: this endpoint is called server-to-server only. `ALLOWED_ORIGINS` is NOT touched, so browsers still cannot call `/external/trace` directly even if they had the key. Defense in depth.
6. **URL prefix**: `/external/trace`, not `/public/trace`. "Public" was misleading; this is a keyed external-integrations route. Future external API consumers can sit under `/external/*` with their own keys.
7. **Hop strategy**: Hop-2 fetches in parallel via `Promise.all` over the top 5 hop-1 counterparties (ranked by tx count). Hard caps: 50 txs per address, 100 unique nodes total, 200 edges total. Truncation flag returned to client.
8. **Edge dedup key**: `${from}->${to}->${token.address}`. Keying by `token.symbol` would collapse two contracts that both call themselves USDC into a single bogus aggregate. `token.symbol` is still returned on the edge as a display field. Native tokens use the existing sentinel address (`0x` on EVM, `''` on Tron) so two ETH transfers between the same pair still aggregate correctly.
9. **Amount math**: edges keep a `bigint` accumulator internally (`rawAmount`); we sum raw transaction values directly and format only once at serialization. The previous draft summed already-formatted decimal strings, which silently corrupted any amount with a fractional part.
10. **Amount formatting**: returned as a decimal string normalized by `token.decimals` (e.g. `"1.523"`, capped to 4 decimal places). The frontend never does `BigInt` math.
11. **Response cache**: in-process `Map<key, {result, expiresAt}>` keyed by `(chain, address, hops)`, 60-second TTL, 200-entry LRU-style cap. Protects the shared 5 RPS Etherscan bucket from repeated identical queries (popular wallets, the demo's example chips). On cache hit the response is returned verbatim, including the original `cachedAt` timestamp — so `cachedAt` is now a meaningful field, not a synonym for "now".
12. **Batch label lookup**: a new `LabeledEntitiesService.lookupByAddresses(addresses: string[])` method does one `WHERE EXISTS (… w = ANY(:addresses))` query and groups results client-side. Replaces the N+1 pattern. Also useful for the authenticated graph path eventually.
13. **Rate-limit bucket isolation**: Deferred. The shared `RateLimiter` in `ProviderRegistry` (5 tokens, 5/sec refill) is fine at our throttle limits, especially with the 60s response cache fronting it.
14. **Address normalization**: EVM addresses lowercased; Tron addresses passed through (base58 is case-sensitive). Mirrors the existing `BlockchainService.fetchHistory` behavior at `src/modules/blockchain/blockchain.service.ts:80`.
15. **E2E env setup**: the test API key is set in `backend/test/setup-external-trace.ts`, registered via Jest `setupFiles`. Top-of-file `process.env` assignments work today under CJS/ts-jest but silently break if anyone flips Jest to ESM (imports hoist above statements). `setupFiles` runs before the module registry initializes, regardless of module system.
16. **Test framework**: Jest + supertest, matching the rest of the codebase.
17. **Validation framework**: `class-validator` DTO (already a project dep via `class-transformer`). Global `ValidationPipe` in `src/main.ts:46` will pick up the DTO without extra wiring.

---

## Tasks

### Task 1: Install @nestjs/throttler

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

**Step 1: Install**

```bash
cd /Users/Sam/Work/Incite/dev/daubert/backend
npm install @nestjs/throttler@^5.2.0
```

**Step 2: Verify**

```bash
node -e "console.log(require('@nestjs/throttler/package.json').version)"
```
Expected: `5.2.0` or `5.2.x`.

**Step 3: Confirm no peer-dep warnings**

```bash
npm ls @nestjs/throttler
```
Expected: clean tree, no `UNMET PEER DEPENDENCY` lines.

---

### Task 2: Create the query DTO

**Files:**
- Create: `backend/src/modules/external-trace/dto/trace-query.dto.ts`

**Step 1: Write the DTO**

```ts
// backend/src/modules/external-trace/dto/trace-query.dto.ts
import { IsIn, IsInt, IsString, Max, Min, Matches } from 'class-validator';
import { Transform, Type } from 'class-transformer';

const SUPPORTED_CHAINS = ['ethereum', 'polygon', 'arbitrum', 'base', 'tron'] as const;
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

export class TraceQueryDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^(0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33})$/, {
    message: 'address must be an EVM (0x + 40 hex) or Tron (base58, 34 chars starting with T) address',
  })
  address!: string;

  @IsIn(SUPPORTED_CHAINS as unknown as string[])
  chain!: SupportedChain;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  hops: number = 1;
}
```

The regex covers both EVM and Tron at the field level. Cross-field rule (EVM address on EVM chain, Tron on Tron) is enforced in the service for a clearer error.

---

### Task 3: Write failing tests for graph-builder

**Files:**
- Create: `backend/src/modules/external-trace/__tests__/graph-builder.spec.ts`

**Step 1: Write tests**

```ts
// backend/src/modules/external-trace/__tests__/graph-builder.spec.ts
import { buildGraph } from '../graph-builder';
import { TransactionResult } from '../../blockchain/blockchain.service';

const tx = (overrides: Partial<TransactionResult> = {}): TransactionResult => ({
  id: 'tx-id',
  from: '0xaaa',
  to: '0xbbb',
  txHash: '0xhash',
  chain: 'ethereum',
  timestamp: '2026-05-01T00:00:00.000Z',
  amount: '1000000000000000000', // 1 ETH raw
  token: { address: '0x', symbol: 'ETH', decimals: 18 },
  blockNumber: 100,
  notes: '',
  tags: [],
  crossTrace: false,
  ...overrides,
});

describe('buildGraph', () => {
  it('returns a single edge and two nodes for one transaction', () => {
    const { nodes, edges } = buildGraph([tx()], '0xaaa');
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: '0xaaa',
      to: '0xbbb',
      txCount: 1,
      token: { symbol: 'ETH' },
      amount: '1',
    });
  });

  it('aggregates same-pair same-token transactions into one edge', () => {
    const { edges } = buildGraph(
      [tx(), tx({ txHash: '0xhash2', amount: '2000000000000000000' })],
      '0xaaa',
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].txCount).toBe(2);
    expect(edges[0].amount).toBe('3');
  });

  it('keeps same-pair different-token as separate edges', () => {
    const { edges } = buildGraph(
      [
        tx(),
        tx({
          txHash: '0xhash2',
          amount: '1000000',
          token: { address: '0xusdc', symbol: 'USDC', decimals: 6 },
        }),
      ],
      '0xaaa',
    );
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.token.symbol).sort()).toEqual(['ETH', 'USDC']);
  });

  it('keeps two tokens with the same symbol but different addresses separate', () => {
    // Scam-token defense: two contracts both calling themselves USDC.
    const { edges } = buildGraph(
      [
        tx({
          amount: '1000000',
          token: { address: '0xrealusdc', symbol: 'USDC', decimals: 6 },
        }),
        tx({
          txHash: '0xhash2',
          amount: '5000000',
          token: { address: '0xfakeusdc', symbol: 'USDC', decimals: 6 },
        }),
      ],
      '0xaaa',
    );
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.token.address).sort()).toEqual(['0xfakeusdc', '0xrealusdc']);
  });

  it('marks the root node with isRoot: true', () => {
    const { nodes } = buildGraph([tx()], '0xaaa');
    const root = nodes.find((n) => n.id === '0xaaa');
    expect(root?.isRoot).toBe(true);
  });

  it('formats sub-unit amounts to 4 decimal places without trailing zeros', () => {
    const { edges } = buildGraph(
      [tx({ amount: '1523400000000000000' })],
      '0xaaa',
    );
    expect(edges[0].amount).toBe('1.5234');
  });

  it('truncates to nodeCap when exceeded', () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      tx({ to: `0x${i.toString(16).padStart(40, '0')}`, txHash: `0xh${i}` }),
    );
    const result = buildGraph(many, '0xaaa', { nodeCap: 100 });
    expect(result.nodes.length).toBeLessThanOrEqual(100);
    expect(result.truncated).toBe(true);
  });
});
```

**Step 2: Run, see fail**

```bash
cd /Users/Sam/Work/Incite/dev/daubert/backend
npx jest src/modules/external-trace/__tests__/graph-builder.spec.ts
```
Expected: `Cannot find module '../graph-builder'`.

---

### Task 4: Implement graph-builder

**Files:**
- Create: `backend/src/modules/external-trace/graph-builder.ts`

**Step 1: Write implementation**

The accumulator is a `bigint` kept on an internal edge record. Formatting happens once, at serialization. Edges are keyed by `(from, to, token.address)` so same-symbol-different-contract tokens stay separate.

```ts
// backend/src/modules/external-trace/graph-builder.ts
import type { TransactionResult } from '../blockchain/blockchain.service';

export interface GraphNode {
  id: string;
  address: string;
  chain: string;
  isRoot: boolean;
  txCount: number;
  label?: { name: string; category: string };
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  token: { address: string; symbol: string; decimals: number };
  amount: string;       // formatted decimal string, e.g. "1.5234"
  txCount: number;
  lastTimestamp: string;
  lastTxHash: string;
}

export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface BuildOptions {
  nodeCap?: number;
  edgeCap?: number;
}

interface InternalEdge {
  id: string;
  from: string;
  to: string;
  token: { address: string; symbol: string; decimals: number };
  rawAmount: bigint;
  txCount: number;
  lastTimestamp: string;
  lastTxHash: string;
}

function formatAmount(raw: bigint, decimals: number): string {
  if (decimals <= 0) return raw.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  if (fraction === 0n) return whole.toString();
  const fracStr = fraction.toString().padStart(decimals, '0').slice(0, 4);
  const trimmed = fracStr.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

function parseRaw(amount: string): bigint {
  try {
    return BigInt(amount);
  } catch {
    return 0n;
  }
}

export function buildGraph(
  txs: TransactionResult[],
  rootAddress: string,
  opts: BuildOptions = {},
): GraphResult {
  const nodeCap = opts.nodeCap ?? 100;
  const edgeCap = opts.edgeCap ?? 200;

  const nodesMap = new Map<string, GraphNode>();
  const edgesMap = new Map<string, InternalEdge>();
  let truncated = false;

  const ensureNode = (address: string, chain: string) => {
    if (nodesMap.has(address)) return nodesMap.get(address)!;
    if (nodesMap.size >= nodeCap) {
      truncated = true;
      return null;
    }
    const node: GraphNode = {
      id: address,
      address,
      chain,
      isRoot: address === rootAddress,
      txCount: 0,
    };
    nodesMap.set(address, node);
    return node;
  };

  for (const tx of txs) {
    if (!tx.from || !tx.to) continue;
    const fromNode = ensureNode(tx.from, tx.chain);
    const toNode = ensureNode(tx.to, tx.chain);
    if (!fromNode || !toNode) continue;
    fromNode.txCount += 1;
    toNode.txCount += 1;

    // Key by token.address so two contracts both calling themselves USDC stay separate.
    const edgeKey = `${tx.from}->${tx.to}->${tx.token.address}`;
    const raw = parseRaw(tx.amount);
    const existing = edgesMap.get(edgeKey);

    if (existing) {
      existing.rawAmount += raw;
      existing.txCount += 1;
      if (tx.timestamp > existing.lastTimestamp) {
        existing.lastTimestamp = tx.timestamp;
        existing.lastTxHash = tx.txHash;
      }
    } else {
      if (edgesMap.size >= edgeCap) {
        truncated = true;
        continue;
      }
      edgesMap.set(edgeKey, {
        id: edgeKey,
        from: tx.from,
        to: tx.to,
        token: { ...tx.token },
        rawAmount: raw,
        txCount: 1,
        lastTimestamp: tx.timestamp,
        lastTxHash: tx.txHash,
      });
    }
  }

  const edges: GraphEdge[] = [...edgesMap.values()].map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    token: e.token,
    amount: formatAmount(e.rawAmount, e.token.decimals),
    txCount: e.txCount,
    lastTimestamp: e.lastTimestamp,
    lastTxHash: e.lastTxHash,
  }));

  return {
    nodes: [...nodesMap.values()],
    edges,
    truncated,
  };
}
```

**Step 2: Run, see pass**

```bash
npx jest src/modules/external-trace/__tests__/graph-builder.spec.ts
```
Expected: all 7 tests pass.

---

### Task 4b: Add batch label lookup to `LabeledEntitiesService`

**Files:**
- Modify: `backend/src/modules/labeled-entities/labeled-entities.service.ts`
- Create: `backend/src/modules/labeled-entities/__tests__/labeled-entities.service.spec.ts`

**Why before Task 5:** the service we build next consumes this method. Adding it now keeps the TDD chain green.

**Step 1: Append the batch method to `LabeledEntitiesService`**

```ts
// backend/src/modules/labeled-entities/labeled-entities.service.ts
// (existing imports stay)

/**
 * Bulk version of lookupByAddress. One round-trip for N addresses.
 * Returns a Map keyed by lowercased address; missing addresses are absent.
 */
async lookupByAddresses(addresses: string[]): Promise<Map<string, LabeledEntityEntity[]>> {
  const map = new Map<string, LabeledEntityEntity[]>();
  if (addresses.length === 0) return map;

  const lowered = Array.from(
    new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean)),
  );
  if (lowered.length === 0) return map;

  // Single query: any entity whose wallets array contains any of the input addresses.
  const matches = await this.repo
    .createQueryBuilder('e')
    .where(
      `EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(e.wallets) w
         WHERE LOWER(w) = ANY(:addresses)
       )`,
      { addresses: lowered },
    )
    .getMany();

  for (const entity of matches) {
    for (const wallet of entity.wallets ?? []) {
      const w = wallet.toLowerCase();
      if (!lowered.includes(w)) continue;
      const existing = map.get(w);
      if (existing) existing.push(entity);
      else map.set(w, [entity]);
    }
  }

  return map;
}
```

**Step 2: Test it** (uses an in-process SQLite-style helper if the repo already has one; otherwise mock the QueryBuilder)

```ts
// backend/src/modules/labeled-entities/__tests__/labeled-entities.service.spec.ts
import { LabeledEntitiesService } from '../labeled-entities.service';

describe('LabeledEntitiesService.lookupByAddresses', () => {
  it('returns an empty map for an empty input', async () => {
    const svc = new LabeledEntitiesService({
      createQueryBuilder: () => ({ where: () => ({ getMany: async () => [] }) }),
    } as never);
    const result = await svc.lookupByAddresses([]);
    expect(result.size).toBe(0);
  });

  it('groups results by lowercased address', async () => {
    const fakeRepo = {
      createQueryBuilder: () => ({
        where: () => ({
          getMany: async () => [
            { id: '1', name: 'Tornado', category: 'mixer', wallets: ['0xAAA', '0xBBB'] },
            { id: '2', name: 'Binance', category: 'exchange', wallets: ['0xCCC'] },
          ],
        }),
      }),
    } as never;
    const svc = new LabeledEntitiesService(fakeRepo);
    const result = await svc.lookupByAddresses(['0xaaa', '0xccc', '0xddd']);
    expect(result.get('0xaaa')?.[0]?.name).toBe('Tornado');
    expect(result.get('0xccc')?.[0]?.name).toBe('Binance');
    expect(result.get('0xddd')).toBeUndefined();
  });
});
```

Run: `npx jest src/modules/labeled-entities/__tests__/labeled-entities.service.spec.ts`. Expected: 2 tests pass.

---

### Task 5: Write failing service tests

**Files:**
- Create: `backend/src/modules/external-trace/__tests__/external-trace.service.spec.ts`

**Step 1: Write tests**

```ts
// backend/src/modules/external-trace/__tests__/external-trace.service.spec.ts
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ExternalTraceService } from '../external-trace.service';
import { BlockchainService } from '../../blockchain/blockchain.service';
import { LabeledEntitiesService } from '../../labeled-entities/labeled-entities.service';

const tx = (from: string, to: string, hash = '0xh') => ({
  id: 'i',
  from,
  to,
  txHash: hash,
  chain: 'ethereum',
  timestamp: '2026-05-01T00:00:00.000Z',
  amount: '1000000000000000000',
  token: { address: '0x', symbol: 'ETH', decimals: 18 },
  blockNumber: 1,
  notes: '',
  tags: [],
  crossTrace: false,
});

describe('ExternalTraceService', () => {
  let service: ExternalTraceService;
  let blockchain: { fetchHistory: jest.Mock };
  let labels: { lookupByAddresses: jest.Mock };

  beforeEach(async () => {
    blockchain = { fetchHistory: jest.fn() };
    labels = { lookupByAddresses: jest.fn().mockResolvedValue(new Map()) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExternalTraceService,
        { provide: BlockchainService, useValue: blockchain },
        { provide: LabeledEntitiesService, useValue: labels },
      ],
    }).compile();

    service = moduleRef.get(ExternalTraceService);
  });

  it('hops=1: fetches root only', async () => {
    blockchain.fetchHistory.mockResolvedValue({
      transactions: [tx('0xaaa', '0xbbb')],
      chain: 'ethereum',
      address: '0xaaa',
    });

    const result = await service.trace('0xaaa', 'ethereum', 1);
    expect(blockchain.fetchHistory).toHaveBeenCalledTimes(1);
    expect(result.root).toBe('0xaaa');
    expect(result.nodes).toHaveLength(2);
    expect(result.hops).toBe(1);
  });

  it('hops=2: fetches root plus top counterparties', async () => {
    blockchain.fetchHistory
      .mockResolvedValueOnce({
        transactions: [
          tx('0xaaa', '0xbbb', '0xh1'),
          tx('0xaaa', '0xccc', '0xh2'),
        ],
        chain: 'ethereum',
        address: '0xaaa',
      })
      .mockResolvedValue({ transactions: [], chain: 'ethereum', address: '?' });

    const result = await service.trace('0xaaa', 'ethereum', 2);
    expect(blockchain.fetchHistory.mock.calls.length).toBeGreaterThan(1);
    expect(result.hops).toBe(2);
  });

  it('attaches labels when found via the batch lookup', async () => {
    blockchain.fetchHistory.mockResolvedValue({
      transactions: [tx('0xaaa', '0xbbb')],
      chain: 'ethereum',
      address: '0xaaa',
    });
    labels.lookupByAddresses.mockResolvedValue(
      new Map([['0xbbb', [{ name: 'Tornado Cash', category: 'mixer' }]]]),
    );

    const result = await service.trace('0xaaa', 'ethereum', 1);
    const bbb = result.nodes.find((n) => n.address === '0xbbb');
    expect(bbb?.label).toEqual({ name: 'Tornado Cash', category: 'mixer' });
    // One round-trip total, not one per node.
    expect(labels.lookupByAddresses).toHaveBeenCalledTimes(1);
  });

  it('serves a second identical request from cache (no extra fetchHistory call)', async () => {
    blockchain.fetchHistory.mockResolvedValue({
      transactions: [tx('0xaaa', '0xbbb')],
      chain: 'ethereum',
      address: '0xaaa',
    });
    await service.trace('0xaaa', 'ethereum', 1);
    await service.trace('0xaaa', 'ethereum', 1);
    expect(blockchain.fetchHistory).toHaveBeenCalledTimes(1);
  });

  it('rejects EVM address on tron chain', async () => {
    await expect(service.trace('0xaaa', 'tron' as any, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lowercases EVM addresses, preserves Tron', async () => {
    blockchain.fetchHistory.mockResolvedValue({
      transactions: [],
      chain: 'ethereum',
      address: '0xaaa',
    });
    await service.trace('0xABC0000000000000000000000000000000000DEF', 'ethereum', 1);
    expect(blockchain.fetchHistory).toHaveBeenCalledWith(
      '0xabc0000000000000000000000000000000000def',
      'ethereum',
      expect.any(Object),
    );
  });
});
```

**Step 2: Run, see fail** (`Cannot find module '../external-trace.service'`).

---

### Task 6: Implement ExternalTraceService — defines the response contract

**Files:**
- Create: `backend/src/modules/external-trace/external-trace.service.ts`

**Step 1: Write implementation**

The service does three things on top of `buildGraph`: (a) a 60-second response cache keyed by `(chain, address, hops)`, (b) a single batched label lookup, (c) the hop-2 parallel fan-out. `hops` is typed as `number` and clamped internally — no unsafe literal casts.

```ts
// backend/src/modules/external-trace/external-trace.service.ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BlockchainService, TransactionResult } from '../blockchain/blockchain.service';
import { LabeledEntitiesService } from '../labeled-entities/labeled-entities.service';
import { buildGraph, GraphResult } from './graph-builder';

const HOP_1_TX_LIMIT = 50;
const HOP_2_TX_LIMIT = 30;
const HOP_2_FANOUT = 5;
const NODE_CAP = 100;
const EDGE_CAP = 200;

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;

const EVM_CHAINS = ['ethereum', 'polygon', 'arbitrum', 'base'];

export interface TraceResponse extends GraphResult {
  root: string;
  chain: string;
  hops: number;
  cachedAt: string; // ISO timestamp set at generation; preserved across cache hits
}

interface CacheEntry {
  result: TraceResponse;
  expiresAt: number;
}

@Injectable()
export class ExternalTraceService {
  private readonly logger = new Logger(ExternalTraceService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly blockchain: BlockchainService,
    private readonly labels: LabeledEntitiesService,
  ) {}

  async trace(rawAddress: string, chain: string, hopsIn: number): Promise<TraceResponse> {
    const hops = hopsIn === 2 ? 2 : 1; // clamp; DTO bounds it but defense in depth
    const address = this.normalizeAddress(rawAddress, chain);
    this.validateAddressChain(address, chain);

    const cacheKey = `${chain}:${address}:${hops}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.result;
    }

    const allTxs: TransactionResult[] = [];

    // Hop 1
    const rootHistory = await this.blockchain.fetchHistory(address, chain, {
      offset: HOP_1_TX_LIMIT,
    });
    allTxs.push(...rootHistory.transactions);

    // Hop 2 (parallelized, capped)
    if (hops === 2) {
      const counterCounts = new Map<string, number>();
      for (const tx of rootHistory.transactions) {
        const other = tx.from === address ? tx.to : tx.from;
        if (!other || other === address) continue;
        counterCounts.set(other, (counterCounts.get(other) ?? 0) + 1);
      }
      const topCps = [...counterCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, HOP_2_FANOUT)
        .map(([addr]) => addr);

      const hop2Results = await Promise.all(
        topCps.map((cp) =>
          this.blockchain
            .fetchHistory(cp, chain, { offset: HOP_2_TX_LIMIT })
            .catch((err) => {
              this.logger.warn(`hop-2 fetch failed for ${cp}: ${err.message}`);
              return null;
            }),
        ),
      );

      for (const r of hop2Results) {
        if (!r) continue;
        allTxs.push(...r.transactions);
      }
    }

    const graph = buildGraph(allTxs, address, {
      nodeCap: NODE_CAP,
      edgeCap: EDGE_CAP,
    });

    // Batch label lookup: one SQL round-trip for every node in the graph.
    const addresses = graph.nodes.map((n) => n.address);
    const labelMap = await this.labels.lookupByAddresses(addresses);
    for (const node of graph.nodes) {
      const entities = labelMap.get(node.address.toLowerCase());
      if (entities && entities.length > 0) {
        node.label = { name: entities[0].name, category: entities[0].category };
      }
    }

    const result: TraceResponse = {
      root: address,
      chain,
      hops,
      ...graph,
      cachedAt: new Date().toISOString(),
    };

    this.putCache(cacheKey, result);
    return result;
  }

  private putCache(key: string, result: TraceResponse) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // Simple LRU-ish: drop oldest insertion. Map iteration order = insertion order.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  private normalizeAddress(addr: string, chain: string): string {
    const t = addr.trim();
    return EVM_CHAINS.includes(chain) ? t.toLowerCase() : t;
  }

  private validateAddressChain(addr: string, chain: string): void {
    if (EVM_CHAINS.includes(chain)) {
      if (!/^0x[a-f0-9]{40}$/.test(addr)) {
        throw new BadRequestException(`${chain} requires an EVM address (0x + 40 hex)`);
      }
    } else if (chain === 'tron') {
      if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
        throw new BadRequestException('tron requires a base58 address starting with T');
      }
    } else {
      throw new BadRequestException(`unsupported chain: ${chain}`);
    }
  }
}
```

The service tests at Task 5 already mock the labels service. Update those mocks to provide `lookupByAddresses` (returning a `Map`) instead of `lookupByAddress` — see the Task 5 patch below.

**Step 2: Run service tests, see pass**

```bash
npx jest src/modules/external-trace/__tests__/external-trace.service.spec.ts
```
Expected: all 6 tests pass.

**Step 3: Run full suite to confirm no regressions**

```bash
npx jest
```
Expected: green.

---

### Task 7: Create the public-key guard

**Files:**
- Create: `backend/src/modules/external-trace/website-key.guard.ts`

```ts
// backend/src/modules/external-trace/website-key.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class WebsiteKeyGuard implements CanActivate {
  private readonly logger = new Logger(WebsiteKeyGuard.name);
  private readonly expected: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('DAUBERT_WEBSITE_API_KEY');
    if (!raw || raw.length < 16) {
      throw new Error(
        'DAUBERT_WEBSITE_API_KEY must be set (>=16 chars). The external trace endpoint refuses to start without it.',
      );
    }
    this.expected = Buffer.from(raw, 'utf8');
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    // Node lowercases all incoming HTTP header names. No uppercase fallback needed.
    const provided = req.headers['x-daubert-website-key'];

    if (typeof provided !== 'string' || provided.length === 0) {
      throw new UnauthorizedException('Missing X-Daubert-Website-Key header');
    }

    const got = Buffer.from(provided, 'utf8');
    if (got.length !== this.expected.length) {
      throw new UnauthorizedException('Invalid X-Daubert-Website-Key');
    }
    if (!timingSafeEqual(got, this.expected)) {
      throw new UnauthorizedException('Invalid X-Daubert-Website-Key');
    }
    return true;
  }
}
```

The guard reads the key once at construction and stores a `Buffer` for constant-time compare. Throwing in the constructor means the NestJS bootstrap fails loudly if the env var is unset — there is no silent fallback to no-auth.

---

### Task 7b: Create the forwarded-IP throttler guard

**Files:**
- Create: `backend/src/modules/external-trace/forwarded-ip.guard.ts`

```ts
// backend/src/modules/external-trace/forwarded-ip.guard.ts
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ForwardedIpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const fwd = (req.headers?.['x-forwarded-for'] as string | undefined) ?? '';
    const first = fwd.split(',')[0]?.trim();
    return Promise.resolve(first || req.ip || 'unknown');
  }
}
```

This is a `ThrottlerGuard` subclass (not a separate `ThrottlerStorage`/tracker class — the file name now matches). Used in place of the stock `ThrottlerGuard` on the controller. With `app.set('trust proxy', true)` in `main.ts`, Express also populates `req.ip` as a fallback.

---

### Task 8: Create the controller

**Files:**
- Create: `backend/src/modules/external-trace/external-trace.controller.ts`

```ts
// backend/src/modules/external-trace/external-trace.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { TraceQueryDto } from './dto/trace-query.dto';
import { ExternalTraceService } from './external-trace.service';
import { WebsiteKeyGuard } from './website-key.guard';
import { ForwardedIpThrottlerGuard } from './forwarded-ip.guard';

@Controller('external/trace')
@UseGuards(ForwardedIpThrottlerGuard, WebsiteKeyGuard)
export class ExternalTraceController {
  constructor(private readonly service: ExternalTraceService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get()
  trace(@Query() query: TraceQueryDto) {
    return this.service.trace(query.address, query.chain, query.hops);
  }
}
```

The DTO has `@Min(1) @Max(2)` on `hops`, so by the time the service receives it, it's already a bounded integer. The service signature accepts `number` and clamps internally — no unsafe `as 1 | 2` cast.

Note the order of guards: `ForwardedIpThrottlerGuard` runs first so a flood from a single IP gets rejected before the key compare even runs. `WebsiteKeyGuard` runs second so a missing/invalid key returns 401.

---

### Task 9: Create the module

**Files:**
- Create: `backend/src/modules/external-trace/external-trace.module.ts`

```ts
// backend/src/modules/external-trace/external-trace.module.ts
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { LabeledEntitiesModule } from '../labeled-entities/labeled-entities.module';
import { ExternalTraceController } from './external-trace.controller';
import { ExternalTraceService } from './external-trace.service';
import { WebsiteKeyGuard } from './website-key.guard';
import { ForwardedIpThrottlerGuard } from './forwarded-ip.guard';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', limit: 10, ttl: 60_000 }]),
    BlockchainModule,
    LabeledEntitiesModule,
  ],
  controllers: [ExternalTraceController],
  providers: [ExternalTraceService, WebsiteKeyGuard, ForwardedIpThrottlerGuard],
})
export class ExternalTraceModule {}
```

---

### Task 10: Register in AppModule

**Files:**
- Modify: `backend/src/app.module.ts`

**Step 1: Add import**

```ts
import { ExternalTraceModule } from './modules/external-trace/external-trace.module';
```

**Step 2: Append to the `imports` array of `@Module({...})`**

```ts
imports: [
  // ...existing
  ExternalTraceModule,
],
```

---

### Task 11: E2E test

**Files:**
- Create: `backend/test/setup-external-trace.ts`
- Create: `backend/test/external-trace.e2e-spec.ts`
- Modify: `backend/jest.config.js` (or the `jest` block in `package.json`) — register the setup file under `setupFiles` for e2e specs

**Why a setup file:** assigning `process.env.X = ...` at the top of a spec works today under CJS but silently breaks if Jest is ever switched to ESM — ESM hoists imports above statements, so the `AppModule` constructor would run before the env var is set and the `WebsiteKeyGuard` constructor would throw. `setupFiles` runs before the module registry initializes, regardless of module system.

**Step 1: Setup file**

```ts
// backend/test/setup-external-trace.ts
// Runs before any module is loaded. Must be wired via jest.config setupFiles.
process.env.DAUBERT_WEBSITE_API_KEY = 'test-key-test-key-test'; // 22 chars, >=16
```

**Step 2: Jest config**

In `jest.config.js` (or the inline `jest` config in `package.json`):

```js
module.exports = {
  // ...existing,
  setupFiles: ['<rootDir>/test/setup-external-trace.ts'],
};
```

If the existing config already defines `setupFiles`, append to the array rather than replacing.

**Step 3: The spec itself**

```ts
// backend/test/external-trace.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { BlockchainService } from '../src/modules/blockchain/blockchain.service';
import { LabeledEntitiesService } from '../src/modules/labeled-entities/labeled-entities.service';

const KEY = process.env.DAUBERT_WEBSITE_API_KEY!;

describe('GET /external/trace (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BlockchainService)
      .useValue({
        fetchHistory: jest.fn().mockResolvedValue({
          transactions: [],
          chain: 'ethereum',
          address: '0xaaa',
        }),
      })
      .overrideProvider(LabeledEntitiesService)
      .useValue({ lookupByAddresses: jest.fn().mockResolvedValue(new Map()) })
      .compile();

    app = moduleRef.createNestApplication();
    (app.getHttpAdapter().getInstance() as any).set('trust proxy', true);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => app.close());

  it('returns 401 when the key header is missing', () =>
    request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=ethereum&hops=1')
      .expect(401));

  it('returns 401 when the key header is wrong', () =>
    request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=ethereum&hops=1')
      .set('X-Daubert-Website-Key', 'wrong-key-wrong-key-wr')
      .expect(401));

  it('returns 400 for missing address (with valid key)', () =>
    request(app.getHttpServer())
      .get('/external/trace?chain=ethereum&hops=1')
      .set('X-Daubert-Website-Key', KEY)
      .expect(400));

  it('returns 400 for unsupported chain (with valid key)', () =>
    request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=solana&hops=1')
      .set('X-Daubert-Website-Key', KEY)
      .expect(400));

  it('returns 200 + graph shape on valid request', async () => {
    const res = await request(app.getHttpServer())
      .get('/external/trace?address=0x0000000000000000000000000000000000000000&chain=ethereum&hops=1')
      .set('X-Daubert-Website-Key', KEY)
      .expect(200);
    expect(res.body).toMatchObject({
      root: '0x0000000000000000000000000000000000000000',
      chain: 'ethereum',
      hops: 1,
      nodes: expect.any(Array),
      edges: expect.any(Array),
      truncated: false,
    });
  });
});
```

Run: `npx jest test/external-trace.e2e-spec.ts`. Expected: 5 tests pass.

---

### Task 12: Update .env.example

**Files:**
- Modify: `backend/.env.example`

Add a line documenting the new required var. Do NOT add the marketing site to `ALLOWED_ORIGINS` — the external endpoint is server-to-server and never needs CORS.

```
# External trace API
# Shared secret the marketing site server sends in X-Daubert-Website-Key.
# Required: the backend refuses to start if this is missing or shorter than 16 chars.
# Dev: use the literal string "dev-key-dev-key-dev" (>=16 chars).
# Prod: generate a fresh 32-byte secret per environment.
DAUBERT_WEBSITE_API_KEY=
```

The marketing site sets `DAUBERT_API_KEY` (server-only) to the same value. See `../website-daubert/docs/plans/2026-05-17-interactive-trace-demo.md`.

---

### Task 13: Add `app.set('trust proxy', true)` to main.ts

**Files:**
- Modify: `backend/src/main.ts`

Right after `const app = await NestFactory.create(...)`, add:

```ts
// Trust X-Forwarded-For from Cloud Run + the marketing site proxy.
// Required for the external-trace throttler to count real visitor IPs.
(app.getHttpAdapter().getInstance() as any).set('trust proxy', true);
```

Without this, Express sets `req.ip` to the local socket address. Our `ForwardedIpThrottlerGuard` reads `X-Forwarded-For` directly so it would still work; `trust proxy` makes the rest of the app behave consistently and is the documented Cloud Run pattern.

---

### Task 14: Document the endpoint

**Files:**
- Modify: `backend/README.md`

Add a section "External API" near the top:

```markdown
## External API

### GET /external/trace

Keyed, rate-limited wallet trace. Called server-to-server by the marketing site only — there is no browser CORS allowance, even with a valid key.

Headers:
- `X-Daubert-Website-Key: <key>` — required. Compared in constant time against `DAUBERT_WEBSITE_API_KEY`.

Query:
- `address` (required) — EVM address (`0x` + 40 hex) or Tron address (base58, 34 chars starting with T)
- `chain` (required) — one of `ethereum | polygon | arbitrum | base | tron`
- `hops` (optional, default 1) — 1 or 2

Limits:
- 10 requests / minute per visitor IP (counted from `X-Forwarded-For`)
- 50 txs at the root, 30 txs per hop-2 node, fanout 5, node cap 100, edge cap 200

Example:
```
curl "http://localhost:8081/external/trace?address=0x4f3b...c91d&chain=ethereum&hops=2" \
  -H "X-Daubert-Website-Key: $DAUBERT_WEBSITE_API_KEY"
```

Response:
```json
{
  "root": "0x4f3b...",
  "chain": "ethereum",
  "hops": 2,
  "nodes": [
    { "id": "0x4f3b...", "address": "0x4f3b...", "chain": "ethereum", "isRoot": true, "txCount": 18, "label": null }
  ],
  "edges": [
    { "id": "0x4f3b...->0x8a2e...->ETH", "from": "0x4f3b...", "to": "0x8a2e...", "token": {...}, "amount": "120.0", "txCount": 3, "lastTimestamp": "...", "lastTxHash": "..." }
  ],
  "truncated": false,
  "cachedAt": "2026-05-17T..."
}
```
```

---

### Task 15: Smoke test against a live address

**Step 1: Set the dev key and start the backend**

```bash
cd /Users/Sam/Work/Incite/dev/daubert/backend
echo "DAUBERT_WEBSITE_API_KEY=dev-key-dev-key-dev" >> .env.local
npm run start:dev
```

**Step 2: Confirm missing key → 401**

```bash
curl -i "http://127.0.0.1:8081/external/trace?address=0xd8da6bf26964af9d7eed9e03e53415d37aa96045&chain=ethereum&hops=1"
```

Expected: `HTTP/1.1 401 Unauthorized`.

**Step 3: Hit with the key, real address**

```bash
curl -s "http://127.0.0.1:8081/external/trace?address=0xd8da6bf26964af9d7eed9e03e53415d37aa96045&chain=ethereum&hops=1" \
  -H "X-Daubert-Website-Key: dev-key-dev-key-dev" | jq .
```

Expected: 200 with `nodes` and `edges` populated. `root` matches input (lowercased).

**Step 4: Confirm rate limit by visitor IP, not proxy IP**

```bash
# Simulate two different visitors via X-Forwarded-For:
for i in {1..11}; do
  curl -s -o /dev/null -w "visitor-A %{http_code}\n" \
    -H "X-Daubert-Website-Key: dev-key-dev-key-dev" \
    -H "X-Forwarded-For: 203.0.113.10" \
    "http://127.0.0.1:8081/external/trace?address=0xd8da6bf26964af9d7eed9e03e53415d37aa96045&chain=ethereum&hops=1"
done
# Then immediately try a different forwarded IP:
curl -s -o /dev/null -w "visitor-B %{http_code}\n" \
  -H "X-Daubert-Website-Key: dev-key-dev-key-dev" \
  -H "X-Forwarded-For: 203.0.113.99" \
  "http://127.0.0.1:8081/external/trace?address=0xd8da6bf26964af9d7eed9e03e53415d37aa96045&chain=ethereum&hops=1"
```

Expected: visitor-A gets ten `200`s then one `429`. Visitor-B (different IP) still gets `200`.

---

### Task 16: Cloud Run env update (deploy-time, not code)

Add to the Cloud Run service:
- `DAUBERT_WEBSITE_API_KEY` = freshly generated 32-byte secret (e.g. `openssl rand -hex 32`). Store in Secret Manager, mount as env var.

Do **not** add the marketing site domain to `ALLOWED_ORIGINS` — `/external/trace` is server-to-server. Leaving CORS as-is means a stolen key still cannot be used from a browser.

Hand the generated key to whoever sets `DAUBERT_API_KEY` on the marketing site's host (Vercel, Cloud Run, wherever the Next.js server runs).

---

## Final verification

```bash
cd /Users/Sam/Work/Incite/dev/daubert/backend
npx jest        # full suite green
npm run build   # nest build succeeds
git status      # all changes visible for user review
```

Per CLAUDE.md: do not commit; leave the diff for the user.
