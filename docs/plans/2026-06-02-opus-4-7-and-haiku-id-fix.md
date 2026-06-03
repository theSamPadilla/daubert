# Opus 4.7 Support + Haiku ID Mismatch Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Claude Opus 4.7 to the model dropdown end-to-end, and fix a pre-existing bug where Haiku chats record `null` cost in token usage reporting because the dropdown sends a dated model ID that the pricing table doesn't recognize.

**Architecture:** This is a small, surgical change across two packages. Pricing for `claude-opus-4-7` is already in the backend `PRICING` table (preemptively added in a prior change); the work is purely (a) exposing it in the frontend dropdown and (b) normalizing the Haiku ID so the frontend, backend default, and pricing table all agree on `claude-haiku-4-5` (the un-dated alias the Anthropic SDK accepts and that the rest of the codebase already uses for Opus 4.6 and Sonnet 4.6).

**Tech Stack:** TypeScript, Next.js 14 (frontend), NestJS + Jest (backend). No DB migration (model is stored as `varchar(128)`; new model IDs need no schema change).

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/superadmin/token-usage/pricing.spec.ts` | Modify | Add a guardrail test that confirms every supported model ID has a `PRICING` entry — catches future drift between the dropdown and the pricing table. |
| 2 | `frontend/src/components/Workspace/AIChat.tsx` | Modify | Add Opus 4.7 to the dropdown; fix Haiku ID from `claude-haiku-4-5-20251001` to `claude-haiku-4-5` so token costs are recorded (currently `null` for all Haiku chats). |

**What this unlocks:**
- **Users** can pick Opus 4.7 in the chat model dropdown.
- **Token usage dashboards** (superadmin) start showing real $ costs for Haiku chats *going forward* instead of "—". Historical Haiku rows stay null (see Risks).
- **Future model adds** are protected by a unit test that fails loudly if a supported model is missing from `PRICING`.

**Scope clarification — what "end-to-end" means here:** the user-initiated chat path (dropdown → request → cost recording). The backend's `DEFAULT_MODEL` at `backend/src/modules/ai/providers/anthropic.provider.ts:6` (used when a caller doesn't specify a model) is a separate product decision and stays on Opus 4.6 in this plan.

**Explicitly out of scope** (flagged for follow-up, not this plan):
- Bumping `DEFAULT_MODEL` in `backend/src/modules/ai/providers/anthropic.provider.ts:6` from `claude-opus-4-6` to `claude-opus-4-7` — product decision, user didn't ask.
- Bumping the default `selectedModel` in `AIChat.tsx:329` from `claude-opus-4-6` to `claude-opus-4-7` — same.
- Documenting the `model` field in `contracts/schemas/ai.yaml` — pre-existing gap, unrelated to this fix.
- Backfilling historical Haiku rows in `token_usage` / `monthly_usage` to recompute their now-fixable costs — separate decision (and a separate migration if we ever want it).
- Adding a true cross-package single-source-of-truth for supported models (would require either a contracts addition or a shared package). The guardrail test in Task 1 is the lightweight alternative.

---

## Pre-flight context (read before starting)

- **Why the Haiku bug exists:** the frontend dropdown was added with a dated model ID (`claude-haiku-4-5-20251001`), but the backend `PRICING` table keys on the un-dated alias (`claude-haiku-4-5`). When `tokenUsageService.record()` looks up `PRICING['claude-haiku-4-5-20251001']`, it gets `undefined` and `calculateCost()` returns `null`. The Haiku call still succeeds end-to-end — only the cost field is wrong.
- **Why the un-dated alias is safe:** the Anthropic SDK's TypeScript types accept it, and the codebase consistently uses un-dated aliases — `PRICING` keys, the backend default at `anthropic.provider.ts:6`, and the title-generation fallback literal at `anthropic.provider.ts:92`. The dated form (`claude-haiku-4-5-20251001`) appears in exactly one place: the frontend dropdown. The smoke test in Task 2 Step 3 is what actually proves end-to-end that the alias resolves correctly under load.
- **The pricing table source of truth:** `backend/src/modules/superadmin/token-usage/pricing.ts`. `claude-opus-4-7` is already there at line 12.

---

## Task 1: Backend regression guard for model/pricing drift

**Files:**
- Modify: `backend/src/modules/superadmin/token-usage/pricing.spec.ts`

**Not a TDD task.** Pricing for `claude-opus-4-7` already exists in `PRICING`; there is no production code change in this task. This is a regression guard that pins down the set of supported model IDs so future "add a model to the dropdown" PRs can't accidentally ship without a matching pricing entry — the class of bug that produced the Haiku `cost_usd = NULL` regression.

The `SUPPORTED_MODELS` array in the test is intentionally hand-maintained. A shared cross-package registry would be cleaner but isn't worth the architectural cost for a 4-entry list — the inline comment is the contract.

**Step 1: Add the guardrail test**

Add this `it` block inside the existing `describe('calculateCost', ...)` in `backend/src/modules/superadmin/token-usage/pricing.spec.ts`, after the last test (after line 61):

```typescript
  // Source of truth for "model IDs the frontend can send us". Keep this in
  // lockstep with the MODELS array in frontend/src/components/Workspace/AIChat.tsx.
  // If you add a model to the dropdown, add it here too — this test catches
  // the silent-null-cost bug that the haiku-4-5-20251001 mismatch caused.
  const SUPPORTED_MODELS = [
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ];

  it.each(SUPPORTED_MODELS)('has pricing for %s', (model) => {
    expect(PRICING[model]).toBeDefined();
    const cost = calculateCost(model, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
    });
    expect(cost).not.toBeNull();
    expect(cost).toBeGreaterThan(0);
  });
```

**Step 2: Run the test suite and verify it passes**

Run from repo root:

```bash
npm --prefix backend test -- --testPathPattern=pricing.spec
```

Expected: all 4 parameterized cases pass (`has pricing for claude-opus-4-7`, `…claude-opus-4-6`, `…claude-sonnet-4-6`, `…claude-haiku-4-5`). The existing 5 tests in the file still pass — total 9 passing.

If any of the 4 parameterized cases fails, stop — it means `PRICING` is missing an entry the plan assumed was there.

**Step 3: Stop. Do not commit.**

Per project CLAUDE.md, leave the change in the working tree. Run `git status` so the change is visible.

---

## Task 2: Frontend dropdown — add Opus 4.7, fix Haiku ID

**Files:**
- Modify: `frontend/src/components/Workspace/AIChat.tsx:21-25`

**Step 1: Update the `MODELS` array**

Replace the existing `MODELS` const at `frontend/src/components/Workspace/AIChat.tsx:21-25`:

```typescript
const MODELS = [
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
] as const;
```

Two changes in one edit:
1. New first entry: `claude-opus-4-7` / `Opus 4.7`.
2. Haiku ID changed from `claude-haiku-4-5-20251001` to `claude-haiku-4-5` (the un-dated alias that matches `PRICING` and the backend default).

**Do not change** the `useState` default at line 329 (`useState<ModelId>('claude-opus-4-6')`) — keeping the current default is in-scope; bumping it is a product decision out of scope per the header.

**Step 2: Verify the frontend typechecks**

Run from repo root:

```bash
npm --prefix frontend run build
```

Expected: build completes without TypeScript errors. The `ModelId` type derives from the `MODELS` array, so adding/changing IDs flows through automatically; the only way this fails is if some other file imports a specific old ID literal — search confirms none do, but the build is the actual proof.

**Step 3a: Start the stack**

Separate terminals (skip any service already running):

```bash
npm run db   # postgres container `daubert-db` on 5433
npm run be   # nest on 8081
npm run fe   # next on 3001
```

Wait until Next.js prints "Ready" on `http://localhost:3001` before continuing.

**Step 3b: Smoke each model through the chat UI**

Open `http://localhost:3001`, open the AI chat. For each of the four model IDs (`claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`) — one at a time:

1. Select the model from the dropdown.
2. Send a short message ("hello").
3. Wait for the assistant to finish streaming.
4. Query the most recent `token_usage` row **for that specific model** (filtering matters — title generation runs Haiku in the background, so an unfiltered "latest row" can be misleading):

   ```bash
   docker exec -i daubert-db psql -U daubert -d daubert -c \
     "SELECT model, cost_usd, created_at FROM token_usage WHERE model = '<MODEL_ID>' ORDER BY created_at DESC LIMIT 1;"
   ```

   Substitute `<MODEL_ID>` with the dropdown value you just used. Record the `cost_usd` value.

**Step 3c: Verify all four costs are non-null**

You should now have 4 recorded `cost_usd` values, one per model. Every one must be a non-null positive number.

- Before this fix: the Haiku row would have been `NULL` (the bug we're fixing).
- After this fix: all four are populated. This is the actual proof the Haiku normalization worked end-to-end.

If any value is null, stop — the production code is still wrong and the guardrail test missed something. Do not proceed.

**Step 4: Stop. Do not commit.**

Run `git status` so the changes (Task 1 + Task 2) are visible to the user for review.

---

## Final verification checklist

Before declaring done:

- [ ] `npm --prefix backend test -- --testPathPattern=pricing.spec` → 9 tests pass
- [ ] `npm --prefix frontend run build` → no TS errors
- [ ] Manual smoke test: each of the 4 dropdown options produces a non-null `cost_usd` row in `token_usage`
- [ ] `git status` shows exactly two modified files: `pricing.spec.ts` and `AIChat.tsx`. No other files touched. No commit made.

## Risks and mitigations

- **Risk:** The un-dated `claude-haiku-4-5` alias gets deprecated by Anthropic before the dated form, and frontend chats start failing.
  - **Mitigation:** Evidence today says the alias works (title generation uses it in prod). If it ever stops working, the fix is the inverse — move pricing and defaults to dated IDs. Cheap to reverse.
- **Risk:** Someone adds a fifth model to the dropdown later and forgets `PRICING`.
  - **Mitigation:** The guardrail test in Task 1 is exactly the catch for this — they have to update both the dropdown and the `SUPPORTED_MODELS` list, and the test will scream if they update one without the other.
- **Risk:** Historical Haiku rows still have `cost_usd = NULL` in `token_usage` and `monthly_usage` even after the fix.
  - **Mitigation:** Accepted. Backfilling is out of scope and would require a one-shot SQL script. Surface this to the user if they care about historical accuracy.
