# Token Usage Metering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture Anthropic API token usage on every call, persist per-request + per-(org, user, month, model) rollups, and surface cost analytics under `/superadmin/token-usage` — mirroring the Stackpad pattern but adapted to Daubert's org/case hierarchy.

**Architecture:** Two-layer storage (per-request `token_usage` audit row + atomic `INSERT ... ON CONFLICT` monthly rollup keyed by `(orgId, userId, period, model)`). All Anthropic traffic flows through a single `AnthropicProvider` (verified — no other call sites), so we wrap the two methods there to surface `usage`, and `AiService` calls a new `TokenUsageService.record(...)` after each completion with the conversation context it already has. Pricing lives in code constants (cost computed at read time, never stored). Superadmin API + dashboard replicate mission-control's Stackpad page adapted to org/case slices.

**Tech Stack:** NestJS, TypeORM (Postgres), Anthropic SDK, OpenAPI 3, Next.js 14 (App Router), react-icons/fa6, Tailwind. Tests: Jest (backend), no new frontend tests required.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/database/entities/token-usage.entity.ts` | Create | Per-request LLM call audit log (org/user/case/conversation/message FKs + token counts per category). |
| 2 | `backend/src/database/entities/monthly-usage.entity.ts` | Create | Atomic rollup keyed `(orgId, userId, period, model)` for O(1) hero KPI lookups. |
| 3 | `backend/src/database/entities/index.ts` | Modify | Export the two new entities AND add them to the exported `entities` array (consumed by `DatabaseModule` via `database.config.ts` — `app.module.ts` is NOT touched). |
| 4 | `backend/src/modules/superadmin/token-usage/pricing.ts` | Create | Per-model `$/MTok` constants (Opus 4.6/4.7, Sonnet 4.6, Haiku 4.5) + `calculateCost()` function. |
| 5 | `backend/src/modules/superadmin/token-usage/pricing.spec.ts` | Create | Unit tests for `calculateCost()` across known + unknown models. |
| 6 | `backend/src/modules/superadmin/token-usage/token-usage.service.ts` | Create | Write path (`record()`) + read aggregates (`overview`, `byOrg`, `byUser`, `byCase`, `byConversation`, `orgModelMatrix`, `cacheEffectiveness`). |
| 7 | `backend/src/modules/superadmin/token-usage/token-usage.service.spec.ts` | Create | Unit tests with a real in-memory SQLite test DB (the `record()` upsert requires actual SQL execution — `ai.service.spec.ts` uses pure mocks and is NOT a fit). |
| 8 | `backend/src/modules/superadmin/token-usage/token-usage.controller.ts` | Create | 6 GET endpoints under `superadmin/token-usage`, all gated by `@RequireSuperAdmin()`. |
| 9 | `backend/src/modules/superadmin/token-usage/token-usage.controller.spec.ts` | Create | Controller-level smoke tests with mocked service. |
| 10 | `backend/src/modules/superadmin/token-usage/token-usage.module.ts` | Create | NestJS module wiring entities + service + controller. Exports `TokenUsageService` for `AiModule` to consume. |
| 11 | `backend/src/modules/superadmin/superadmin.module.ts` | Modify | Import `TokenUsageModule`. |
| 12 | `backend/src/modules/ai/providers/llm-provider.interface.ts` | Modify | Add `usage` to the `end_turn` stream event; change `generateText` return to `{ text, usage }`. |
| 13 | `backend/src/modules/ai/providers/anthropic.provider.ts` | Modify | Surface `usage` on both `streamChat` (`end_turn` event) and `generateText` (return shape). |
| 14 | `backend/src/modules/ai/ai.service.ts` | Modify | Resolve `{orgId, userId, caseId}` once per stream; helper `recordUsage(response, messageId)` called at all three response-exit points (end-turn save, tool-use save, repeat-tool guard). |
| 15 | `backend/src/modules/ai/ai.module.ts` | Modify | Import `TokenUsageModule` for DI. |
| 16 | `contracts/schemas/superadmin.yaml` | Modify | Add `TokenUsageOverview`, `TokenUsageByOrgRow`, `TokenUsageByUserRow`, `TokenUsageByCaseRow`, `TokenUsageByConversationRow`, `TokenUsageOrgModelMatrixRow`, `TokenUsageCacheEffectiveness` schemas. |
| 17 | `contracts/paths/superadmin.yaml` | Modify | Add the six new GET paths under `/superadmin/token-usage/*`. |
| 18 | `contracts/openapi.yaml` | Modify | Add path `$ref` entries and `components.schemas` entries for all new paths/schemas — NOT auto-included; required. |
| 19 | `backend/src/generated/api-types.ts` | Regenerate | Via `npm run gen`. |
| 20 | `frontend/src/generated/api-types.ts` | Regenerate | Via `npm run gen`. |
| 21 | `frontend/src/lib/api-client.ts` | Modify | Add typed `superadminTokenUsage*` methods. |
| 22 | `frontend/src/app/superadmin/layout.tsx` | Modify | Add `Token Usage` nav item with `FaChartLine` icon. |
| 23 | `frontend/src/app/superadmin/token-usage/page.tsx` | Create | Dashboard page: window selector (7/30/90d), hero KPI grid, cache effectiveness bar, org × model table, top orgs/users/cases/conversations tables. |
| 24 | `backend/src/database/migrations/<timestamp>-AddTokenUsageMetering.ts` | Generate (via `./migrations.sh --prod --generate AddTokenUsageMetering`) | Prod migration. Generated, NOT applied. |

**User-facing change:** Superadmins get a new dashboard showing 7/30/90-day cost trends, per-org and per-user spend rankings, cache effectiveness, and per-conversation cost drill-down across the entire platform.

**Dev-facing change:** Every Anthropic call writes a `token_usage` row + atomic `monthly_usage` upsert. A pricing constants module is the single source of truth for `$/MTok`. Future LLM call sites just need to call `TokenUsageService.record(...)` to be included in metering.

---

## Design notes (read before starting)

### Schema shape

**`token_usage`** — one row per Anthropic API call. Columns:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | from `BaseEntity` |
| `created_at` / `updated_at` | timestamptz | from `BaseEntity` |
| `org_id` | uuid (FK → orgs, ON DELETE SET NULL, nullable) | denormalized |
| `user_id` | uuid (FK → users, ON DELETE SET NULL, nullable) | denormalized |
| `case_id` | uuid (FK → cases, ON DELETE SET NULL, nullable) | denormalized; null for title generation |
| `conversation_id` | uuid (FK → conversations, ON DELETE SET NULL, nullable) | nullable for non-chat surfaces |
| `message_id` | uuid (FK → messages, ON DELETE SET NULL, nullable) | the assistant message produced by this call; null for title generation |
| `surface` | varchar | `'chat'` \| `'title-generation'` |
| `model` | varchar | full model ID from request |
| `input_tokens` | int | uncached input |
| `output_tokens` | int | includes thinking |
| `cache_read_input_tokens` | int | |
| `cache_creation_5m_input_tokens` | int | |
| `cache_creation_1h_input_tokens` | int | always 0 today (no 1h TTL in use); future-proof column |

Indexes: `(org_id, created_at DESC)`, `(user_id, created_at DESC)`, `(case_id, created_at DESC)`, `(conversation_id)`.

**Why ON DELETE SET NULL on every FK:** historical cost data must survive org/user/case deletion. Foreign keys give us referential pretty-printing when present but never block deletion.

**`monthly_usage`** — atomic rollup. Columns:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | from `BaseEntity` |
| `created_at` / `updated_at` | timestamptz | from `BaseEntity` |
| `org_id` | uuid (FK → orgs, ON DELETE CASCADE) | |
| `user_id` | uuid (FK → users, ON DELETE CASCADE) | |
| `period` | char(7) | `YYYY-MM`, UTC |
| `model` | varchar | |
| `call_count` | bigint | |
| `input_tokens` | bigint | |
| `output_tokens` | bigint | |
| `cache_read_input_tokens` | bigint | |
| `cache_creation_5m_input_tokens` | bigint | |
| `cache_creation_1h_input_tokens` | bigint | |

Unique constraint: `(org_id, user_id, period, model)` — drives the `ON CONFLICT` clause.

### Pricing source of truth

Verified live from [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing):

```ts
// backend/src/modules/superadmin/token-usage/pricing.ts
type ModelPricing = {
  input: number;          // $ / MTok
  output: number;         // $ / MTok
  cacheWrite5m: number;   // $ / MTok
  cacheWrite1h: number;   // $ / MTok
  cacheRead: number;      // $ / MTok
};

export const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7':   { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.50 },
  'claude-opus-4-6':   { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.50 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6,  cacheRead: 0.30 },
  'claude-haiku-4-5':  { input: 1, output: 5,  cacheWrite5m: 1.25, cacheWrite1h: 2,  cacheRead: 0.10 },
};

export type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreation5mInputTokens: number;
  cacheCreation1hInputTokens: number;
};

/**
 * Returns USD cost. `null` if the model is unknown — the caller decides how
 * to surface that (UI shows "—", API includes the row with cost: null).
 * Never throws; pricing drift must not break dashboards.
 */
export function calculateCost(model: string, tokens: TokenCounts): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (
    (tokens.inputTokens * p.input
      + tokens.outputTokens * p.output
      + tokens.cacheReadInputTokens * p.cacheRead
      + tokens.cacheCreation5mInputTokens * p.cacheWrite5m
      + tokens.cacheCreation1hInputTokens * p.cacheWrite1h) / 1_000_000
  );
}
```

Cost is **always** computed at read time. Retroactive price corrections / new model additions cost nothing.

### Hook point — provider surfaces, AiService records

`AnthropicProvider` should not know about the database. The provider already yields `{ type: 'end_turn', response }`, and `response.usage` is on the Beta message. So:

1. **Interface change:** add a discriminated `{ type: 'usage', usage: Anthropic.Usage, model: string }` event OR just rely on `response.usage` from the existing `end_turn` event. **Pick the latter** — no interface change, minimal churn.
2. `generateText` currently returns `string | null`. Change to `Promise<{ text: string | null; usage: Anthropic.MessageDeltaUsage | Anthropic.Usage; model: string }>`. This IS an interface change — but `generateText` has exactly one caller (`AiService.generateTitle`).
3. In `AiService.streamChat`, after the loop persists the assistant message, call `tokenUsageService.record({...})` with the resolved org/case/user and the assistant `messageId`. Wrap the call in `try/catch` so metering failure never breaks the stream.
4. Same for title generation: call `tokenUsageService.record({ surface: 'title-generation', conversationId, messageId: null, ... })`.

### Resolving (orgId, userId, caseId) once per stream

`AiService.streamChat(conversationId, userId, ...)` already has `userId`. To get `orgId` and `caseId`, look up the conversation once at the top of the method:

```ts
const conversation = await this.conversationRepo.findOne({
  where: { id: conversationId },
  relations: ['case'],
});
const caseId = conversation.caseId;
const orgId = conversation.case.orgId;
```

Cache these locally and pass to every `tokenUsageService.record(...)` call inside the loop. **One** extra query per stream — negligible.

### Monthly upsert SQL

TypeORM lacks first-class atomic upserts. Use the QueryRunner / raw SQL:

```ts
await this.dataSource.query(
  `INSERT INTO monthly_usage
     (id, created_at, updated_at, org_id, user_id, period, model,
      call_count, input_tokens, output_tokens, cache_read_input_tokens,
      cache_creation_5m_input_tokens, cache_creation_1h_input_tokens)
   VALUES (gen_random_uuid(), NOW(), NOW(), $1, $2, $3, $4,
           1, $5, $6, $7, $8, $9)
   ON CONFLICT (org_id, user_id, period, model)
   DO UPDATE SET
     call_count                       = monthly_usage.call_count + 1,
     input_tokens                     = monthly_usage.input_tokens + EXCLUDED.input_tokens,
     output_tokens                    = monthly_usage.output_tokens + EXCLUDED.output_tokens,
     cache_read_input_tokens          = monthly_usage.cache_read_input_tokens + EXCLUDED.cache_read_input_tokens,
     cache_creation_5m_input_tokens   = monthly_usage.cache_creation_5m_input_tokens + EXCLUDED.cache_creation_5m_input_tokens,
     cache_creation_1h_input_tokens   = monthly_usage.cache_creation_1h_input_tokens + EXCLUDED.cache_creation_1h_input_tokens,
     updated_at                       = NOW()`,
  [orgId, userId, period, model, inputTokens, outputTokens, cacheReadInputTokens, cacheCreation5m, cacheCreation1h],
);
```

Period is computed in UTC: `new Date().toISOString().slice(0, 7)` → `'2026-06'`.

### Why the per-request insert AND the rollup

The per-request `token_usage` insert + the monthly upsert happen in the same `record()` call, both inside one `try/catch`. The two writes are NOT in a transaction — if the per-request insert succeeds and the rollup fails, the rollup will be inconsistent with the per-request truth. We accept this because:

1. Rollup is reconstructable from per-request data via a recovery query (one cron, never written until needed).
2. Wrapping both in a transaction would block the user's response for two writes that have nothing to do with their request.

If the rollup ever drifts noticeably, build the recovery cron. Don't pre-optimize for it.

### Per-conversation aggregation queries

Per-conversation cost (used by `byConversation` endpoint) requires summing `token_usage` rows by `conversation_id` over the time window then applying pricing in code. Top-20 is fine at Daubert's scale. Index `(conversation_id)` covers it.

### Cache effectiveness

`cache_hit_rate = sum(cache_read_input_tokens) / (sum(input_tokens) + sum(cache_read_input_tokens) + sum(cache_creation_5m) + sum(cache_creation_1h))`. Returned as a single percentage over the selected window plus a breakdown of cache-read vs cache-creation vs uncached tokens for a stacked bar.

### Time windows

7 / 30 / 90 day selector — matches mission-control's Stackpad page. Default is 30. Query: `WHERE created_at >= NOW() - INTERVAL '<n> days'`.

### Dashboard sections (mirror Stackpad page)

1. **Hero row:** total cost, total tokens, total API calls, cache hit rate.
2. **Cache effectiveness bar:** stacked single horizontal bar — cache reads vs 5m cache writes vs 1h cache writes vs uncached input vs output.
3. **Top orgs table:** rank, name, calls, tokens, cost.
4. **Top users table:** rank, email, org, calls, cost.
5. **Top cases table:** rank, name, org, calls, cost.
6. **Org × model matrix:** orgs as rows, models as columns; cost per cell.
7. **Top conversations table:** title, case, user, turns, cost.

All tables show "—" for `cost: null` (unknown model) — pricing drift never blanks the page.

### What we are NOT doing (out of scope)

- No quota enforcement / budget alerts.
- No exposing cost data to org owners or guests (superadmin-only).
- No historical backfill — tokens were never tracked before today; pre-launch period shows zero. Honest.
- No batch API discount logic — Daubert doesn't use the batch API.
- No 1-hour cache write tracking in practice (column exists, always 0; populated automatically if anyone adds `ttl: '1h'` later).
- No fast mode / `inference_geo` handling — verified neither is invoked at the call site.
- No `cost` column on `token_usage` — computed at read time so retroactive corrections are free.

---

## Engineering Decisions Made

- **Pricing as code constants, not a DB table.** Stackpad does this and it's the right call — pricing change = code change = code review.
- **Cost computed at read time, never stored.** Allows price corrections after the fact with zero migration.
- **Per-request insert + rollup upsert run in same `record()` call, no shared transaction.** Drift is recoverable from per-request truth.
- **Period format `YYYY-MM` UTC, char(7).** Simple natural sort, no timezone ambiguity.
- **Surface column = `'chat' | 'title-generation'`.** Maps to Stackpad's `surface` field. Lets us slice "what's the AI spending on titles" if anyone wonders.
- **All FKs on `token_usage` use `ON DELETE SET NULL`.** Historical cost data survives org/user/case deletion.
- **All FKs on `monthly_usage` use `ON DELETE CASCADE`.** Rollups for deleted orgs become irrelevant; per-request audit log retains the original cost record.
- **`generateText` return type changed to `{ text, usage, model }`.** Single caller (`generateTitle`), so the interface churn is contained.
- **Unknown model → `cost: null`, never throw.** Dashboard renders "—". Pricing-drift never blanks the page.
- **No NestJS interceptor.** Considered wrapping the provider via an interceptor; rejected — interceptors operate on HTTP boundaries, not internal provider calls. Direct method change is simpler.
- **No queue / async worker.** Stackpad writes synchronously and it works fine; same here.

---

## Tasks

Each task = one focused unit of work. Steps inside are 2–5 min each. Pattern per the user's global config: implementer (sonnet) → spec reviewer (sonnet) → next task. Final whole-feature opus review at the end. No per-task code-quality review.

---

### Task 1: Create `token_usage` and `monthly_usage` entities

**Files:**
- Create: `backend/src/database/entities/token-usage.entity.ts`
- Create: `backend/src/database/entities/monthly-usage.entity.ts`
- Modify: `backend/src/database/entities/index.ts`
- Modify: `backend/src/app.module.ts` (register entities in TypeORM root config)

**Step 1 — Write the entities.**

```ts
// token-usage.entity.ts
import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { OrganizationEntity } from './organization.entity';
import { UserEntity } from './user.entity';
import { CaseEntity } from './case.entity';
import { ConversationEntity } from './conversation.entity';
import { MessageEntity } from './message.entity';

export type TokenUsageSurface = 'chat' | 'title-generation';

@Entity('token_usage')
@Index(['orgId', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['caseId', 'createdAt'])
@Index(['conversationId'])
export class TokenUsageEntity extends BaseEntity {
  @Column({ name: 'org_id', type: 'uuid', nullable: true })
  orgId: string | null;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;

  @Column({ name: 'case_id', type: 'uuid', nullable: true })
  caseId: string | null;

  @ManyToOne(() => CaseEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity | null;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  @ManyToOne(() => ConversationEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'conversation_id' })
  conversation: ConversationEntity | null;

  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId: string | null;

  @ManyToOne(() => MessageEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'message_id' })
  message: MessageEntity | null;

  @Column({ type: 'varchar', length: 32 })
  surface: TokenUsageSurface;

  @Column({ type: 'varchar', length: 128 })
  model: string;

  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens: number;

  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens: number;

  @Column({ name: 'cache_read_input_tokens', type: 'int', default: 0 })
  cacheReadInputTokens: number;

  @Column({ name: 'cache_creation_5m_input_tokens', type: 'int', default: 0 })
  cacheCreation5mInputTokens: number;

  @Column({ name: 'cache_creation_1h_input_tokens', type: 'int', default: 0 })
  cacheCreation1hInputTokens: number;
}
```

```ts
// monthly-usage.entity.ts
import { Entity, Column, Unique, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { OrganizationEntity } from './organization.entity';
import { UserEntity } from './user.entity';

@Entity('monthly_usage')
@Unique(['orgId', 'userId', 'period', 'model'])
export class MonthlyUsageEntity extends BaseEntity {
  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'char', length: 7 })
  period: string;

  @Column({ type: 'varchar', length: 128 })
  model: string;

  @Column({ name: 'call_count', type: 'bigint', default: 0 })
  callCount: string; // bigint deserializes to string in TypeORM

  @Column({ name: 'input_tokens', type: 'bigint', default: 0 })
  inputTokens: string;

  @Column({ name: 'output_tokens', type: 'bigint', default: 0 })
  outputTokens: string;

  @Column({ name: 'cache_read_input_tokens', type: 'bigint', default: 0 })
  cacheReadInputTokens: string;

  @Column({ name: 'cache_creation_5m_input_tokens', type: 'bigint', default: 0 })
  cacheCreation5mInputTokens: string;

  @Column({ name: 'cache_creation_1h_input_tokens', type: 'bigint', default: 0 })
  cacheCreation1hInputTokens: string;
}
```

**Step 2 — Register the entities.**

Edit `backend/src/database/entities/index.ts`:

1. Add the two imports at the top (alphabetical with the existing list).
2. Add `TokenUsageEntity` and `MonthlyUsageEntity` to the exported `entities` array (alphabetical).

There is NO change to `app.module.ts`. `app.module.ts` imports `DatabaseModule`, which consumes the `entities` array via `backend/src/config/database.config.ts`. Updating the array in `index.ts` is sufficient.

**Step 3 — Verify dev sync.**

Run: `npm run db && npm run be` (in two terminals).
Expected: backend starts, `synchronize: true` creates both tables, no SQL errors. Verify via `psql -h localhost -p 5433 -U postgres -d daubert -c '\d token_usage'` and `\d monthly_usage` — all columns and indexes from the entity decorators are present.

**Step 4 — Commit.**

```bash
git add backend/src/database/entities/token-usage.entity.ts backend/src/database/entities/monthly-usage.entity.ts backend/src/database/entities/index.ts
git commit -m "feat(metering): add token_usage and monthly_usage entities"
```

---

### Task 2: Pricing constants + `calculateCost()`

**Files:**
- Create: `backend/src/modules/superadmin/token-usage/pricing.ts`
- Create: `backend/src/modules/superadmin/token-usage/pricing.spec.ts`

**Step 1 — Write the failing test.**

```ts
// pricing.spec.ts
import { calculateCost, PRICING } from './pricing';

describe('calculateCost', () => {
  it('prices a pure-input Opus 4.6 call', () => {
    const cost = calculateCost('claude-opus-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
    });
    expect(cost).toBeCloseTo(5, 10);
  });

  it('prices a mixed Opus 4.6 turn with cache reads', () => {
    // 100k uncached input + 1M cached read + 50k output
    const cost = calculateCost('claude-opus-4-6', {
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheReadInputTokens: 1_000_000,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
    });
    // (100k * $5 + 50k * $25 + 1M * $0.50) / 1M
    //   = 0.50 + 1.25 + 0.50 = 2.25
    expect(cost).toBeCloseTo(2.25, 10);
  });

  it('prices a Haiku title-generation call', () => {
    const cost = calculateCost('claude-haiku-4-5', {
      inputTokens: 200,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
    });
    // (200 * $1 + 20 * $5) / 1M
    expect(cost).toBeCloseTo(0.0003, 10);
  });

  it('returns null for unknown models — never throws', () => {
    const cost = calculateCost('claude-future-model-9000', {
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
    });
    expect(cost).toBeNull();
  });

  it('matches official prices for every model in PRICING', () => {
    // Sanity check — if anyone hand-edits PRICING and breaks a value,
    // this catches it. Numbers from
    // https://platform.claude.com/docs/en/about-claude/pricing
    expect(PRICING['claude-opus-4-6'].input).toBe(5);
    expect(PRICING['claude-opus-4-6'].output).toBe(25);
    expect(PRICING['claude-opus-4-6'].cacheRead).toBe(0.50);
    expect(PRICING['claude-haiku-4-5'].input).toBe(1);
    expect(PRICING['claude-haiku-4-5'].output).toBe(5);
  });
});
```

**Step 2 — Run test to verify failure.**

Run: `npm test --prefix backend -- pricing.spec`
Expected: FAIL (module not found).

**Step 3 — Implement.**

See full implementation in **Design notes → Pricing source of truth** above. Save to `backend/src/modules/superadmin/token-usage/pricing.ts`.

**Step 4 — Run test to verify pass.**

Run: `npm test --prefix backend -- pricing.spec`
Expected: PASS, 5 assertions.

**Step 5 — Commit.**

```bash
git add backend/src/modules/superadmin/token-usage/pricing.ts backend/src/modules/superadmin/token-usage/pricing.spec.ts
git commit -m "feat(metering): pricing constants and cost calculator"
```

---

### Task 3: `TokenUsageService` write path

**Files:**
- Create: `backend/src/modules/superadmin/token-usage/token-usage.service.ts`
- Create: `backend/src/modules/superadmin/token-usage/token-usage.service.spec.ts`
- Create: `backend/src/modules/superadmin/token-usage/token-usage.module.ts`
- Modify: `backend/src/modules/superadmin/superadmin.module.ts`

**Step 1 — Write the failing test for `record()`.**

The upsert assertions require a real SQL execution path — `ai.service.spec.ts` is pure-mocks and is NOT a suitable harness for this. Instead set up a Jest module with a real in-memory database:

```ts
const moduleRef = await Test.createTestingModule({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',  // already a transitive dep via TypeORM; if not, use 'sqljs' or 'sqlite'
      database: ':memory:',
      entities: [TokenUsageEntity, MonthlyUsageEntity, OrganizationEntity, UserEntity, /* ... transitive entities needed by the unique constraint */],
      synchronize: true,
    }),
    TypeOrmModule.forFeature([TokenUsageEntity, MonthlyUsageEntity]),
  ],
  providers: [TokenUsageService],
}).compile();
```

Caveat: the production upsert uses Postgres-specific `INSERT ... ON CONFLICT ... DO UPDATE` syntax. SQLite supports the same syntax (since 3.24), so the test exercises real upsert behavior. If you find a syntax mismatch during implementation, fall back to a real disposable Postgres instance via testcontainers — but try SQLite first.

Key test cases:
1. `record()` inserts a `token_usage` row with the exact fields provided.
2. `record()` upserts the corresponding `monthly_usage` row, incrementing `call_count` by 1 and summing token columns.
3. Second `record()` call with the same `(orgId, userId, period, model)` increments the existing rollup row — no second monthly_usage row created.
4. `record()` with `surface: 'title-generation'` accepts `messageId: null` and `caseId: null` without error.
5. `record()` swallows DB errors and logs (test by mocking the repo `save` to throw — assert no exception escapes).

**Step 2 — Run, verify failures.**

Run: `npm test --prefix backend -- token-usage.service.spec`
Expected: FAIL (service not implemented).

**Step 3 — Implement `TokenUsageService.record()`.**

```ts
// token-usage.service.ts (write path skeleton; aggregates added in Task 7)
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TokenUsageEntity, TokenUsageSurface } from '../../../database/entities/token-usage.entity';
import { MonthlyUsageEntity } from '../../../database/entities/monthly-usage.entity';

export interface RecordParams {
  orgId: string | null;
  userId: string | null;
  caseId: string | null;
  conversationId: string | null;
  messageId: string | null;
  surface: TokenUsageSurface;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreation5mInputTokens: number;
  cacheCreation1hInputTokens: number;
}

@Injectable()
export class TokenUsageService {
  private readonly logger = new Logger(TokenUsageService.name);

  constructor(
    @InjectRepository(TokenUsageEntity)
    private readonly tokenUsageRepo: Repository<TokenUsageEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async record(params: RecordParams): Promise<void> {
    try {
      await this.tokenUsageRepo.save(this.tokenUsageRepo.create(params));
      // Rollup only when we have both org and user (chat path always does;
      // title-generation does too — generateTitle has the userId already and
      // we look up the conversation's orgId before recording).
      if (params.orgId && params.userId) {
        await this.upsertMonthly(params);
      }
    } catch (err) {
      // Metering failure must never break the user's request.
      this.logger.error(
        `Failed to record token usage [conversationId=${params.conversationId} model=${params.model}]: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async upsertMonthly(p: RecordParams): Promise<void> {
    const period = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    await this.dataSource.query(
      `INSERT INTO monthly_usage
         (id, created_at, updated_at, org_id, user_id, period, model,
          call_count, input_tokens, output_tokens, cache_read_input_tokens,
          cache_creation_5m_input_tokens, cache_creation_1h_input_tokens)
       VALUES (gen_random_uuid(), NOW(), NOW(), $1, $2, $3, $4,
               1, $5, $6, $7, $8, $9)
       ON CONFLICT (org_id, user_id, period, model)
       DO UPDATE SET
         call_count                       = monthly_usage.call_count + 1,
         input_tokens                     = monthly_usage.input_tokens + EXCLUDED.input_tokens,
         output_tokens                    = monthly_usage.output_tokens + EXCLUDED.output_tokens,
         cache_read_input_tokens          = monthly_usage.cache_read_input_tokens + EXCLUDED.cache_read_input_tokens,
         cache_creation_5m_input_tokens   = monthly_usage.cache_creation_5m_input_tokens + EXCLUDED.cache_creation_5m_input_tokens,
         cache_creation_1h_input_tokens   = monthly_usage.cache_creation_1h_input_tokens + EXCLUDED.cache_creation_1h_input_tokens,
         updated_at                       = NOW()`,
      [p.orgId, p.userId, period, p.model, p.inputTokens, p.outputTokens, p.cacheReadInputTokens, p.cacheCreation5mInputTokens, p.cacheCreation1hInputTokens],
    );
  }
}
```

**Step 4 — Create the module.**

```ts
// token-usage.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenUsageEntity } from '../../../database/entities/token-usage.entity';
import { MonthlyUsageEntity } from '../../../database/entities/monthly-usage.entity';
import { TokenUsageService } from './token-usage.service';

@Module({
  imports: [TypeOrmModule.forFeature([TokenUsageEntity, MonthlyUsageEntity])],
  providers: [TokenUsageService],
  exports: [TokenUsageService],
})
export class TokenUsageModule {}
```

Add `TokenUsageModule` to `imports` in `superadmin.module.ts`.

**Step 5 — Run tests, verify pass.**

Run: `npm test --prefix backend -- token-usage.service.spec`
Expected: PASS, all assertions.

**Step 6 — Commit.**

```bash
git add backend/src/modules/superadmin/token-usage/
git add backend/src/modules/superadmin/superadmin.module.ts
git commit -m "feat(metering): TokenUsageService write path with monthly upsert"
```

---

### Task 4: Surface usage from `AnthropicProvider`

**Files:**
- Modify: `backend/src/modules/ai/providers/llm-provider.interface.ts`
- Modify: `backend/src/modules/ai/providers/anthropic.provider.ts`

**Step 1 — Change `generateText` return shape on the interface.**

```ts
// llm-provider.interface.ts
export interface GeneratedText {
  text: string | null;
  usage: Anthropic.Usage;
  model: string;
}

export interface LlmProvider {
  // ... (streamChat unchanged — usage is already on event.response.usage)
  generateText(params: {
    model?: string;
    maxTokens: number;
    messages: Anthropic.MessageParam[];
  }): Promise<GeneratedText>;
}
```

**Step 2 — Update `AnthropicProvider.generateText()`.**

```ts
async generateText(params: {
  model?: string;
  maxTokens: number;
  messages: Anthropic.MessageParam[];
}): Promise<GeneratedText> {
  const model = params.model ?? 'claude-haiku-4-5';
  const response = await this.client.messages.create({
    model,
    max_tokens: params.maxTokens,
    messages: params.messages,
  });
  const block = response.content[0];
  const text = block?.type === 'text' ? block.text.trim() : null;
  return { text, usage: response.usage, model };
}
```

**Step 3 — Verify the type checker is happy.**

Run: `npx tsc --noEmit --project backend/tsconfig.json` (or whatever the project uses).
Expected: 1 error in `ai.service.ts` where `generateTitle` consumes the old shape — that's fixed in the next task. No other errors.

**Step 4 — Commit.**

```bash
git add backend/src/modules/ai/providers/llm-provider.interface.ts backend/src/modules/ai/providers/anthropic.provider.ts
git commit -m "feat(metering): surface usage from AnthropicProvider"
```

(`streamChat` requires no change — `event.response.usage` already carries everything we need on the `end_turn` event.)

---

### Task 5: Wire `AiService` to call `TokenUsageService.record()`

**Files:**
- Modify: `backend/src/modules/ai/ai.service.ts`
- Modify: `backend/src/modules/ai/ai.module.ts`
- Modify: `backend/src/modules/ai/ai.service.spec.ts`

**Step 1 — Add `TokenUsageModule` to `AiModule.imports`.**

(Import the module from the superadmin barrel.)

**Step 2 — Inject `TokenUsageService` + `ConversationEntity` repo into `AiService` constructor.**

Resolve the conversation's `caseId` and `orgId` once at the top of `streamChat` (load relation `case`). Cache them in locals; reuse for every `record()` call.

**Step 3 — Add a private `recordUsage()` helper and call it at every successful-response exit point in the loop.**

The streamChat loop in `ai.service.ts` has **three** exit points after a successful Anthropic response, and the assistant `messageId` (when one exists) comes from the entity returned by `messageRepo.save(...)`. A single "after `if (!response) break;`" placement is wrong: at that point no message has been saved yet, so `savedMessage.id` doesn't exist.

First, change the two existing `messageRepo.save(...)` calls so they capture the returned entity:

```ts
// Was: await this.messageRepo.save(this.messageRepo.create({ ... }));
// Becomes:
const savedAssistant = await this.messageRepo.save(this.messageRepo.create({ ... }));
```

Then add this private helper on `AiService`:

```ts
private async recordUsage(
  response: Anthropic.Beta.BetaMessage,
  context: { orgId: string | null; userId: string; caseId: string | null; conversationId: string; messageId: string | null },
): Promise<void> {
  const u = response.usage as Anthropic.Beta.BetaUsage;
  // BetaCacheCreation: { ephemeral_5m_input_tokens; ephemeral_1h_input_tokens } | null
  // The flat `cache_creation_input_tokens` is the legacy aggregate. Prefer the split when present.
  const cache = u.cache_creation ?? null;
  await this.tokenUsageService.record({
    ...context,
    surface: 'chat',
    model: response.model,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreation5mInputTokens: cache?.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0,
    cacheCreation1hInputTokens: cache?.ephemeral_1h_input_tokens ?? 0,
  });
}
```

(Note: `recordUsage` does NOT need its own try/catch — `TokenUsageService.record()` already swallows errors. Calling `await this.recordUsage(...)` is safe.)

Then place a call at **each** of the three response-exit points:

1. **End-turn branch** (around line 449, immediately after the new `savedAssistant = ...`):
   ```ts
   await this.recordUsage(response, { orgId, userId, caseId, conversationId, messageId: savedAssistant.id });
   ```

2. **Repeat-tool guard exit** (around line 487, before `yield { type: 'done' }`): the API call DID happen and tokens WERE billed; we just didn't save a message because the tools repeated. Record with `messageId: null`:
   ```ts
   await this.recordUsage(response, { orgId, userId, caseId, conversationId, messageId: null });
   ```

3. **Tool-use branch** (around line 538, immediately after the new `savedAssistant = ...` for the assistant message — NOT the slim `tool_result` save):
   ```ts
   await this.recordUsage(response, { orgId, userId, caseId, conversationId, messageId: savedAssistant.id });
   ```

Do NOT place `recordUsage` in the `finally` block — the finally block only persists a synthetic terminator when the loop wedged, no API call happens there.

Do NOT place it once at the top of the loop after `if (!response) break;` — the messageId would be unavailable.

This produces exactly one `token_usage` row per successful Anthropic API call.

**Step 4 — `generateTitle`: update for new `generateText` return type and record usage.**

```ts
const { text: title, usage, model } = await this.llm.generateText({...});
// ... existing title handling ...

// Resolve orgId via the conversation; userId is already a param.
const conversation = await this.conversationRepo.findOne({ where: { id: conversationId }, relations: ['case'] });
await this.tokenUsageService.record({
  orgId: conversation?.case?.orgId ?? null,
  userId,
  caseId: conversation?.caseId ?? null,
  conversationId,
  messageId: null,
  surface: 'title-generation',
  model,
  inputTokens: usage.input_tokens ?? 0,
  outputTokens: usage.output_tokens ?? 0,
  cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  cacheCreation5mInputTokens: 0,
  cacheCreation1hInputTokens: 0,
});
```

**Step 5 — Extend `ai.service.spec.ts`.**

Add two test cases:
1. A streamed chat call records `token_usage` with the assistant `messageId` and the resolved `orgId`/`caseId`/`userId`.
2. `generateTitle` records `token_usage` with `surface: 'title-generation'` and `messageId: null`.

Mock `tokenUsageService.record` and assert the call args. Don't actually write to the DB inside this spec — the write path has its own test in Task 3.

**Step 6 — Run tests + verify the dev server.**

Run: `npm test --prefix backend -- ai.service.spec`
Expected: PASS including new assertions.

Then bring up `npm run db && npm run be && npm run fe`, send a chat message, query the DB:

```sql
SELECT model, surface, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_5m_input_tokens, created_at
FROM token_usage ORDER BY created_at DESC LIMIT 5;

SELECT org_id, user_id, period, model, call_count, input_tokens, output_tokens
FROM monthly_usage ORDER BY updated_at DESC LIMIT 5;
```

Expected: rows present, monthly rollup increments on subsequent messages.

**Step 7 — Commit.**

```bash
git add backend/src/modules/ai/ai.service.ts backend/src/modules/ai/ai.service.spec.ts backend/src/modules/ai/ai.module.ts
git commit -m "feat(metering): record token usage on chat and title generation"
```

---

### Task 6: Aggregate query methods on `TokenUsageService`

**Files:**
- Modify: `backend/src/modules/superadmin/token-usage/token-usage.service.ts`
- Modify: `backend/src/modules/superadmin/token-usage/token-usage.service.spec.ts`

Add the following methods. Each returns DTOs shaped exactly like the OpenAPI response schemas (Task 7).

```ts
async overview(days: number): Promise<TokenUsageOverview>;
async byOrg(days: number, limit: number): Promise<TokenUsageByOrgRow[]>;
async byUser(days: number, limit: number): Promise<TokenUsageByUserRow[]>;
async byCase(days: number, limit: number): Promise<TokenUsageByCaseRow[]>;
async byConversation(days: number, limit: number): Promise<TokenUsageByConversationRow[]>;
async orgModelMatrix(days: number): Promise<TokenUsageOrgModelMatrixRow[]>;
async cacheEffectiveness(days: number): Promise<TokenUsageCacheEffectiveness>;
```

**Step 1 — Tests first.** Seed `token_usage` with known rows (3 orgs, 2 models, varied cache mixes), assert each method returns the expected aggregates with `cost` applied. Cover "row with unknown model returns cost: null" for `byConversation`.

**Step 2 — Implement.** Use TypeORM's `QueryBuilder` for joins (`token_usage` → `organizations` for name, → `users` for email, → `cases` for name, → `conversations` for title). Cost is computed in JS after the SQL aggregation:

```ts
const rawRows = await qb.getRawMany();
return rawRows.map((r) => ({
  ...r,
  cost: calculateCost(r.model, {
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    cacheReadInputTokens: Number(r.cache_read_input_tokens),
    cacheCreation5mInputTokens: Number(r.cache_creation_5m_input_tokens),
    cacheCreation1hInputTokens: Number(r.cache_creation_1h_input_tokens),
  }),
}));
```

For methods that aggregate across models inside a single row (e.g., `byOrg` which is one row per org regardless of model), sum cost per row from the per-model breakdown:

```sql
SELECT org_id, model,
       SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, ...
FROM token_usage WHERE org_id IS NOT NULL AND created_at >= NOW() - INTERVAL '$1 days'
GROUP BY org_id, model
```

Then group by `org_id` in JS, applying `calculateCost` per `(org_id, model)` and summing.

**Step 3 — Run tests + commit.**

```bash
git add backend/src/modules/superadmin/token-usage/token-usage.service.ts backend/src/modules/superadmin/token-usage/token-usage.service.spec.ts
git commit -m "feat(metering): aggregate query methods on TokenUsageService"
```

---

### Task 7: OpenAPI contracts

**Files:**
- Modify: `contracts/schemas/superadmin.yaml`
- Modify: `contracts/paths/superadmin.yaml`
- Modify: `contracts/openapi.yaml` — REQUIRED. Every path needs an explicit `$ref` under `paths:` and every schema needs an entry under `components.schemas` (refs are NOT auto-included). Mirror the existing superadmin path entries.

**Step 1 — Add the schemas.**

```yaml
TokenUsageOverview:
  type: object
  required: [days, totalCost, totalTokens, totalCalls, cacheHitRate]
  properties:
    days: { type: integer }
    totalCost: { type: number, format: float, nullable: true }
    totalTokens: { type: integer, format: int64 }
    totalCalls: { type: integer, format: int64 }
    cacheHitRate: { type: number, format: float, description: "0.0–1.0" }

TokenUsageByOrgRow:
  type: object
  required: [orgId, orgName, calls, totalTokens]
  properties:
    orgId: { type: string, format: uuid }
    orgName: { type: string }
    calls: { type: integer, format: int64 }
    totalTokens: { type: integer, format: int64 }
    cost: { type: number, format: float, nullable: true }

TokenUsageByUserRow:
  type: object
  required: [userId, email, calls, totalTokens]
  properties:
    userId: { type: string, format: uuid }
    email: { type: string }
    orgName: { type: string, nullable: true }
    calls: { type: integer, format: int64 }
    totalTokens: { type: integer, format: int64 }
    cost: { type: number, format: float, nullable: true }

TokenUsageByCaseRow:
  type: object
  required: [caseId, caseName, calls, totalTokens]
  properties:
    caseId: { type: string, format: uuid }
    caseName: { type: string }
    orgName: { type: string, nullable: true }
    calls: { type: integer, format: int64 }
    totalTokens: { type: integer, format: int64 }
    cost: { type: number, format: float, nullable: true }

TokenUsageByConversationRow:
  type: object
  required: [conversationId, calls, totalTokens]
  properties:
    conversationId: { type: string, format: uuid }
    title: { type: string, nullable: true }
    caseName: { type: string, nullable: true }
    userEmail: { type: string, nullable: true }
    calls: { type: integer, format: int64 }
    totalTokens: { type: integer, format: int64 }
    cost: { type: number, format: float, nullable: true }

TokenUsageOrgModelMatrixRow:
  type: object
  required: [orgId, orgName, model, calls, totalTokens]
  properties:
    orgId: { type: string, format: uuid }
    orgName: { type: string }
    model: { type: string }
    calls: { type: integer, format: int64 }
    totalTokens: { type: integer, format: int64 }
    cost: { type: number, format: float, nullable: true }

TokenUsageCacheEffectiveness:
  type: object
  required: [days, cacheHitRate, breakdown]
  properties:
    days: { type: integer }
    cacheHitRate: { type: number, format: float }
    breakdown:
      type: object
      required: [cacheReadTokens, cacheCreation5mTokens, cacheCreation1hTokens, uncachedInputTokens, outputTokens]
      properties:
        cacheReadTokens: { type: integer, format: int64 }
        cacheCreation5mTokens: { type: integer, format: int64 }
        cacheCreation1hTokens: { type: integer, format: int64 }
        uncachedInputTokens: { type: integer, format: int64 }
        outputTokens: { type: integer, format: int64 }
```

**Step 2 — Add the paths.** Each is `GET /superadmin/token-usage/<name>` with a `days` query param (`integer`, default 30, enum `[7, 30, 90]`) and where applicable a `limit` param (default 10 for tables). Reference an existing superadmin path as a template for the auth response codes (200, 403).

**Step 3 — Wire the new paths and schemas into `openapi.yaml`.**

Add 6 path `$ref` entries under `paths:` and 7 schema entries under `components.schemas`. Use existing superadmin paths as a template (find them by grepping for `superadmin/orgs:` in `openapi.yaml`). These additions are required — `openapi.yaml` does not auto-include refs from sub-files.

**Step 4 — Regenerate types.**

Run: `npm run gen`
Expected: `backend/src/generated/api-types.ts` and `frontend/src/generated/api-types.ts` both update with new schema names.

**Step 5 — Commit.**

```bash
git add contracts/ backend/src/generated/api-types.ts frontend/src/generated/api-types.ts
git commit -m "feat(metering): openapi contracts for superadmin token-usage"
```

---

### Task 8: Superadmin controller

**Files:**
- Create: `backend/src/modules/superadmin/token-usage/token-usage.controller.ts`
- Create: `backend/src/modules/superadmin/token-usage/token-usage.controller.spec.ts`
- Modify: `backend/src/modules/superadmin/token-usage/token-usage.module.ts` (register controller)

**Step 1 — Controller skeleton.**

```ts
@Controller('superadmin/token-usage')
@RequireSuperAdmin()
export class SuperadminTokenUsageController {
  constructor(private readonly service: TokenUsageService) {}

  @Get('overview')
  overview(@Query('days', new ParseIntPipe({ optional: true })) days = 30) {
    return this.service.overview(this.clampWindow(days));
  }

  @Get('by-org')
  byOrg(@Query('days', new ParseIntPipe({ optional: true })) days = 30, @Query('limit', new ParseIntPipe({ optional: true })) limit = 10) {
    return this.service.byOrg(this.clampWindow(days), Math.min(limit, 100));
  }

  // ... by-user, by-case, by-conversation, org-model-matrix, cache-effectiveness

  private clampWindow(days: number): number {
    return [7, 30, 90].includes(days) ? days : 30;
  }
}
```

**Step 2 — Tests.** Mock `TokenUsageService`, assert each endpoint passes through `days` (and `limit` where applicable) and returns the service's result.

**Step 3 — Verify with `curl`.** `curl -H "Authorization: Bearer <token>" http://localhost:8081/superadmin/token-usage/overview?days=30` → JSON. As non-superadmin → 403.

**Step 4 — Commit.**

```bash
git add backend/src/modules/superadmin/token-usage/token-usage.controller.ts backend/src/modules/superadmin/token-usage/token-usage.controller.spec.ts backend/src/modules/superadmin/token-usage/token-usage.module.ts
git commit -m "feat(metering): superadmin token-usage controller"
```

---

### Task 9: Frontend api-client methods + nav

**Files:**
- Modify: `frontend/src/lib/api-client.ts`
- Modify: `frontend/src/app/superadmin/layout.tsx`

**Step 1 — Add typed methods.**

```ts
superadminTokenUsageOverview: (days: 7 | 30 | 90 = 30) =>
  request<components['schemas']['TokenUsageOverview']>(`/superadmin/token-usage/overview?days=${days}`),
superadminTokenUsageByOrg: (days: 7 | 30 | 90 = 30, limit = 10) =>
  request<components['schemas']['TokenUsageByOrgRow'][]>(`/superadmin/token-usage/by-org?days=${days}&limit=${limit}`),
// ... by-user, by-case, by-conversation, org-model-matrix, cache-effectiveness
```

**Step 2 — Add nav item.** In `layout.tsx`, add `{ href: '/superadmin/token-usage', label: 'Token Usage', icon: FaChartLine, exact: false }` to the `NAV` array.

**Step 3 — Commit.**

```bash
git add frontend/src/lib/api-client.ts frontend/src/app/superadmin/layout.tsx
git commit -m "feat(metering): superadmin nav + api-client methods"
```

---

### Task 10: Frontend dashboard page

**Files:**
- Create: `frontend/src/app/superadmin/token-usage/page.tsx`

Replicate the structure of `mission-control/src/app/admin/stackpad/token-usage/page.tsx` adapted to Daubert's data shape. Specifically:

- Window selector (`<select>`) above the hero row.
- Hero KPI grid (4 cards): total cost, total tokens, total calls, cache hit rate. Format cost as `$X,XXX.XX` (or `—` if null).
- Cache effectiveness horizontal stacked bar — CSS only, no chart library.
- Top orgs table (10 rows, link to `/superadmin/orgs/<id>`).
- Top users table (10 rows).
- Top cases table (10 rows).
- Org × model matrix (one row per org, columns = models in PRICING + 'unknown', cells = cost).
- Top conversations table (20 rows).

Match the styling tokens used by the other superadmin pages (`bg-surface`, `border-line-strong`, etc. — see `superadmin/orgs/page.tsx`).

Data fetching follows the established pattern (`useEffect` + `useCallback` + manual state hooks, not React Query). Each section loads independently on `days` change.

Commit:

```bash
git add frontend/src/app/superadmin/token-usage/
git commit -m "feat(metering): superadmin token-usage dashboard page"
```

---

### Task 11: Generate prod migration

**Step 1 — Verify dev schema matches entities.** `npm run be` should already have synced via `synchronize: true`. Sanity check in psql:

```sql
\d token_usage
\d monthly_usage
```

Expected: schemas match the entity files.

**Step 2 — Generate the migration.**

Run from project root:
```bash
./migrations.sh --prod --generate AddTokenUsageMetering
```

Expected: new file under `backend/src/database/migrations/<timestamp>-AddTokenUsageMetering.ts` containing the `CREATE TABLE token_usage`, `CREATE TABLE monthly_usage`, indexes, FKs, and unique constraint.

**Step 3 — Review the generated SQL.** Open the migration file. Confirm:
- All indexes from the entity decorators are present.
- The `monthly_usage` unique constraint `(org_id, user_id, period, model)` is present (required for the `ON CONFLICT` clause).
- All FK `ON DELETE` modes match the entity (SET NULL on `token_usage`, CASCADE on `monthly_usage`).

If anything is missing, edit the migration file directly to add it.

**Step 4 — DO NOT run the migration.** Per `CLAUDE.md`: the user runs `./migrations.sh --prod --run` themselves. Leave the file staged for review.

**Step 5 — Commit.**

```bash
git add backend/src/database/migrations/*-AddTokenUsageMetering.ts
git commit -m "feat(metering): migration for token-usage tables"
```

---

## Final review

After all tasks land:

1. Whole-feature `opus` code review across `git diff main...HEAD`.
2. Manual smoke test in the running app:
   - Send 3 chat messages in a case as superadmin.
   - Open `/superadmin/token-usage`.
   - Hero KPIs show non-zero values.
   - All tables populated.
   - Cache effectiveness bar renders.
   - Switch days to 7 → values shrink (or stay same if all in 7d).
   - Switch days to 90 → values expand.
3. Run full test suite: `npm test --prefix backend`.
4. Hand the prod migration file to the user for review and application via `./migrations.sh --prod --run`.

---

## Product questions to flag to user

(None blocking for this plan — all decisions covered by Engineering Decisions Made or earlier conversation. If any of these surface during implementation, stop and ask.)

- Backfill historical token usage from pre-deployment message counts? (Default: NO. Charts read 0 for pre-launch period — honest.)
- Sort default for top-N tables: by cost, by tokens, or by calls? (Default: by cost descending, matching mission-control.)
- Currency formatting locale (USD vs explicit user-locale formatting)? (Default: hard `$X,XXX.XX` USD format, matching mission-control.)
