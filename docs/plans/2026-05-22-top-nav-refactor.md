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
| 6 | `frontend/src/utils/addressParser.ts` | Modify | Add `detectChainFamily()` helper returning `'evm' \| 'tron' \| 'unknown'` |
| 7 | `frontend/src/app/cases/[caseId]/investigations/page.tsx` | Modify | Render `CanvasToolPill`; wire `QuickAddInput` submit to `addWallet` directly for addresses, to the existing prefilled `createTransaction` form for txs; wire `ExportModal` |
| 8 | `frontend/src/components/LinkInputModal.tsx` | Delete | Fully replaced by `QuickAddInput` |
| 9 | `frontend/package.json` | Modify | Add `@web3icons/react` dependency |

### What changes (UX and DX)

**For the user (UX):**
- Top bar contains: title (left) → consolidated input + chain dropdown + Export (right) → UserMenu. No more six-chip stripe.
- Pasting a known-chain address (Tron, or any explorer URL) drops a wallet node onto the active trace immediately with a truncated label — no form step. Faster for the common "I have a list of addresses to add" flow.
- Pasting a raw `0x…` EVM address uses whichever chain is selected in the dropdown next to the input.
- Pasting a transaction (any form) still opens the prefilled `createTransaction` form so the user can wire endpoints — transactions are inherently multi-entity and don't survive a "skip the form" treatment.
- Refresh / Undo / Redo become a floating icon-only pill in the top-left of the canvas, out of the way of primary controls but still one click away.
- Export becomes a single button → modal with two clear choices instead of a split-button with a hidden chevron.

**For the developer (DX):**
- One add-entity entry point (`QuickAddInput`) instead of two near-identical buttons + a shared modal.
- Parser gains a single source of truth for chain family: `detectChainFamily()`. The dropdown's disabled state is derived from this, not re-inferred per-callsite.
- `LinkInputModal` deleted (~180 lines).
- Chain icons live in a library, not in-repo SVGs — adding a chain later is a one-line entry in `SUPPORTED_CHAINS` plus the matching `<Network*>` component.

---

## Decisions locked

| Decision | Choice | Rationale |
|---|---|---|
| Pill placement | Floating, top-left of canvas | Matches Figma/tldraw convention; zero added vertical chrome. |
| Address form step | **Skipped** — drop directly onto canvas with default label | Address adds are high-volume and have no required follow-up fields. |
| Transaction form step | **Kept** — prefilled `createTransaction` form opens after tx fetch | Txs have two endpoints; "skip" would require an auto-create-missing-endpoint policy that's a real behavior change, not a UI move. Out of scope. |
| Chain disambiguation | Family from prefix; EVM-only icon dropdown next to input; locked when family/chain already known from input | Single visible control, predictable. No surprise modal. |
| LinkInputModal | Delete | Every path it handled is covered by `QuickAddInput`. |
| Icon library | `@web3icons/react` (v4.x) | Maintained, tree-shakeable, covers Ethereum / Polygon / Arbitrum / Base / Tron with branded variants. |

---

## Component contracts

### `QuickAddInput`

```ts
interface QuickAddInputProps {
  onAddAddress: (prefill: Partial<WalletNode>) => void;   // address path — caller adds directly
  onResolveTransaction: (prefill: Partial<TransactionEdge>) => void;  // tx path — caller opens prefilled form
  disabled?: boolean;
}
```

Internal state: `value`, `chain` (EVM-only id), `loading` (during tx fetch), `error`.

Submit flow on Enter:

1. `detectInputType(value)` → `'address' | 'transaction' | 'unknown'`.
2. **Address:**
   - `parseAddressInput(value)` → if `parsed.chain` present (Tron raw, or explorer URL), use it. Else use selected EVM `chain`.
   - Call `onAddAddress({ address, chain, label: truncate(address), explorerUrl })`.
   - Clear input.
3. **Transaction:**
   - `parseTxInput(value)` → resolve chain same way (URL > selected EVM dropdown).
   - Set `loading=true`, call `apiClient.getTransaction(hash, chain)`.
   - On success: build prefill (same shape as today's `LinkInputModal.handleSubmit`), call `onResolveTransaction(prefill)`. Clear input.
   - On failure: surface error under input. Don't clear.
4. **Unknown:** inline error "Not a recognized address or transaction." Don't submit.

Chain dropdown gating:
- `detectChainFamily(value)`:
  - `'tron'` → dropdown shows Tron, disabled.
  - `'evm'` or `'unknown'` → dropdown active, EVM chains only (Ethereum, Arbitrum, Base, Polygon).
- If `parseAddressInput`/`parseTxInput` extracted a chain from a URL → dropdown reflects that chain, disabled.

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

### `detectChainFamily` (in `addressParser.ts`)

```ts
export function detectChainFamily(input: string): 'evm' | 'tron' | 'unknown' {
  const trimmed = input.trim();
  if (!trimmed) return 'unknown';

  // URL → derive from host (use existing EXPLORER_PATTERNS); we already get exact chain elsewhere,
  // so for the family check, URL → 'evm' or 'tron' based on the matched chain.
  try {
    const url = new URL(trimmed);
    const match = EXPLORER_PATTERNS.find(p => url.hostname === p.host || url.hostname === `www.${p.host}`);
    if (match) return match.chain === 'tron' ? 'tron' : 'evm';
  } catch { /* not a URL */ }

  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return 'evm';
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return 'evm';
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return 'evm';   // bare tx hash, EVM-shaped
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) return 'tron';
  return 'unknown';
}
```

---

## Wiring in `page.tsx`

Replace today's `<Header ... onAddAddress={handleAddWallet} onAddTransaction={handleAddTransaction} ... />` with:

```tsx
<Header
  investigation={investigation}
  onAddAddress={(prefill) => {
    if (!activeTraceId) return; // need an active trace
    addWallet(activeTraceId, {
      ...prefill,
      position: defaultDropPosition(),
    });
  }}
  onResolveTransaction={(prefill) => {
    setPanelMode({ type: 'createTransaction', prefill });
  }}
  onExport={(format) => graphRef.current?.exportImage(format, investigation?.name || 'graph')}
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
```

`defaultDropPosition()` = canvas viewport center via `graphRef.current?.getViewportCenter()` (add if missing) or fall back to `{ x: 0, y: 0 }`.

---

## Task breakdown (execution order)

1. **Add `@web3icons/react` + build `ChainSelect`.** Verify all five chain icons render. No app wiring yet.
2. **Add `detectChainFamily()` to `addressParser.ts`.** Pure function, easy to unit-check inline.
3. **Build `QuickAddInput`.** Self-contained, accepts the two callbacks. Test in isolation by mounting it in a scratch route or storybook-style page if available — otherwise wire straight into Header in step 5 and test manually.
4. **Build `ExportModal` and `CanvasToolPill`.** Both are pure visual; trivial.
5. **Refactor `Header.tsx`.** Strip old buttons, embed `QuickAddInput` + Export trigger. Open `ExportModal` from a single button.
6. **Wire `page.tsx`.** Render `CanvasToolPill`; wire new Header callbacks; ensure `addWallet` receives a viewport-center position; add `getViewportCenter` on `GraphCanvas` if it doesn't exist.
7. **Delete `LinkInputModal.tsx`** and any imports. Remove now-dead code paths in `page.tsx` (`panelMode.type === 'linkInput'`, `handleAddWallet`, `handleAddTransaction`).
8. **Manual QA pass.** See checklist below.

---

## Manual QA checklist

- [ ] Paste raw EVM address with chain dropdown set to Ethereum → wallet node appears on canvas immediately, labeled `0x1234…abcd`, on active trace, at viewport center.
- [ ] Switch chain dropdown to Arbitrum → paste raw address → wallet appears with `chain: 'arbitrum'`.
- [ ] Paste a Tron raw address (`T…`) → dropdown locks to Tron + disabled → wallet appears with `chain: 'tron'`.
- [ ] Paste an Etherscan `/address/0x…` URL → dropdown reflects Ethereum + disabled → wallet appears.
- [ ] Paste an Etherscan `/tx/0x…` URL → spinner in input → `createTransaction` form opens prefilled.
- [ ] Paste a raw EVM tx hash with dropdown on Arbitrum → tx fetched against Arbitrum → form opens prefilled.
- [ ] Paste garbage → inline error, no submit.
- [ ] Floating pill: Refresh re-fetches investigation; Undo/Redo respect `canUndo/canRedo`; tooltips show `⌘Z` / `⌘⇧Z`.
- [ ] Export button → modal opens → PNG exports image; PDF exports PDF; modal closes on selection.
- [ ] Keyboard: `⌘Z` / `⌘⇧Z` still work globally (regression check).
- [ ] No console errors. `LinkInputModal` import removed everywhere; `npm run build --prefix frontend` clean.

---

## Risks and non-goals

**Risks:**
- **Input width on narrow viewports.** Header has title (left) + input + chain dropdown + Export + UserMenu (right). At ~1100px and below this gets tight. Mitigation: set input `min-w-[260px]`, allow it to flex-shrink, hide dropdown label text below `md` (icon-only). Title can truncate.
- **Active trace assumption.** Skipping the form for addresses requires knowing which trace to add to. If `activeTraceId` is null (e.g., no traces yet), the input should be disabled with a tooltip ("Create a trace first"). Verify the empty-investigation state.
- **Tx fetch latency in the header.** A 1–2s spinner sitting in the top bar is more visible than a spinner inside a modal. Acceptable, but worth noting if it feels janky.

**Non-goals:**
- Auto-creating missing tx endpoints (would let us skip the tx form too — deferred, real behavior change).
- Last-used-chain memory in the dropdown (nice-to-have, not in scope).
- Pill shortcut customization (uses existing shortcuts unchanged).
- Any visual changes to the canvas itself or to the sidebars.
