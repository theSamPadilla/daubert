# Top Nav Refactor — Consolidated Quick-Add Input + Floating Tool Pill

**Status:** Ready to implement. Frontend-only; no backend, no schema, no migrations.

**Context:** Today's investigation top bar is a flat row of 6+ buttons (`Refresh`, `Undo`, `Redo`, `Export`+chevron, `+ Address`, `+ Transaction`) plus a title. Two issues:

1. **Visual density.** Every button has the same weight and color; the bar reads as a stripe of identical chips, not a hierarchy.
2. **Two doors for one job.** `+ Address` and `+ Transaction` both open the same `LinkInputModal` differing only in placeholder text and a fallback when input is ambiguous. The parser (`detectInputType`) already disambiguates address vs. tx from prefix/length, so the two-button split is cosmetic.

This plan collapses the bar into a single consolidated input + one `Export` button, moves history controls to a floating pill over the canvas, and skips the prefilled form for unambiguous address pastes.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `frontend/src/components/Header.tsx` | Modify | Strip refresh/undo/redo/+address/+tx; embed `QuickAddInput` and a single `Export` button |
| 2 | `frontend/src/components/CanvasToolPill.tsx` | Create | Floating top-left pill on the canvas with icon-only Refresh / Undo / Redo and shortcut tooltips |
| 3 | `frontend/src/components/QuickAddInput.tsx` | Create | Consolidated input — accepts addresses or tx URLs/hashes; auto-routes via parser |
| 4 | `frontend/src/components/ChainSelect.tsx` | Create | EVM-only chain dropdown with branded network icons from `@web3icons/react` |
| 5 | `frontend/src/components/ExportModal.tsx` | Create | PNG vs. PDF picker, replaces the inline split-button + chevron dropdown |
| 6 | `frontend/src/utils/addressParser.ts` | Modify | Add `inspectInput()` helper consolidating kind + family + chain inference into a single call |
| 7 | `frontend/src/app/cases/[caseId]/investigations/page.tsx` | Modify | Render `CanvasToolPill`; wire `QuickAddInput` submit to `setPanelMode({ type: 'createWallet', prefill })` for addresses and `setPanelMode({ type: 'createTransaction', prefill })` for txs — both reuse today's form path. Wire `ExportModal`. Delete now-dead `handleAddWallet` / `handleAddTransaction` / `panelMode.linkInput` branches |
| 8 | `frontend/src/components/LinkInputModal.tsx` | Delete | Fully replaced by `QuickAddInput` |
| 9 | `frontend/package.json` | Modify | Add `@web3icons/react` dependency |

### What changes (UX and DX)

**For the user (UX):**
- Top bar contains: title (left) → consolidated input + chain dropdown + Export (right) → UserMenu. No more six-chip stripe.
- Pasting an address (any form) opens the existing prefilled `WalletForm` — same form as today, just reached via the header input instead of a separate modal step. User glances over trace/label/chain/color/notes before committing.
- Pasting a transaction (any form) fetches details, then opens the existing prefilled `createTransaction` form — unchanged from today's behavior.
- Refresh / Undo / Redo become a floating icon-only pill in the top-left of the canvas, out of the way of primary controls but still one click away.
- Export becomes a single button → modal with two clear choices instead of a split-button with a hidden chevron.

**For the developer (DX):**
- One add-entity entry point (`QuickAddInput`) instead of two near-identical buttons + a shared modal.
- Parser gains a single source of truth: `inspectInput()` returns kind + family + chain in one call.
- `LinkInputModal` deleted (~180 lines). The 3-step "modal → form" flow becomes "input → form."
- Chain icons live in a library, not in-repo SVGs — adding a chain later is a one-line entry in `SUPPORTED_CHAINS` plus the matching `<Network*>` component.

---

## Engineering Decisions Made

Folded in after a review pass — not product-facing, but worth recording so the implementer doesn't re-litigate:

- **Tx fetch is `AbortController`-cancelable.** `QuickAddInput` keeps a ref to the in-flight controller and aborts on input change, unmount, or investigation change. Prevents a stale tx response from popping the form open over later state.
- **`QuickAddInput` resets on `investigation.id` change.** A `useEffect` keyed on `investigation?.id` clears `value`, `loading`, and `error`, and aborts any in-flight tx fetch.
- **Tx prefill uses the `primaryTransfer || detail` fallback verbatim** from `LinkInputModal.tsx:55-73` (token-transfer-first, native-tx fallback). Load-bearing detail; called out so it doesn't get dropped in translation.
- **Parser consolidation:** `inspectInput()` is the single front door; `parseAddressInput` / `parseTxInput` / `detectInputType` stay exported for any other current consumers but `QuickAddInput` only calls `inspectInput`.
- **Naming:** `family: 'evm'` covers ambiguous EVM-shaped input including bare tx hashes (which could be Tron). Acceptable because the dropdown is EVM-only by design; if Tron is needed, the user prefixes with the URL or uses raw `T…` for addresses.

---

## Decisions locked

| Decision | Choice | Rationale |
|---|---|---|
| Pill placement | Floating, top-left of canvas | Matches Figma/tldraw convention; zero added vertical chrome. |
| Address form step | **Kept** — prefilled `WalletForm` opens after parse | User picks trace, glances over label/chain/color/notes/tags before committing. Resolves trace-destination, empty-investigation, and "lost on creation fields" concerns in one move. |
| Transaction form step | **Kept** — prefilled `createTransaction` form opens after tx fetch | Unchanged from today's behavior. Symmetric with the address flow. |
| Chain disambiguation | Family from prefix; EVM-only icon dropdown next to input; locked when family/chain already known from input | Pre-selects chain in the form prefill (and supplies chain for tx fetches on raw hex). Form's own chain picker remains the final override. |
| Position-aware paths (double-click background, "Add Address Here" context menu) | Keep `WalletForm` directly — same form as the header path, just with position prefilled | One form across all entry points. |
| LinkInputModal | Delete | Every path it handled is covered by `QuickAddInput` + existing form. |
| Icon library | `@web3icons/react` (v4.x) | Maintained, tree-shakeable, covers Ethereum / Polygon / Arbitrum / Base / Tron with branded variants. |

---

## Component contracts

### `QuickAddInput`

```ts
interface QuickAddInputProps {
  onResolveAddress: (prefill: Partial<WalletNode>) => void;       // caller opens prefilled WalletForm
  onResolveTransaction: (prefill: Partial<TransactionEdge>) => void;  // caller opens prefilled TransactionForm
  disabled?: boolean;
}
```

Internal state: `value`, `chain` (EVM-only id, used for prefill chain when input is raw), `loading` (during tx fetch), `error`.

Submit flow on Enter:

1. `inspectInput(value)` → `{ kind, family, chain?, address?, txHash?, explorerUrl? }`.
2. **Address:**
   - Resolved chain = `inspected.chain ?? (family === 'tron' ? 'tron' : dropdownChain)`.
   - Call `onResolveAddress({ address, chain, label: truncate(address), explorerUrl })`. Caller opens `WalletForm` prefilled — same as today's `handleLinkResolved` address branch.
   - Clear input.
3. **Transaction:**
   - Resolved chain = `inspected.chain ?? dropdownChain`.
   - Set `loading=true`, call `apiClient.getTransaction(txHash, chain)` with an `AbortController`.
   - On success: build prefill (token-transfer-first, native-tx fallback), call `onResolveTransaction(prefill)`. Clear input.
   - On failure: surface error under input. Don't clear.
4. **Unknown:** inline error "Not a recognized address or transaction." Don't submit.

Chain dropdown gating (driven by `inspected.family` + `inspected.chain`):
- Family `'tron'` → dropdown shows Tron, disabled.
- `inspected.chain` set (URL-derived) → dropdown reflects that chain, disabled.
- Otherwise → active, EVM options only (Ethereum, Arbitrum, Base, Polygon). Default = Ethereum.

### `ChainSelect`

```ts
interface ChainSelectProps {
  value: string;                 // chain id
  options: string[];             // chain ids to render
  onChange: (chain: string) => void;
  disabled?: boolean;
}
```

Trigger: `<NetworkXxx variant="branded" size={16}/> Name ▾`. Menu rows: same layout. Map chain id → component via a local lookup table; fallback to a neutral bullet if missing.

### `CanvasToolPill`

```ts
interface CanvasToolPillProps {
  onRefresh: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onRedo: () => void;
  canRedo: boolean;
}
```

Pure visual relocation of the three Header buttons. Icon-only, tooltips carry shortcut hints (`⌘Z`, `⌘⇧Z`). Positioned `absolute top-3 left-3 z-20` over the canvas; rendered as a sibling to `<GraphCanvas>` inside the existing canvas wrapper.

### `ExportModal`

```ts
interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  onExport: (format: 'png' | 'pdf') => void;
}
```

Two large buttons (PNG / PDF) with brief one-liner under each. Closes on selection.

### `inspectInput` (in `addressParser.ts`)

Single helper that consolidates `detectInputType` + `parseAddressInput`/`parseTxInput` + the new family inference, so `QuickAddInput` calls one function instead of three with overlapping logic.

```ts
export interface InspectedInput {
  kind: 'address' | 'transaction' | 'unknown';
  family: 'evm' | 'tron' | 'unknown';  // determines whether the chain dropdown is active or locked
  chain?: string;                       // exact chain id when derivable (URL host or Tron prefix); undefined for ambiguous EVM
  address?: string;                     // populated when kind === 'address'
  txHash?: string;                      // populated when kind === 'transaction'
  explorerUrl?: string;                 // populated when input was a URL
}

export function inspectInput(input: string): InspectedInput;
```

Internally reuses the existing `parseAddressInput` / `parseTxInput` / `detectInputType` (they stay for back-compat with anything else in the tree); `inspectInput` is the new front door. Family is derived from `chain` when present, otherwise from prefix/shape. Bare 64-hex with no `0x` is labeled `family: 'evm'` (the dropdown is EVM-only anyway; users can override).

The dropdown's disabled state:
- `family === 'tron'` → locked to Tron, disabled.
- `chain` is set (URL-derived) → locked to that chain, disabled.
- Otherwise → active, EVM options only.

---

## Wiring in `page.tsx`

Both callbacks reuse the existing form path — the only change vs today is that the input source becomes `QuickAddInput` instead of `LinkInputModal`. Downstream (`handleSaveNewWallet`, `handleSaveNewTransaction`, the `createWallet` / `createTransaction` panel modes, the `getAddressInfo` enrichment) is unchanged.

```tsx
<Header
  investigation={investigation}
  onResolveAddress={(prefill) => setPanelMode({ type: 'createWallet', prefill })}
  onResolveTransaction={(prefill) => setPanelMode({ type: 'createTransaction', prefill })}
  onExportClick={() => setExportModalOpen(true)}
  rightContent={<UserMenu />}
/>
<div className="flex-1 bg-gray-900 relative overflow-hidden">
  <CanvasToolPill
    onRefresh={() => activeInvestigationId && loadInvestigationFromApi(activeInvestigationId)}
    onUndo={undo} canUndo={canUndo}
    onRedo={redo} canRedo={canRedo}
  />
  {/* ...rest unchanged */}
</div>
<ExportModal
  open={exportModalOpen}
  onClose={() => setExportModalOpen(false)}
  onExport={(format) => graphRef.current?.exportImage(format, investigation?.name || 'graph')}
/>
```

`handleCreateWalletAtPosition` (double-click background + "Add Address Here" context menu) gets repointed from `setPanelMode({ type: 'linkInput', ... })` to `setPanelMode({ type: 'createWallet', position })` directly — same `WalletForm`, no LinkInputModal step. Confirms the "one form everywhere" decision.

---

## Task breakdown (execution order)

1. **Add `@web3icons/react` + build `ChainSelect`.** Verify all five chain icons render. No app wiring yet.
2. **Add `inspectInput()` to `addressParser.ts`.** Pure function, easy to unit-check inline.
3. **Build `QuickAddInput`.** Self-contained, accepts the two callbacks. Includes `AbortController` for tx fetch and `useEffect` reset on `investigation.id`.
4. **Build `ExportModal` and `CanvasToolPill`.** Both are pure visual; trivial.
5. **Refactor `Header.tsx`.** Strip old buttons, embed `QuickAddInput` + Export trigger.
6. **Wire `page.tsx`.** Render `CanvasToolPill`; wire `onResolveAddress` / `onResolveTransaction` to `setPanelMode`; wire `ExportModal`. Repoint `handleCreateWalletAtPosition` to `createWallet` panel mode directly.
7. **Delete `LinkInputModal.tsx`** and remove dead paths (`panelMode.type === 'linkInput'`, `handleAddWallet`, `handleAddTransaction`) from `page.tsx`.
8. **Manual QA pass.** See checklist below.

---

## Manual QA checklist

- [ ] Paste raw EVM address with chain dropdown set to Ethereum → `WalletForm` opens prefilled (chain=Ethereum, label truncated). Confirm save lands on chosen trace.
- [ ] Switch chain dropdown to Arbitrum → paste raw address → `WalletForm` opens prefilled with `chain: 'arbitrum'`.
- [ ] Paste a Tron raw address (`T…`) → dropdown locks to Tron + disabled → `WalletForm` opens prefilled with `chain: 'tron'`.
- [ ] Paste an Etherscan `/address/0x…` URL → dropdown reflects Ethereum + disabled → `WalletForm` opens prefilled.
- [ ] Paste an Etherscan `/tx/0x…` URL → spinner in input → `TransactionForm` opens prefilled with from/to/amount/token.
- [ ] Paste a raw EVM tx hash with dropdown on Arbitrum → tx fetched against Arbitrum → form opens prefilled.
- [ ] Mid-fetch, edit the input → in-flight tx request aborts; no stale form opens.
- [ ] Switch investigation while input has text + chain selected → input clears, in-flight fetch aborts.
- [ ] Double-click empty canvas → `WalletForm` opens with position prefilled (no LinkInputModal step).
- [ ] Right-click empty canvas → "Add Address Here" → same as above.
- [ ] Paste garbage → inline error, no submit.
- [ ] Floating pill: Refresh re-fetches investigation; Undo/Redo respect `canUndo/canRedo`; tooltips show `⌘Z` / `⌘⇧Z`.
- [ ] Export button → modal opens → PNG exports image; PDF exports PDF; modal closes on selection.
- [ ] Keyboard: `⌘Z` / `⌘⇧Z` still work globally (regression check).
- [ ] No console errors. `LinkInputModal` import removed everywhere; `npm run build --prefix frontend` clean.

---

## Risks and non-goals

**Risks:**
- **Input width on narrow viewports.** Header has title (left) + input + chain dropdown + Export + UserMenu (right). At ~1100px and below this gets tight. Mitigation: set input `min-w-[260px]`, allow it to flex-shrink, hide dropdown label text below `md` (icon-only). Title can truncate.
- **Tx fetch latency in the header.** A 1–2s spinner sitting in the top bar is more visible than a spinner inside a modal. Acceptable, but worth noting if it feels janky. Cancelable per Engineering Decisions.

**Non-goals:**
- Restyling `WalletForm` / `TransactionForm` to feel more "brief" (deferred — separate density pass if needed).
- Last-used-chain memory in the dropdown (nice-to-have, not in scope).
- Pill shortcut customization (uses existing shortcuts unchanged).
- Any visual changes to the canvas itself or to the sidebars.
