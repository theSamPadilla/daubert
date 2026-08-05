# BTC Hardening Pass Implementation Plan

**Goal:** Close the three data-integrity bugs deferred from the Bitcoin-support ship (2026-08-04): labeled-entity address-case corruption, raw-base-unit amounts leaking through the import contract (seed **and** search-between paths), and `createGroup`'s untrimmed address keys.

## Summary

- **What & why:** Three small, independent correctness fixes on evidence-bearing data. (1) Labeled entities force-lowercase every stored wallet address, corrupting case-sensitive Bitcoin base58 and Tron addresses on display; (2) the two internal import producers (`useCaseSeed.mapFetchedTx`, `traces.service.toImportItem`) send raw wei/sun with a string token into an import contract documented as human-readable — EVM/Tron amounts imported via case-seed or advanced search render as absurd numbers; (3) `createGroup`'s inline-node path still keys addresses with raw `.toLowerCase()` — the same class of case/trim collision bug already fixed in `importTransactions`.
- **Key product decisions:** none — no user-visible contract changes. Entity matching stays case-insensitive (as today); only storage/display becomes case-preserving.
- **Load-bearing engineering decisions:**
  - Amount units are fixed at the **producers**, not in `importTransactions` — the import contract's bare (non-utxo) amounts stay human-readable because external AI/MCP agents already send them that way. BTC utxo-carrying rows keep raw sats (established convention; the server writes the token object for those).
  - One exact BigInt converter in `shared/amounts.ts` (gen-copied to both packages) — no floats, no abbreviation.
  - Labeled-entity wallets: lowercase **only** `0x…` addresses at write time (the DTO has no per-wallet chain field — shape-based normalization); all lookups compare `LOWER() = LOWER()` so old lowercased rows and new case-preserved rows both match.
- **Known limitation (accepted):** labeled-entity rows saved before this fix keep their lowercased BTC/Tron wallets until a superadmin re-saves them; edges already imported with raw amounts are not migrated (delete + re-import recovers them). No DB migration needed anywhere (data-shape only, JSONB / jsonb array columns).
- **Opus-tagged tasks:** none — all tasks are narrow and mechanical; `sonnet` throughout.

---

> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task. **Never commit** — leave all changes in the working tree; run `git status` at the end of each task. Do not add Co-Authored-By trailers to anything.
>
> **Context:** the working tree already contains the full uncommitted Bitcoin-support feature (shipped 2026-08-04; architecture in `docs/blockchain.md`, per-chain ops in `docs/supported-chains.md`). Existing helpers to reuse: `addressKey(addr)` (trim+lowercase, `backend/src/modules/traces/traces.service.ts:37-39`), `normalizeAddressForChain` (`backend/src/generated/shared/address.ts` — trims always, lowercases EVM only), `edgeIdentityKey` (`generated/shared/edge-identity.ts`), `explorerAddressUrl` (`generated/shared/chains.ts`). `npm run gen` regenerates api-types AND re-copies `shared/` into both packages' `src/generated/shared/` — required after any `shared/` change; never edit generated copies. Tests: `npm run test --prefix backend|frontend`. 13 backend e2e failures (`byoa-isolation`, `script-role-enforcement`) are pre-existing environment limits — expected.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `shared/amounts.ts` | Create | Exact BigInt raw→decimal-string converter shared by both packages |
| 2 | `frontend/src/utils/amounts.test.ts` | Create | Converter unit tests (imports generated copy) |
| 3 | `backend/src/modules/traces/traces.service.ts` (`toImportItem`) | Modify | Converts EVM/Tron amounts to human-readable (Task 2) |
| 4 | `backend/src/modules/traces/traces.service.ts` (`createGroup` newNodes) | Modify | `addressKey` keying + chain-aware persisted addresses (Task 5) |
| 5 | `backend/src/modules/traces/traces.service.spec.ts` | Modify | Specs for both traces.service fixes |
| 6 | `frontend/src/hooks/useCaseSeed.ts` | Modify | `mapFetchedTx` converts EVM/Tron amounts to human-readable; `FetchedTx.token` type widened with `decimals?` |
| 7 | `frontend/src/hooks/useCaseSeed.test.ts` | Modify | Seed units specs |
| 8 | `backend/src/modules/labeled-entities/dto/create-labeled-entity.dto.ts` (+ new `dto/create-labeled-entity.dto.spec.ts`) | Modify/Create | Case-preserving wallet transform (lowercase 0x only) + transform spec |
| 9 | `backend/src/modules/labeled-entities/dto/update-labeled-entity.dto.ts` (+ new `dto/update-labeled-entity.dto.spec.ts`) | Modify/Create | Same transform + spec |
| 10 | `backend/src/modules/labeled-entities/labeled-entities.service.ts` | Modify | Case-insensitive lookups (`LOWER() = LOWER()`), updated doc comments |
| 11 | `backend/src/modules/labeled-entities/labeled-entities.service.spec.ts` (module root) | Modify | Update the hardcoded old where-clause assertion; add case-insensitivity lookup spec |
| 12 | `docs/plans/todo.md` | Modify | Check off / correct the three fixed bullets |

## Execution rules

- TDD per task: failing test first, implement, green.
- After any `shared/` change: `npm run gen`, and confirm generated copies are byte-identical to source.
- EVM/Tron/BTC behavior that is NOT named in a task must remain byte-identical — `git diff` discipline per task.
- No commits. `git status` at end of every task.

---

## Task 1: `shared/amounts.ts` — exact raw→decimal converter

**Implementer:** sonnet
**Files:** Create `shared/amounts.ts` · Create `frontend/src/utils/amounts.test.ts` (imports the generated copy `../generated/shared/amounts`)

**Step 1 — write the failing test** (`frontend/src/utils/amounts.test.ts`):
```ts
import { rawAmountToDecimalString } from '../generated/shared/amounts';

describe('rawAmountToDecimalString', () => {
  it('converts wei to ether string exactly', () => {
    expect(rawAmountToDecimalString('1500000000000000000', 18)).toBe('1.5');
    expect(rawAmountToDecimalString('1', 18)).toBe('0.000000000000000001');
    expect(rawAmountToDecimalString('1000000000000000000', 18)).toBe('1');
  });
  it('converts sun (tron, 6 decimals)', () => {
    expect(rawAmountToDecimalString('2500000', 6)).toBe('2.5');
  });
  it('handles zero, empty, and zero decimals', () => {
    expect(rawAmountToDecimalString('0', 18)).toBe('0');
    expect(rawAmountToDecimalString('', 18)).toBe('0');
    expect(rawAmountToDecimalString('42', 0)).toBe('42');
  });
  it('trims trailing zeros but never uses exponent notation', () => {
    expect(rawAmountToDecimalString('1230000000000000000000000', 18)).toBe('1230000');
    expect(rawAmountToDecimalString('1000000000000000000000000', 18)).toBe('1000000');
  });
  it('passes through non-integer input unchanged (already-human values)', () => {
    expect(rawAmountToDecimalString('1.5', 18)).toBe('1.5');
    expect(rawAmountToDecimalString('abc', 18)).toBe('abc');
  });
});
```
**Step 2 — run, confirm failure:** `npm run test --prefix frontend -- amounts` → module-not-found.
**Step 3 — implement** `shared/amounts.ts` (match `shared/address.ts` doc-comment style):
```ts
// Exact base-unit → human-decimal conversion. BigInt math only — no floats,
// no abbreviation, no exponent notation. Used by the internal import
// producers (case seed, search-between) to satisfy the import contract's
// human-readable `amount` for bare (non-utxo) items.

/**
 * Convert a raw integer base-unit string (wei/sun/…) to an exact decimal
 * string using `decimals`. Non-integer input (already human-readable, or
 * malformed) is returned unchanged — this function must never corrupt a
 * value it does not understand.
 */
export function rawAmountToDecimalString(raw: string, decimals: number): string {
  if (!raw) return '0';
  if (!/^\d+$/.test(raw)) return raw;
  const value = BigInt(raw);
  if (value === 0n) return '0';
  if (decimals <= 0) return value.toString();
  const div = 10n ** BigInt(decimals);
  const whole = value / div;
  const frac = (value % div).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}
```
**Step 4 —** `npm run gen` (copies land in both `src/generated/shared/`; api-types must not churn), rerun test → green. Run the full frontend suite.
**Step 5 —** `git status`.

## Task 2: Backend `toImportItem` — human-readable amounts for search-between imports

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/traces/traces.service.ts` (`toImportItem`, ~:931-946) · Extend `backend/src/modules/traces/traces.service.spec.ts`

**Step 1 — failing spec** (in the `searchBetween` describe block): a mocked EVM `TransactionResult` with `amount: '1500000000000000000'`, `token: { address: '0x', symbol: 'ETH', decimals: 18 }` run through search-between must yield a result item with `amount === '1.5'` and `token === 'ETH'`. A BTC row carrying `utxo` with `amount: '250000'` must keep `amount === '250000'` (sats, untouched).
**Step 2 — run, confirm failure:** `npm run test --prefix backend -- traces.service`.
**Step 3 — implement:** in `toImportItem`, replace the pass-through:
```ts
// Bare (non-utxo) items are human-readable per the import contract; BTC
// utxo rows stay in raw sats (importTransactions writes the token object
// and treats utxo amounts as base units).
item.amount = tx.utxo ? tx.amount : rawAmountToDecimalString(tx.amount, tx.token.decimals);
```
Import `rawAmountToDecimalString` from `../../generated/shared/amounts`. Update the method's doc comment (delete the stale "reformatting is the import path's job" sentence).
**Step 4 —** rerun → green; full backend suite (only the 13 known e2e failures).
**Step 5 —** `git status`.

## Task 3: Frontend `mapFetchedTx` — human-readable amounts for case-seed imports

**Implementer:** sonnet
**Files:** Modify `frontend/src/hooks/useCaseSeed.ts` (`mapFetchedTx` ~:71-87 AND the local `FetchedTx` interface ~:32-49) · Extend `frontend/src/hooks/useCaseSeed.test.ts`

**Type prerequisite:** the local `FetchedTx` interface declares `token: { symbol?: string } | string` — no `decimals`. Widen it to `token: { symbol?: string; decimals?: number } | string` first, or the Step 3 code fails ts-jest diagnostics before tsc ever runs.

**Step 1 — failing test:** `mapFetchedTx` with an EVM fetched tx (`amount: '1500000000000000000'`, token object `{symbol:'ETH', decimals:18}`) returns `amount: '1.5'`; with a Tron tx (`'2500000'`, decimals 6) returns `'2.5'`; with a BTC tx carrying `utxo` (`amount: '250000'`) returns `'250000'` unchanged; with a string token (no decimals known) passes the amount through unchanged.
**Step 2 — run, confirm failure:** `npm run test --prefix frontend -- useCaseSeed`.
**Step 3 — implement:** in `mapFetchedTx`:
```ts
const decimals = typeof tx.token === 'object' && tx.token ? tx.token.decimals : undefined;
const amount =
  tx.utxo !== undefined || decimals === undefined
    ? tx.amount
    : rawAmountToDecimalString(tx.amount, decimals);
```
Use `amount` in the item; import from `../generated/shared/amounts`. Extend the function's doc comment (units rule).
**Step 4 —** rerun → green; full frontend suite.
**Step 5 —** `git status`.

## Task 4: Labeled entities — case-preserving storage, case-insensitive lookup

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/labeled-entities/dto/create-labeled-entity.dto.ts:16-19`, `dto/update-labeled-entity.dto.ts` (wallets transform), `labeled-entities.service.ts` (`lookupByAddress` ~:40-48, `lookupByAddresses` ~:54-87, doc comments) · Create `dto/create-labeled-entity.dto.spec.ts` + `dto/update-labeled-entity.dto.spec.ts` (co-located DTO specs are the repo convention — see `backend/src/modules/traces/dto/import-transactions.dto.spec.ts`, `backend/src/modules/declarants/dto/create-declarant.dto.spec.ts`) · Modify `backend/src/modules/labeled-entities/labeled-entities.service.spec.ts` (**module root** — this is the `Test.createTestingModule` + mockQb harness; NOTE there is also a second, lighter spec at `__tests__/labeled-entities.service.spec.ts` covering only `lookupByAddresses` — leave it alone unless its assertions break)

**Step 1 — failing specs:**
- DTO transform specs (plainToInstance, in the two new co-located spec files): `['  0xABCDEF1234567890abcdef1234567890ABCDEF12  ', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'TXYZa1b2c3…', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq']` → `0x…` trimmed AND lowercased; base58/Tron/bech32 trimmed, case preserved. Same for the update DTO.
- Service lookup (root spec file's mockQb harness): `lookupByAddress('1A1zP…')` must produce SQL comparing `LOWER(w) = LOWER(:address)` (assert the where-clause string + params), so a legacy lowercased row and a new case-preserved row both match. **The root spec already contains a `lookupByAddress` test hardcoding the OLD clause `w = LOWER(:address)` — update that assertion in the same change** (it will otherwise fail after Step 3).
**Step 2 — run, confirm failure:** `npm run test --prefix backend -- labeled-entities`.
**Step 3 — implement:**
- Both DTO transforms (shape-based — the wallets array has no per-entry chain):
```ts
@Transform(({ value }) =>
  value
    ? (value as string[]).map((w) => {
        const t = w.trim();
        // Only EVM hex addresses are case-insensitive; base58 (BTC/Tron)
        // and bech32 are stored as entered so display stays valid.
        return t.startsWith('0x') || t.startsWith('0X') ? t.toLowerCase() : t;
      })
    : value,
)
```
(create DTO omits the `value ? … : value` guard if wallets is required there — mirror the current structure).
- `lookupByAddress`: `WHERE LOWER(w) = LOWER(:address)`.
- `lookupByAddresses`: already lowercases both sides (`LOWER(w) = ANY(:addresses)` with lowered inputs) — matching is correct; keep it, but the returned map keys stay lowercased: update the doc comment to say so explicitly. Update the stale class-level comments ("wallets are stored lowercased") to describe the new rule.
**Step 4 —** rerun → green; full backend suite.
**Step 5 —** `git status`. Note in the report: pre-existing rows keep lowercased values until re-saved (accepted; no migration).

## Task 5: `createGroup` inline nodes — chain-aware keys and persisted addresses

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/traces/traces.service.ts` (`createGroup`, newNodes block ~:206-249) · Extend `backend/src/modules/traces/traces.service.spec.ts`

**Step 1 — failing specs** (new `createGroup (addresses)` describe block):
- One `createGroup` call with `newNodes` containing the same BTC base58 address twice — once whitespace-padded, once bare → exactly **one** node created, both memberships resolved to it, stored `address` trimmed and case-preserved.
- A `newNodes` BTC entry whose address matches an existing node in a different case → reuses the existing node (case-insensitive matching), does not create a duplicate.
- EVM regression: `newNodes` with a checksummed `0xAbC…` address behaves exactly as today (keying unchanged; persisted value unchanged from current behavior — verify current behavior first and lock it).
**Step 2 — run, confirm failure:** `npm run test --prefix backend -- traces.service`.
**Step 3 — implement,** mirroring `ensureAddressNode` in `importTransactions` exactly — **including its null-guards** (`trace.data` nodes are unvalidated JSON; a node without `address` is reachable and `addressKey()` calls `.trim()` unguarded, so an unguarded map would throw):
- Keys: build/probe `existingAddresses` / `addressToId` via `addressKey(...)` with the same guards `importTransactions` uses (see `traces.service.ts:464,472,484,494`): `nodes.map((n) => (n.address ? addressKey(n.address) : undefined))` filtered of undefined, and `if (n.address) addressToId.set(addressKey(n.address), n.id)`. `def.address` is DTO-validated (`@IsString`) so `addressKey(def.address)` needs no guard.
- Persisted value: `const address = def.chain === 'bitcoin' ? normalizeAddressForChain(def.address, def.chain) : def.address;` — use `address` for the stored node's `address`, `defaultLabel` slices, and `explorerAddressUrl(def.chain, address)`.
**Step 4 —** rerun → green; full backend suite.
**Step 5 —** `git status`.

## Task 6: Regression gate + todo bookkeeping

**Implementer:** sonnet
1. `npm run test --prefix backend` (green except the 13 known e2e), `npm run test --prefix frontend` (fully green), `npx tsc --noEmit` in both, `npm run build --prefix backend`, `npm run build --prefix frontend`, `npm run gen` idempotency (`git status --porcelain` identical before/after).
2. `docs/plans/todo.md`: check off (`[x]`) the three fixed bullets (labeled-entities case fix; EVM import-units mismatch; `createGroup` untrimmed keys) with a trailing "— fixed in `2026-08-05-btc-hardening.md`". While there, correct the labeled-entities bullet's frontend claim if still present: `useLabeledEntities.ts`'s lowercase cache keys are case-insensitive **matching** (correct behavior), the corruption was backend storage.
3. Final `git status` + `git diff --stat HEAD` in the report. No commits.

## Verification (end-to-end)

1. Unit suites cover every fix (converter, both producers, DTO transforms, lookup SQL, createGroup keying).
2. Manual spot-check (optional, for /qa): case-seed an active EVM address → imported edge amounts read as normal ETH values (e.g. `1.5 ETH`, not an 18-digit number); create a labeled entity with a base58 BTC wallet → `/entities` shows it case-intact and the graph badge still matches; create a group with an inline BTC node using a padded address → one node.
3. No migrations: labeled-entity wallets are a jsonb array, trace data is JSONB — data-shape changes only, `synchronize: true` covers dev, nothing for `./migrations.sh`.
