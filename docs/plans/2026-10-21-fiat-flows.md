# Fiat (Off-Chain) Money Flows Implementation Plan

**Goal:** Let an investigation graph hold bank accounts and wire transfers as first-class nodes and edges, built by the chat agent or by hand, alongside crypto.

## Summary
- **What & why:** Fraud matters (e.g. *Ellis v. Westland*) start in bank records, but the graph only models blockchains. The chat agent had no way to build a fiat flow, and anything imported with a made-up chain rendered as a broken wallet (truncated hex-style IDs, bogus explorer links, lowercased account numbers, abbreviated amounts like "1.23K USD").
- **Key product decisions:**
  - A new chain `fiat` ("Bank / Fiat") and node kind `account`. Account nodes show their name with a masked account number beneath (`•••• 4417`), a distinct bank shape, and no explorer link.
  - Fiat amounts render as currency, full value, two decimals: `$400,000.00` (other currencies via ISO code, e.g. `€1,250.00`). Never abbreviated, since exhibit amounts must be exact.
  - Fiat is not fetchable: it never appears in fetch, seed, Quick Add, search-between, or classification pickers, and account nodes have no "Fetch transactions" action. It does appear in the manual wallet/transaction forms, so an expert can add bank accounts by hand.
  - Account identifiers keep their exact case and are not shape-validated.
- **Load-bearing architecture decisions:**
  - `shared/chains.ts` gains an `onChain` flag and an `ON_CHAIN_CHAIN_IDS` list. Every fetch/provider/classification consumer switches to the on-chain list; every graph-model/authoring/display consumer keeps the full list. This one split is what keeps fiat out of blockchain code paths.
  - Fiat edges carry amounts in minor units (cents) with `tokenMeta: { address: '', decimals: 2 }` and `token: 'USD'`, the same raw-units convention EVM edges use, so existing token plumbing carries them unchanged.
  - Import keys fiat accounts as `fiat:<trimmed id>` (case kept, namespaced so they never collide with crypto addresses). Edge identity (`shared/edge-identity.ts`) still lowercases `from`/`to`; accepted, because a wire reference (`txHash`) is unique per wire and the agent guidance requires it.
  - The chat agent's `create_investigation` tool already shipped (commit `1c3eccd`); this plan only teaches the agent to use it for fiat.
- **Opus-tagged tasks:** 1 (shared registry split) and 3 (import path), the two with the widest blast radius.

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task.
>
> **Project rules that override generic defaults** (from `CLAUDE.md`): do NOT commit; leave changes in the working tree and run `git status` at the end of each task. Run only the spec/test files named in each task (`npx jest path/to/file`), never the full suite. Backend specs need Node 24: prefix commands with `export PATH="$HOME/.nvm/versions/node/v24.8.0/bin:$PATH" &&`. Run `npx tsc --noEmit` in the package you changed when types change. After editing anything in `shared/` or `contracts/`, run `npm run gen` from the repo root (copies `shared/` into both `generated/` dirs and regenerates api types); never edit `*/src/generated/*` by hand. No em dashes in user-facing copy.

## Atomized Change Table
| File | Action | What changes |
|---|---|---|
| `shared/chains.ts` | Modify | `fiat` family + chain entry, `onChain` flag, `ON_CHAIN_CHAIN_IDS`, `isOnChain()`, explorer helpers return `''` off-chain |
| `frontend/src/utils/chains.test.ts` | Modify | expect 8 chains; on-chain list excludes fiat; fiat explorer URLs are empty |
| `backend/src/modules/blockchain/types.ts` | Modify | `CHAIN_CONFIGS` built from on-chain chains only |
| `backend/src/modules/blockchain/provider-registry.ts` | Modify | explicit throw for off-chain chains |
| `backend/src/modules/mcp/tools/blockchain-tools.ts` | Modify | chain enum uses `ON_CHAIN_CHAIN_IDS` |
| `backend/src/modules/mcp/tools/write-tools.ts` | Modify | `importTxItemSchema` accepts optional `tokenMeta` |
| `backend/src/modules/traces/traces.service.ts` | Modify | fiat import: case-preserving keys, `kind: 'account'`, masked default label, no explorer URL; search-between rejects fiat |
| `backend/src/modules/traces/traces.service.spec.ts` | Modify | fiat import tests |
| `contracts/schemas/traces.yaml` | Modify | document `fiat` + minor units on `ImportTransactionItem.chain` / `amount` |
| `frontend/src/types/investigation.ts` | Modify | `WalletNode.kind` adds `'account'` |
| `frontend/src/services/types.ts` | Modify | `FETCHABLE_CHAINS` (on-chain subset) beside `SUPPORTED_CHAINS` |
| `frontend/src/utils/formatAmount.ts` | Modify | `formatFiatAmount()` |
| `frontend/src/utils/formatAmount.test.ts` | Modify | fiat formatting tests |
| `frontend/src/hooks/cytoscapeSync.ts` | Modify | account node label/sublabel/shape; fiat edge amounts via `formatFiatAmount` |
| `frontend/src/hooks/cytoscapeSync.test.ts` | Modify | account node + fiat edge + aggregate + bundle tests |
| `frontend/src/components/Graph/details/TransactionDetails.tsx` | Modify | fiat amount formatting |
| `frontend/src/components/Graph/MultiTxDetails.tsx` | Modify | fiat amount formatting |
| `frontend/src/components/Graph/details/WalletDetails.tsx` | Modify | hide fetch + classification for fiat; show "Bank account" |
| `frontend/src/components/Graph/graphContextMenu.tsx` | Modify | no "Fetch History" item on fiat nodes |
| `frontend/src/components/Graph/ChainIcon.tsx` | Modify | bank icon for `fiat` |
| `frontend/src/components/Workspace/FetchModal.tsx` | Modify | chain list from `FETCHABLE_CHAINS` |
| `frontend/src/components/Onboarding/CaseOnboardingWizard.tsx` | Modify | chain list from `FETCHABLE_CHAINS` |
| `frontend/src/components/Graph/QuickAddInput.tsx` | Modify | chain options from `ON_CHAIN_CHAIN_IDS` |
| `frontend/src/components/AdvancedSearch/SearchPanel.tsx` | Modify | exclude fiat from search-between chains |
| `frontend/src/hooks/useAddressClassifications.ts` | Modify | skip fiat nodes when collecting pairs |
| `frontend/src/components/Forms/WalletForm.tsx` | Modify | no crypto parse/override for fiat; fiat placeholder |
| `frontend/src/components/Forms/TransactionForm.tsx` | Modify | fiat token defaults USD / '' / 2 |
| `frontend/src/utils/normalizeInvestigation.ts` | Modify | don't re-derive chain or explorer URL for fiat nodes |
| `frontend/src/utils/importData.ts` | Modify | don't lowercase fiat account IDs; fiat token address `''` |
| `frontend/src/utils/importData.test.ts` | Create | fiat case preserved, EVM still lowercased |
| `backend/src/skills/graph-mutations.md` | Modify | "Fiat / off-chain flows" section |
| `backend/src/prompts/investigator.ts` | Modify | mention fiat flows + `create_investigation` |

## Task 1: Shared registry split
**Implementer:** opus
**Files:** Modify `shared/chains.ts`; Test `frontend/src/utils/chains.test.ts`.

**Step 1: Failing tests** in `frontend/src/utils/chains.test.ts` (update the existing `it('has exactly 7 chains…')` at lines 10-13: retitle to 8 and add `'fiat'` to its hardcoded id list; then add):
```ts
import { CHAINS, CHAIN_IDS, ON_CHAIN_CHAIN_IDS, isOnChain, explorerAddressUrl, explorerTxUrl, chainFamily } from '../generated/shared/chains';

it('registers fiat as an off-chain chain', () => {
  expect(CHAIN_IDS).toContain('fiat');
  expect(chainFamily('fiat')).toBe('fiat');
  expect(CHAINS.fiat.caseSensitiveAddresses).toBe(true);
  expect(CHAINS.fiat.nativeCurrency).toEqual({ symbol: 'USD', decimals: 2 });
});

it('excludes off-chain chains from the on-chain list', () => {
  expect(ON_CHAIN_CHAIN_IDS).not.toContain('fiat');
  expect(ON_CHAIN_CHAIN_IDS).toEqual(CHAIN_IDS.filter((id) => id !== 'fiat'));
  expect(isOnChain('ethereum')).toBe(true);
  expect(isOnChain('fiat')).toBe(false);
  expect(isOnChain('nope')).toBe(false);
});

it('returns no explorer link for fiat', () => {
  expect(explorerAddressUrl('fiat', '4417')).toBe('');
  expect(explorerTxUrl('fiat', 'FW2505020031')).toBe('');
});
```
(Match the file's existing import path for the generated chains module.)

**Step 2:** `cd frontend && npx jest src/utils/chains.test.ts` fails: `fiat` not registered.

**Step 3: Implementation** in `shared/chains.ts`:
- `export type ChainFamily = 'evm' | 'tron' | 'utxo' | 'solana' | 'fiat';`
- Add `onChain: boolean;` to `ChainDef`; set `onChain: true` on all seven existing entries.
- Add: `fiat: { id:'fiat', name:'Bank / Fiat', family:'fiat', chainId:0, nativeCurrency:{symbol:'USD',decimals:2}, explorerUrl:'', addressPath:'', txPath:'', caseSensitiveAddresses:true, onChain:false },`
- `export const ON_CHAIN_CHAIN_IDS = CHAIN_IDS.filter((id) => CHAINS[id].onChain) as [string, ...string[]];`
- `export function isOnChain(chain: string): boolean { return CHAINS[chain]?.onChain === true; }`
- `explorerAddressUrl` / `explorerTxUrl`: return `''` when `!c || !c.onChain || !c.explorerUrl`.
- Run `npm run gen` from the repo root.

**Step 4:** test passes; `cd frontend && npx tsc --noEmit` and `cd backend && npx tsc --noEmit -p tsconfig.json` are clean (the new required `onChain` field must not break any object literal typed as `ChainDef`).

**Step 5:** `git status`.

## Task 2: Keep fiat out of backend blockchain paths
**Implementer:** sonnet
**Files:** Modify `backend/src/modules/blockchain/types.ts` (~226-237), `backend/src/modules/blockchain/provider-registry.ts` (`get()`, ~45-70), `backend/src/modules/mcp/tools/blockchain-tools.ts` (~46-49); Test `backend/src/modules/blockchain/provider-registry.spec.ts`, `backend/src/modules/mcp/tools/blockchain-tools.spec.ts`.

**Step 1: Failing tests:**
- provider-registry.spec: `expect(() => registry.get('fiat')).toThrow(/off-chain/)`.
- blockchain-tools.spec: the chain schema rejects `'fiat'` (parse `{ address: '4417', chain: 'fiat' }` through the tool's input schema and expect failure), and still accepts `'ethereum'`.

**Step 2:** run both specs; they fail.

**Step 3:**
- `types.ts`: build `CHAIN_CONFIGS` from `Object.entries(CHAINS).filter(([, c]) => c.onChain)`.
- `provider-registry.ts` `get()`: once `CHAIN_CONFIGS` is filtered, the existing `CHAIN_CONFIGS[chainId]` check (~line 46) would throw "Unknown chain: fiat" first. Reorder the top of the cache-miss branch to: `if (!CHAINS[chainId]) throw new Error(\`Unknown chain: ${chainId}\`); if (!isOnChain(chainId)) throw new Error(\`${chainId} is an off-chain chain and has no blockchain provider\`); const config = CHAIN_CONFIGS[chainId];` (import `CHAINS`, `isOnChain` from `../../generated/shared/chains`), then the existing bitcoin/solana guards.
- `blockchain-tools.ts`: `z.enum(ON_CHAIN_CHAIN_IDS)` instead of `CHAIN_IDS`.

**Step 4:** both specs pass; `npx tsc --noEmit -p tsconfig.json` clean.

**Step 5:** `git status`.

## Task 3: Fiat import path
**Implementer:** opus
**Files:** Modify `backend/src/modules/traces/traces.service.ts` (`addressKey` :37 and its call sites :464, :484, :494-495, :617, :667-669, :686, :777-786 incl. `labelFor`/`pushLeg`; group creation :208-229; `ensureAddressNode` :556-590; `searchBetween` :855); Modify `backend/src/modules/mcp/tools/write-tools.ts` (`importTxItemSchema` :144-157 and the `import_transactions` handler's field copy :262-287); Modify `contracts/schemas/traces.yaml` (`ImportTransactionItem`); Test `backend/src/modules/traces/traces.service.spec.ts`.

**Step 1: Failing tests** in `traces.service.spec.ts`, using the spec's existing import harness:
- Importing `[{ from: 'WESTLAND-TRUST-4417', to: 'QUANTUM-EXCH-9921', txHash: 'FW2505020031', chain: 'fiat', timestamp: '2025-05-02T00:00:00.000Z', amount: '65000000', token: 'USD', tokenMeta: { address: '', decimals: 2 }, fromLabel: 'Westland Client Trust', toLabel: 'Quantum Exchange Ltd.' }]` creates two nodes with `kind: 'account'`, `chain: 'fiat'`, addresses with case preserved exactly, labels from `fromLabel`/`toLabel`, `explorerUrl: ''`, and one edge with `token: { address: '', symbol: 'USD', decimals: 2 }`, `amount: '65000000'`.
- An account imported with no label stores its trimmed identifier as its label (the frontend then renders it masked, Task 5).
- Two fiat identifiers differing only by case (`acct-AB12` vs `acct-ab12`) stay two nodes.
- A fiat account `ABC` and an EVM-shaped key never collide (keys are namespaced).
- Re-importing the same fiat wire into a trace that already holds its accounts reuses the existing nodes (exercises the existing-node maps).
- An EVM import still lowercases addresses and dedupes case-variants (regression).
- `searchBetween` with `chain: 'fiat'` throws `BadRequestException` matching `/off-chain/`.
- Group creation with a new fiat node definition and no label stores the trimmed identifier as the label and `kind: 'account'` (not the `0x…`-style default at :227). Do not add `'barrel'` to `NODE_SHAPES` in `group.dto.ts`; the frontend derives the shape.

**Step 2:** run the spec; the new tests fail.

**Step 3:**
- Change `addressKey(addr)` to `addressKey(addr: string, chain: string)`: returns `` `fiat:${addr.trim()}` `` when `chain === 'fiat'`, else the existing `addr.trim().toLowerCase()`. Update every call site listed above. Where a lookup map is built from existing nodes (:464, :484, :494), key each node with `addressKey(n.address, n.chain)`; where an incoming item is looked up, use the item's chain (`tx.chain` / `dto.chain`).
- Group creation (:208-229): replace `n.address?.toLowerCase()` and `def.address.toLowerCase()` with `addressKey(n.address, n.chain)` / `addressKey(def.address, def.chain)`; for a fiat `def` with no label, default the label to the trimmed address (not the `0x…`-style truncation at :227) and set `kind: 'account'`.
- `ensureAddressNode`: for fiat, store the trimmed address, set `kind: 'account'`, default the label to the trimmed address when none is given (never a `slice(0,6)…` truncation), and keep `explorerUrl: explorerAddressUrl(chain, address)` (Task 1 makes it `''`).
- Edge token: no change needed if `tokenMeta` is sent; confirm the existing `tx.tokenMeta ? evmToken(tx) : tx.token` branch yields `{ address: '', symbol: 'USD', decimals: 2 }`.
- `searchBetween` (:855): at the top, `if (!isOnChain(dto.chain)) throw new BadRequestException('Search-between works on blockchains only; fiat is an off-chain chain.');`.
- `write-tools.ts`: add `tokenMeta: z.object({ address: z.string(), decimals: z.number().int().min(0).max(36) }).optional()` to `importTxItemSchema`, AND in the `import_transactions` handler's per-field copy (:262-287) add `if (t.tokenMeta !== undefined) item.tokenMeta = t.tokenMeta;` (otherwise it is silently dropped).
- `traces.yaml` `ImportTransactionItem`: `chain` description: "Chain id, or `fiat` for bank/off-chain flows (accounts as from/to, wire reference as txHash)." `amount` description: "Amount in the token's smallest unit (wei, satoshi, cents); pass `tokenMeta.decimals` so it can be scaled." Run `npm run gen`.

**Step 4:** spec passes; `npx tsc --noEmit -p tsconfig.json` clean.

**Step 5:** `git status`.

## Task 4: Frontend types, chain lists, and fiat amount formatting
**Implementer:** sonnet
**Files:** Modify `frontend/src/types/investigation.ts` (line ~119), `frontend/src/services/types.ts` (~12-23), `frontend/src/utils/formatAmount.ts`; Test `frontend/src/utils/formatAmount.test.ts`.

**Step 1: Failing tests** in `formatAmount.test.ts`:
```ts
import { formatFiatAmount } from './formatAmount';
it('formats fiat minor units as exact currency', () => {
  expect(formatFiatAmount('40000000', 2, 'USD')).toBe('$400,000.00');
  expect(formatFiatAmount('8382790', 2, 'USD')).toBe('$83,827.90');
  expect(formatFiatAmount('125000', 2, 'EUR')).toBe('€1,250.00');
  expect(formatFiatAmount('5', 2, 'USD')).toBe('$0.05');
});
it('falls back to "<amount> <code>" for a non-ISO symbol', () => {
  expect(formatFiatAmount('12345', 2, 'POINTS')).toBe('123.45 POINTS');
});
```
**Step 2:** `cd frontend && npx jest src/utils/formatAmount.test.ts` fails.

**Step 3:**
- `investigation.ts`: `kind?: 'wallet' | 'txJunction' | 'account';`
- `services/types.ts`: keep `SUPPORTED_CHAINS` (all chains, used by authoring forms); add `export const FETCHABLE_CHAINS = Object.fromEntries(Object.entries(SUPPORTED_CHAINS).filter(([id]) => isOnChain(id)))` with the same value type.
- `formatAmount.ts`: `export function formatFiatAmount(rawAmount: string, decimals: number, currency: string): string` that scales with BigInt (no float loss), then `new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(...)`, catching the `RangeError` Intl throws for an invalid code and returning `` `${plain} ${currency}` `` with `plain` formatted to `decimals` places with thousands separators. For amounts beyond `Number.MAX_SAFE_INTEGER` minor units, build the string from the BigInt parts rather than converting to Number.

**Step 4:** test passes; `npx tsc --noEmit` clean.

**Step 5:** `git status`.

## Task 5: Graph rendering for accounts and fiat edges
**Implementer:** sonnet
**Files:** Modify `frontend/src/hooks/cytoscapeSync.ts` (node branch ~140-180; single-edge label ~220; `aggEdges` aggregation ~200-250; collapsed edge-bundle label ~262-270), `frontend/src/components/Graph/details/TransactionDetails.tsx` (~48), `frontend/src/components/Graph/MultiTxDetails.tsx` (per-row amount ~225 and "Total amount" ~82), `frontend/src/components/Graph/ChainIcon.tsx` (~11-19); Test `frontend/src/hooks/cytoscapeSync.test.ts`. No `cytoscapeStyle.ts` change: shape is data-driven (`data(nodeShape)`, cytoscapeStyle.ts:52) and `barrel` is a valid Cytoscape shape; `WalletNode.shape`'s typed union is not involved because `nodeShape` is computed data.

**Step 1: Failing tests** in `cytoscapeSync.test.ts` (use the file's `wallet`/`edge`/`trace`/`inv` builders):
- An account node `wallet('a1', { kind: 'account', chain: 'fiat', address: 'WESTLAND-TRUST-4417', label: 'Westland Client Trust' })` syncs with `displayLabel: 'Westland Client Trust'`, `truncAddr: '•••• 4417'`, `hasCustomLabel: true`, `nodeShape: 'barrel'`.
- An unlabeled account (`label` equal to its address, as the backend stores it, Task 3) gets `displayLabel: '•••• 4417'` and `hasCustomLabel: false`.
- A fiat edge `edge('e1','a1','a2',{ chain: 'fiat', amount: '40000000', token: { address: '', symbol: 'USD', decimals: 2 } })` has a label containing `'$400,000.00'`.
- Two such edges between members of a collapsed group aggregate to a label containing `'$800,000.00'`.
- Two such edges in a collapsed edge bundle produce a bundle label containing `'$800,000.00'`.

**Step 2:** run the spec; it fails.

**Step 3:**
- Node branch: when `node.kind === 'account' || node.chain === 'fiat'`, set `truncAddr = addr ? \`•••• ${addr.slice(-4)}\` : ''`; compute `hasCustomLabel` against the address and this masked form (a label equal to the address is not custom); display = custom label, else entity name, else `truncAddr`; `nodeShape = node.shape || 'barrel'`; skip the classification lookup.
- Single-edge label: when `edge.chain === 'fiat'`, use `formatFiatAmount(amount, decimals, symbol)`.
- `aggEdges`: extend each accumulator record with `chain`, `decimals`, and `rawSum: bigint` (alongside the existing float `human` and `sym`). For fiat edges add `BigInt(amount)` to `rawSum`; when rendering, a fiat accumulator uses `formatFiatAmount(rawSum.toString(), decimals, sym)`. Non-fiat accumulators render exactly as today.
- Collapsed edge-bundle label: same rule, summing fiat members as BigInt.
- `TransactionDetails.tsx` amount and `MultiTxDetails.tsx` per-row amount and "Total amount": use `formatFiatAmount` when the edge(s) are fiat (total = BigInt sum of same-currency fiat rows; if mixed currencies, list per currency).
- `ChainIcon.tsx`: map `fiat` to `FaBuildingColumns` from `react-icons/fa6`, name "Bank / Fiat".
- Details components and `ChainIcon` are covered indirectly (formatter tests in Task 4, sync tests here); no new component tests required.

**Step 4:** spec passes; `npx tsc --noEmit` clean.

**Step 5:** `git status`.

## Task 6: Keep fiat out of frontend fetch and classification paths
**Implementer:** sonnet
**Files:** Modify `frontend/src/components/Workspace/FetchModal.tsx` (~260), `frontend/src/components/Onboarding/CaseOnboardingWizard.tsx` (~465, `ChainSelect options`), `frontend/src/components/Graph/QuickAddInput.tsx` (~18 `CHAIN_OPTIONS`), `frontend/src/components/AdvancedSearch/SearchPanel.tsx` (~25-50 `chainsInInvestigation`), `frontend/src/hooks/useAddressClassifications.ts` (~38-43 `collectAddressPairs`), `frontend/src/components/Graph/details/WalletDetails.tsx` (~81 classification, ~166 chain label, ~223 Fetch button), `frontend/src/components/Graph/graphContextMenu.tsx` (~165-171); Test: existing `QuickAddInput.test.tsx`, `WalletDetails.test.tsx`, `useAddressClassifications.test.ts` (`collectAddressPairs` is at :34). The button text is "Fetch Transactions" (WalletDetails.tsx:226); `ChainLabel` is at :166.

**Step 1: Failing tests:**
- `collectAddressPairs` on an investigation with one EVM wallet and one fiat account returns only the EVM pair.
- `WalletDetails` for a fiat account renders no "Fetch Transactions" button and shows "Bank account".
- `QuickAddInput`'s chain options do not include `fiat`.

**Step 2:** run those test files; they fail.

**Step 3:** switch each listed picker to `FETCHABLE_CHAINS` / `ON_CHAIN_CHAIN_IDS`; filter `isOnChain(n.chain)` in `collectAddressPairs` and `chainsInInvestigation`; in `WalletDetails` and the context menu, hide fetch and classification UI when `!isOnChain(wallet.chain)`, and render the chain line as "Bank account".

**Step 4:** tests pass; `npx tsc --noEmit` clean.

**Step 5:** `git status`.

## Task 7: Manual authoring and import helpers accept fiat
**Implementer:** sonnet
**Files:** Modify `frontend/src/components/Forms/WalletForm.tsx` (~43-55 `handleAddressChange`, placeholder, ~173 chain list), `frontend/src/components/Forms/TransactionForm.tsx` (~143-151 token defaults), `frontend/src/utils/normalizeInvestigation.ts` (~27-35), `frontend/src/utils/importData.ts` (CSV ~77-78, JSON ~105-106); Test `frontend/src/utils/normalizeInvestigation.test.ts`, Create `frontend/src/utils/importData.test.ts`.

**Step 1: Failing tests:**
- `normalizeInvestigation` leaves a fiat node whose address looks like a BTC address (`'1A2b3C4d5E6f7G8h9JkLmNoPqRsTuVwXy'`) with `chain: 'fiat'` and `explorerUrl: ''` (today `parseAddressInput` would flip it to bitcoin).
- `importData` keeps `from`/`to` case for `chain: 'fiat'` rows and still lowercases EVM rows.

**Step 2:** run them; they fail.

**Step 3:**
- `normalizeInvestigation`: skip the chain re-derivation and explorer fallback when `node.chain === 'fiat'`.
- `importData`: both parsers lowercase `from`/`to` before reading the row's chain (:77-78, :105-106). Reorder so the chain is resolved first, then lowercase only when `chain !== 'fiat'`; for fiat rows default the token address to `''` (not `'0x'`).
- `WalletForm`: when the selected chain is fiat, don't run `parseAddressInput` (no chain override); placeholder "Account number or identifier"; the chain list keeps `SUPPORTED_CHAINS` (fiat included).
- `TransactionForm`: in the chain `<select>`'s onChange (currently just `setChain`, :353), when the new chain is `fiat` also set the token state to `{ symbol: 'USD', address: '', decimals: 2 }`; when switching away from fiat, restore the existing per-chain default. Do not use an effect.

**Step 4:** tests pass; `npx tsc --noEmit` clean.

**Step 5:** `git status`.

## Task 8: Teach the agent fiat flows
**Implementer:** sonnet
**Files:** Modify `backend/src/skills/graph-mutations.md`, `backend/src/prompts/investigator.ts`; Test `backend/src/skills/skill-registry.spec.ts` (run only, to confirm the skill still loads).

Note: `create_investigation` is a chat-agent TOOL (shipped in commit `1c3eccd`, `backend/src/modules/ai/tools/tool-definitions.ts`), called directly as a tool, not through REST or `execute_script`. The import itself still goes through `execute_script` POSTing to the trace endpoint with the script token.

**Step 1:** add to `graph-mutations.md` a section "## Fiat / off-chain flows" stating: if the case has no investigation, call the `create_investigation` tool first and use the returned `traceId` in the script; import bank wires through the same `/traces/{traceId}/import-transactions` endpoint with `chain: "fiat"`, account identifiers as `from`/`to` (exact case, e.g. `WESTLAND-TRUST-4417`), the wire reference as `txHash` (must be unique per wire), ISO `timestamp`, `amount` in cents as a string, `token: "USD"` (or the ISO code), `tokenMeta: { address: "", decimals: 2 }`, and always `fromLabel`/`toLabel` with the account holder and bank; plus one complete example item. Note that fiat nodes cannot be fetched or classified.

**Step 2:** in `investigator.ts`, extend the role description to cover fiat as well as on-chain flows, and add one line: for bank records, build the graph with `create_investigation` (if needed) and fiat imports per the graph-mutations skill. No em dashes.

**Step 3:** `export PATH=... && npx jest src/skills/skill-registry.spec.ts` passes.

**Step 4:** `git status`.
