# BTC QA Fixes Implementation Plan

**Goal:** Fix the three failures from the Bitcoin-support QA run: 5.1 aggregated BTC amounts lose precision, 1.5 Tron addresses lowercased on manual create, 6.2 junction nodes selectable as search wallets.

## Summary

- **What & why:** QA confirmed the BTC feature's evidentiary core is sound but found three display/UX defects. A collapsed group's edge can read **"0 BTC"** for a real 0.0274 BTC flow (materially misleading in an evidentiary tool); manually-created Tron addresses are corrupted by lowercasing; and `txJunction` nodes appear in the search-between wallet picker, where selecting one sends a txid as an address and surfaces a raw backend regex to the user.
- **Key product decisions:** none — all three fixes restore already-specified behavior. No visible behavior changes beyond the corrections themselves.
- **Engineering decisions made (no ask needed):**
  - Aggregated/summed amounts adopt the **same display policy as single-edge labels** (4 fractional digits, extended window below 0.0001, K/M/B/T above 1000) via one new shared helper `formatHumanAmount`, replacing three divergent local formatters. Amounts are accumulated as floats upstream; formatting the float is sufficient — no re-plumbing of raw values (YAGNI).
  - Tron fix applies `normalizeAddressForChain` unconditionally (it already lowercases EVM and preserves Tron/BTC). **No migration for already-corrupted Tron nodes**: lowercasing base58check is irreversible (checksum casing lost), and QA found real cases (Geffen, 35 Tron nodes) unaffected because the fetch/import path was always correct.
  - 6.2 is fixed **frontend-only** (filter the picker). The backend `resolveWalletSet` already filters `kind !== 'txJunction'` on trace/group expansion, and the DTO regex guard stays as the defense-in-depth backstop. No friendlier error-message mapping — with the picker filtered, that path is unreachable from this flow.
- **Risk concentration:** low across the board; all tasks are `sonnet`. Task 2 has the widest blast radius (canvas labels) but its formatter is provably aggregation-only — plain edges already use `formatTokenAmount`.

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task.
>
> **Project rule (overrides the usual per-task commit step): do NOT commit.** Leave all changes in the working tree and run `git status` at the end of each task instead. No `Co-Authored-By` trailers if the operator later asks for a commit.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `frontend/src/utils/formatAmount.ts` | Modify | New `formatHumanAmount(h)` — full-precision display for accumulated human-float amounts; collapsed BTC groups stop reading "0 BTC" |
| 2 | `frontend/src/utils/formatAmount.test.ts` | Modify | Tests for `formatHumanAmount` |
| 3 | `frontend/src/hooks/cytoscapeSync.ts` | Modify | Aggregated-edge + bundle labels use `formatHumanAmount` (delete local `abbr`) |
| 4 | `frontend/src/hooks/cytoscapeSync.test.ts` | Modify | Regression test: aggregated BTC edge label precision |
| 5 | `frontend/src/components/Graph/MultiTxDetails.tsx` | Modify | Aggregated panel totals + per-tx rows use `formatHumanAmount` (delete local `abbr`) |
| 6 | `frontend/src/components/Graph/details/GroupDetails.tsx` | Modify | Group Flows tab uses `formatHumanAmount` (delete local `fmtFlow`) |
| 7 | `frontend/src/hooks/useWalletTransactionAuthoring.ts` | Modify | Tron (all non-EVM) addresses persist case-intact on manual create |
| 8 | `frontend/src/hooks/useWalletTransactionAuthoring.test.ts` | Modify | Tron case-preservation tests |
| 9 | `frontend/src/components/AdvancedSearch/WalletGroupPicker.tsx` | Modify | `txJunction` nodes excluded from the search wallet picker |
| 10 | `frontend/src/components/AdvancedSearch/WalletGroupPicker.test.tsx` | Create | Test: junction nodes never offered as selectable wallets |

All frontend. Test runner: Jest — run single files from `frontend/` as `npx jest src/<path>`.

---

## Task 1: Shared `formatHumanAmount` helper

**Implementer:** sonnet
**Files:** Modify `frontend/src/utils/formatAmount.ts` (append after `formatTokenAmount`, line 102), Modify `frontend/src/utils/formatAmount.test.ts` (append).

**Context.** Three components format *accumulated human floats* (already divided by 10^decimals) with formatters capped at 1–2 fractional digits, so BTC values like 0.0274 render as `0` or `0.03`. `formatTokenAmount` has the right display policy but takes raw smallest-unit strings. Add a float-input sibling with the identical policy.

**Step 1: Write the failing test.** Append to `frontend/src/utils/formatAmount.test.ts`:

```ts
import { formatTokenAmount, formatHumanAmount } from './formatAmount';
```
(replace the existing line-1 import), then append at the bottom:
```ts

describe('formatHumanAmount', () => {
  it('renders a small BTC aggregate at 4 fractional digits (regression: collapsed group read "0 BTC")', () => {
    expect(formatHumanAmount(0.02736284)).toBe('0.0274');
  });

  it('does not round a 4-digit value further', () => {
    expect(formatHumanAmount(0.0274)).toBe('0.0274');
  });

  it('extends precision below 0.0001 so first significant digits are visible', () => {
    expect(formatHumanAmount(0.0000079)).toBe('0.0000079');
  });

  it('renders one satoshi (1e-8)', () => {
    expect(formatHumanAmount(0.00000001)).toBe('0.00000001');
  });

  it('keeps K/M/B/T abbreviation for large values (parity with formatTokenAmount)', () => {
    expect(formatHumanAmount(17_000_000)).toBe('17M');
    expect(formatHumanAmount(151_035_283)).toBe('151.04M');
    expect(formatHumanAmount(2_250_000_000_000)).toBe('2.25T');
    expect(formatHumanAmount(1546.373)).toBe('1.55K');
  });

  it('leaves mid-range values in plain notation', () => {
    expect(formatHumanAmount(920.55)).toBe('920.55');
    expect(formatHumanAmount(1.5)).toBe('1.5');
  });

  it('returns "0" for zero and non-finite input', () => {
    expect(formatHumanAmount(0)).toBe('0');
    expect(formatHumanAmount(NaN)).toBe('0');
    expect(formatHumanAmount(Infinity)).toBe('0');
  });
});
```

**Step 2: Run it, confirm it fails.**
```bash
cd frontend && npx jest src/utils/formatAmount.test.ts
```
Expected: compile error — `formatHumanAmount` is not exported.

**Step 3: Minimal implementation.** Append to `frontend/src/utils/formatAmount.ts` (after `formatTokenAmount`; it reuses the module-private `abbrev` defined at line 45):

```ts

/**
 * Format an already-human token amount (a float, post-division by 10^decimals)
 * for display. Mirrors formatTokenAmount's policy so aggregated/summed values
 * read identically to single-edge labels:
 *  - >= 1000: K/M/B/T abbreviation
 *  - < 1000: up to 4 fractional digits
 *  - below 0.0001 (but non-zero): extended window up to 8 fractional digits so
 *    the first significant digits stay visible (e.g. "0.0000079", never "0")
 *
 * Use this for values that only exist as accumulated floats (aggregated edges,
 * bundle labels, group flows, multi-tx totals). When the raw smallest-unit
 * string is at hand, prefer formatTokenAmount — its BigInt path is exact.
 */
export function formatHumanAmount(h: number): string {
  if (!isFinite(h) || h === 0) return '0';
  const abs = Math.abs(h);
  if (abs >= 1e12) return abbrev(h, 1e12, 'T');
  if (abs >= 1e9) return abbrev(h, 1e9, 'B');
  if (abs >= 1_000_000) return abbrev(h, 1_000_000, 'M');
  if (abs >= 1_000) return abbrev(h, 1_000, 'K');
  const digits = abs < 0.0001 ? 8 : 4;
  return h.toLocaleString('en-US', { maximumFractionDigits: digits });
}
```

**Step 4: Run tests, confirm pass.**
```bash
cd frontend && npx jest src/utils/formatAmount.test.ts
```
Expected: all tests pass (existing 9 `formatTokenAmount` + new 7).

**Step 5: Status.** `git status` — expect only the two files modified. Do not commit.

---

## Task 2: Route the three aggregation formatters through `formatHumanAmount`

**Implementer:** sonnet
**Files:** Modify `frontend/src/hooks/cytoscapeSync.ts` (lines 4, 139–144, 184, 210), Modify `frontend/src/components/Graph/MultiTxDetails.tsx` (lines 4, 44–50, 97, 237), Modify `frontend/src/components/Graph/details/GroupDetails.tsx` (lines 4, 7–13, 149, 162), Test `frontend/src/hooks/cytoscapeSync.test.ts` (append).

**Blast-radius note (verified):** `abbr` in `cytoscapeSync.ts` is called only from the aggregated-edge label (line 184) and collapsed-bundle label (line 210). Plain single edges use `formatTokenAmount` (line 176) and are unaffected. `MultiTxDetails.tsx`'s `abbr` and `GroupDetails.tsx`'s `fmtFlow` are file-local with 2 call sites each.

**Step 1: Write the failing test.** Append to `frontend/src/hooks/cytoscapeSync.test.ts` inside `describe('syncCytoscape', ...)` (fixture builders `wallet`/`edge`/`trace`/`inv` and types `Group` already exist in the file):

```ts

  it('12. aggregated BTC edge keeps sub-1 precision in its label (regression: "0 BTC")', () => {
    const g: Group = { id: 'g1', name: 'Group 1', traceId: 'trace-a', collapsed: true };
    const w1 = wallet('w1', { chain: 'bitcoin' });
    const w2 = wallet('w2', { chain: 'bitcoin', groupId: 'g1' });
    const w3 = wallet('w3', { chain: 'bitcoin', groupId: 'g1' });
    const btc = { address: '', symbol: 'BTC', decimals: 8 };
    // 514,179 + 624,660 sats = 0.01138839 BTC — must not render as "0 BTC (2)"
    const e1 = edge('e1', 'w1', 'w2', { chain: 'bitcoin', token: btc, amount: '514179' });
    const e2 = edge('e2', 'w1', 'w3', { chain: 'bitcoin', token: btc, amount: '624660' });
    const t = trace('trace-a', { nodes: [w1, w2, w3], edges: [e1, e2], groups: [g] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t]));

    const agg = cy.__addCalls.find((c) => c.data.isAggregatedEdge)!;
    expect(agg).toBeDefined();
    expect(agg.data.label).toBe('0.0114 BTC (2)');
  });

  it('13. aggregated BTC edge below 0.0001 keeps extended precision', () => {
    const g: Group = { id: 'g1', name: 'Group 1', traceId: 'trace-a', collapsed: true };
    const w1 = wallet('w1', { chain: 'bitcoin' });
    const w2 = wallet('w2', { chain: 'bitcoin', groupId: 'g1' });
    const btc = { address: '', symbol: 'BTC', decimals: 8 };
    const e1 = edge('e1', 'w1', 'w2', { chain: 'bitcoin', token: btc, amount: '7900' });
    const t = trace('trace-a', { nodes: [w1, w2], edges: [e1], groups: [g] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t]));

    const agg = cy.__addCalls.find((c) => c.data.isAggregatedEdge)!;
    expect(agg.data.label).toBe('0.000079 BTC');
  });
```

**Step 2: Run it, confirm it fails.**
```bash
cd frontend && npx jest src/hooks/cytoscapeSync.test.ts
```
Expected: tests 12 and 13 fail on the label assertion (current `abbr` renders `0 BTC (2)` / `0 BTC`); tests 1–11 still pass.

**Step 3: Minimal implementation.**

**(a) `frontend/src/hooks/cytoscapeSync.ts`** — line 4, add the import:
```ts
import { formatHumanAmount, formatTokenAmount, normalizeToken, parseTimestamp, tokenKey } from '../utils/formatAmount';
```
Delete the local `abbr` (lines 139–144):
```ts
      const abbr = (h: number) =>
        h >= 1e12 ? `${(h/1e12).toFixed(2).replace(/\.?0+$/, '')}T`
        : h >= 1e9 ? `${(h/1e9).toFixed(2).replace(/\.?0+$/, '')}B`
        : h >= 1e6 ? `${(h/1e6).toFixed(1).replace(/\.?0+$/, '')}M`
        : h >= 1e3 ? `${(h/1e3).toFixed(1).replace(/\.?0+$/, '')}K`
        : h.toLocaleString(undefined, { maximumFractionDigits: 1 });
```
Line 184: `abbr(a.human)` → `formatHumanAmount(a.human)`.
Line 210: `abbr(totalHuman)` → `formatHumanAmount(totalHuman)`.

**(b) `frontend/src/components/Graph/MultiTxDetails.tsx`** — line 4:
```ts
import { formatHumanAmount, normalizeToken, parseTimestamp } from '@/utils/formatAmount';
```
Delete the local `abbr` (lines 44–50). Replace both call sites: line 97 `abbr(amt)` → `formatHumanAmount(amt)`; line 237 `abbr(human)` → `formatHumanAmount(human)`.

**(c) `frontend/src/components/Graph/details/GroupDetails.tsx`** — line 4:
```ts
import { formatHumanAmount, normalizeToken } from '@/utils/formatAmount';
```
Delete the local `fmtFlow` (lines 7–13). Replace both call sites: line 149 `fmtFlow(f.amount)` → `formatHumanAmount(f.amount)`; line 162 `fmtFlow(f.amount)` → `formatHumanAmount(f.amount)`.

(Line numbers refer to the current working tree; re-locate by the verbatim snippets above if drifted.)

**Step 4: Run tests, confirm pass.**
```bash
cd frontend && npx jest src/hooks/cytoscapeSync.test.ts && npx jest src/utils/formatAmount.test.ts && npx tsc --noEmit
```
Expected: all cytoscapeSync tests (13) and formatAmount tests pass; typecheck clean (confirms no dangling `abbr`/`fmtFlow` references).

**Step 5: Status.** `git status`. Do not commit.

**Accepted display deltas** (all improvements or neutral, list for the reviewer): K/M values now use 2-decimal abbreviation instead of 1 (`146.3M` → `146.25M`) matching `formatTokenAmount`; sub-1000 values show up to 4 fractional digits instead of 1–2; `en-US` locale pinned (was locale-dependent `undefined`).

---

## Task 3: Preserve Tron casing on the manual-create path

**Implementer:** sonnet
**Files:** Modify `frontend/src/hooks/useWalletTransactionAuthoring.ts` (lines 54, 86, 192–209), Test `frontend/src/hooks/useWalletTransactionAuthoring.test.ts` (append).

**Context.** Three sites use `chain === 'bitcoin' ? normalizeAddressForChain(raw, ch) : raw.toLowerCase()`. `normalizeAddressForChain` (`frontend/src/generated/shared/address.ts`, in sync with `shared/address.ts` — verified byte-identical, no regen needed) already implements the correct policy for *every* chain: lowercase EVM, preserve Tron/Bitcoin. Apply it unconditionally. Lookup keys stay case-insensitive (`addressKey` lowercases for comparison only) — only the *persisted* value changes.

**Step 1: Write the failing test.** Append to `frontend/src/hooks/useWalletTransactionAuthoring.test.ts` (mirrors the existing BTC manual-entry describes at lines 326–360; `useHarness`, `inv`, `trace` already exist in the file):

```ts

describe('handleSaveNewWallet — manual Tron entry', () => {
  it('persists a manually-entered Tron address case-intact (not lowercased)', () => {
    const RAW = ' TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t ';
    const TRIMMED = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleSaveNewWallet('trace-1', { address: RAW, chain: 'tron' });
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(1);
    expect(t1.nodes[0].address).toBe(TRIMMED);
    expect(t1.nodes.some((n) => n.address === TRIMMED.toLowerCase())).toBe(false);
  });
});

describe('findOrCreateWallet — manual Tron entry via transaction endpoints', () => {
  it('persists Tron addresses case-intact when created through handleSaveNewTransaction', () => {
    const FROM_RAW = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const TO_RAW = 'TGzgVdQszcAHbEd9VELwifASLRdQY9kTcx';

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleSaveNewTransaction('trace-1', {
        from: FROM_RAW,
        to: TO_RAW,
        chain: 'tron',
      });
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes.map((n) => n.address).sort()).toEqual([FROM_RAW, TO_RAW].sort());
  });
});
```

**Step 2: Run it, confirm it fails.**
```bash
cd frontend && npx jest src/hooks/useWalletTransactionAuthoring.test.ts
```
Expected: both new tests fail — persisted addresses come back lowercased. Existing tests pass.

**Step 3: Minimal implementation.** In `frontend/src/hooks/useWalletTransactionAuthoring.ts`:

Line 54:
```ts
    const addr = normalizeAddressForChain(raw, ch);
```
Line 86:
```ts
    const normAddress = normalizeAddressForChain(address, chain);
```
Line 209:
```ts
        const persisted = normalizeAddressForChain(addr, chain);
```
Update the now-stale doc comment above `ensureWalletNode` (lines 192–204): replace BOTH final sentences — "Persisted value is chain-aware: bitcoin keeps its case (trimmed only) via `normalizeAddressForChain`, matching the backend import path." (lines 199–200) AND "Every other chain keeps the pre-existing lowercase-everywhere behavior unchanged — Tron is technically case-sensitive, but fixing that here would be an unrelated behavior change." (lines 201–203) — with this single merged paragraph:
```ts
     * Persisted value is chain-aware via `normalizeAddressForChain`, matching
     * the backend import path: EVM lowercased, Tron and Bitcoin case-preserved
     * (both are case-sensitive base58/bech32). Lookup stays case-insensitive
     * via `addressKey`.
```

**Step 4: Run tests, confirm pass.**
```bash
cd frontend && npx jest src/hooks/useWalletTransactionAuthoring.test.ts
```
Expected: all pass, including the existing EVM regression (`keeps the pre-existing lowercase-everywhere behavior for EVM rows`) — EVM still lowercases via `normalizeAddressForChain`.

**Step 5: Status.** `git status`. Do not commit.

---

## Task 4: Exclude junction nodes from the search wallet picker

**Implementer:** sonnet
**Files:** Modify `frontend/src/components/AdvancedSearch/WalletGroupPicker.tsx` (lines 61–70), Create `frontend/src/components/AdvancedSearch/WalletGroupPicker.test.tsx`.

**Context.** `allChainNodes` collects every trace node on the chain with no `kind` filter, so `txJunction` nodes (whose `address` holds a txid) appear as selectable wallets; selecting one 400s at the backend DTO regex and shows the user a raw regex. Backend trace/group expansion (`resolveWalletSet`, `backend/src/modules/traces/traces.service.ts:399`) already filters `kind !== 'txJunction'` — this fix brings the client "By wallets" mode in line. The DTO regex guard stays untouched as defense in depth.

**Step 1: Write the failing test.** Create `frontend/src/components/AdvancedSearch/WalletGroupPicker.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { WalletGroupPicker } from './WalletGroupPicker';
import type { Investigation, Trace, WalletNode } from '../../types/investigation';

// WalletGroupPicker calls useLabeledEntities() (network-backed cache) — stub it
// out, same convention as the api-client mocks in useWalletTransactionAuthoring.test.ts.
jest.mock('@/hooks/useLabeledEntities', () => ({
  useLabeledEntities: () => ({ lookupAddress: () => undefined }),
}));

function wallet(id: string, overrides: Partial<WalletNode> = {}): WalletNode {
  return {
    id,
    label: id,
    address: `addr-${id}`,
    chain: 'bitcoin',
    notes: '',
    tags: [],
    position: { x: 0, y: 0 },
    parentTrace: 'trace-1',
    ...overrides,
  };
}

function makeInvestigation(nodes: WalletNode[]): Investigation {
  const trace: Trace = {
    id: 'trace-1',
    name: 'Trace 1',
    criteria: { type: 'custom' },
    visible: true,
    nodes,
    edges: [],
    collapsed: false,
    position: { x: 0, y: 0 },
  };
  return {
    id: 'inv-1',
    name: 'Test',
    description: '',
    createdAt: '2024-01-01',
    traces: [trace],
    metadata: {},
  };
}

describe('WalletGroupPicker — junction exclusion', () => {
  it('does not offer txJunction nodes as selectable wallets', () => {
    const w = wallet('w1', {
      label: 'bc1q2w…xuxr',
      address: 'bc1q2w9xxf9wf7cvgepsxp83qg9x0a7fcfyx9mxuxr',
    });
    const junction = wallet('j1', {
      label: '40 in / 1 out',
      address: 'c4b2c45d8f73085da8b6b9d37d29dd304d344a4dca58a2ceaa6e1e5356031db8',
      kind: 'txJunction',
    });
    const inv = makeInvestigation([w, junction]);

    // value={} → picker opens in "By wallets" mode (the vulnerable path)
    render(
      <WalletGroupPicker
        label="SIDE A"
        investigation={inv}
        chain="bitcoin"
        value={{}}
        onChange={() => {}}
      />
    );

    // The real wallet is offered…
    expect(screen.getByText('bc1q2w…xuxr')).toBeTruthy();
    // …the junction is not — neither by label nor by (truncated) txid.
    expect(screen.queryByText('40 in / 1 out')).toBeNull();
    expect(screen.queryByText(/c4b2c4/)).toBeNull();
  });

  it('still offers explicit kind:"wallet" nodes (only txJunction is excluded)', () => {
    const w = wallet('w1', { label: 'bc1qzp…e8ac', kind: 'wallet' });
    render(
      <WalletGroupPicker
        label="SIDE A"
        investigation={makeInvestigation([w])}
        chain="bitcoin"
        value={{}}
        onChange={() => {}}
      />
    );
    expect(screen.getByText('bc1qzp…e8ac')).toBeTruthy();
  });
});
```

**Step 2: Run it, confirm it fails.**
```bash
cd frontend && npx jest src/components/AdvancedSearch/WalletGroupPicker.test.tsx
```
Expected: first test fails — `40 in / 1 out` IS rendered. (If the render itself throws on an unmocked dependency, mock it the same way and re-run; the assertion failure is the goal.)

**Step 3: Minimal implementation.** In `frontend/src/components/AdvancedSearch/WalletGroupPicker.tsx`, lines 61–70, add the kind filter:

```ts
  // All wallets across all traces filtered by chain, then by search query.
  // txJunction nodes are excluded: they stand for a transaction, not a wallet —
  // their `address` is a txid, which is not searchable (and the backend's
  // resolveWalletSet applies the same filter on trace/group expansion).
  const allChainNodes: Array<{ node: WalletNode; trace: Trace }> = useMemo(() => {
    const result: Array<{ node: WalletNode; trace: Trace }> = [];
    for (const trace of investigation.traces) {
      for (const node of trace.nodes) {
        if (node.chain === chain && node.kind !== 'txJunction') result.push({ node, trace });
      }
    }
    return result;
  }, [investigation.traces, chain]);
```

**Step 4: Run tests, confirm pass.**
```bash
cd frontend && npx jest src/components/AdvancedSearch/WalletGroupPicker.test.tsx && npx tsc --noEmit
```
Expected: both tests pass; typecheck clean.

**Step 5: Status.** `git status`. Do not commit.

---

## Final verification (after all tasks)

```bash
cd frontend && npx jest && npx tsc --noEmit
cd ../backend && npx jest --silent
```
Expected: full frontend suite green (347 pre-existing + new), typecheck clean, backend suite unchanged-green (backend untouched). Then `git status` to surface the working-tree diff for review. **Do not commit.**

Manual spot-check (optional, mirrors the QA repro steps): collapse a BTC group → aggregated edge shows `0.0114 BTC (2)`-style precision; Quick Add a Tron address → details panel shows mixed case + working tronscan link; open search-between on a junction-bearing trace → no junction rows in the picker.
