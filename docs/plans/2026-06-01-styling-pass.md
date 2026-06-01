# Styling Pass Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tighten the app's visual hierarchy so it stops looking generic — by aligning design tokens with the marketing site at `../website-daubert`, adding the missing background utilities, and polishing the landing page + a handful of high-leverage components. This is a **surgical pass**, not a redesign.

**Architecture:** Token-level edits in `globals.css` propagate everywhere for free. Two new background utilities (`.bg-hero-dark`, `.bg-grid-dark`) mirror the marketing site's `.bg-hero` and `.bg-grid` for dark mode. The cases dashboard (`/`) gets the biggest single-page treatment — kicker + sub-headline + branded hero + lifted cards — because that's the "ugly" complaint. The rest is component-level polish that affects everything (Loader, modals, card borders) without touching layout or logic.

**Tech Stack:** Tailwind CSS 3 (existing config), Next.js 14 App Router, dark-mode CSS variables. No new dependencies.

**Reference:** `../website-daubert/src/app/globals.css` and `src/components/Hero.tsx` / `Product.tsx` / `Nav.tsx` for the visual North Star. The two repos share token vocabulary (`ink`, `surface`, `line`, `brand`, `accent`) — that's the lucky starting point.

**Out of scope:**
- Light-mode switch (workspace tools justify dark UI).
- Wholesale component-library swap (shadcn/ui, etc.).
- Sidebar redesign (density is intentional for a workspace).
- Logic / functionality changes.

---

## Atomized Changes

| # | File | Action | Purpose |
|---|---|---|---|
| 1 | `frontend/src/app/globals.css` | Modify | Token tweaks (`--brand`, `--accent`, `--surface-panel`, `--line-strong`) + add `.bg-hero-dark` and `.bg-grid-dark` utilities |
| 2 | `frontend/src/app/page.tsx` | Modify | Kicker + sub-headline + `.bg-hero-dark` outer container + brighter / larger watermark; empty-state polish for guests |
| 3 | `frontend/src/app/page.tsx` | Modify | Case card hover/lift treatment (border `/50`, hover ring `brand/40`, `translate-y-[-1px]`) |
| 4 | `frontend/src/app/page.tsx` | Modify | "+ New case" tile brand-tinted + add "Start a new investigation" subtitle |
| 5 | `frontend/src/components/Common/Loader.tsx` | Modify | Dot color from `bg-ink-muted` → `bg-brand` |
| 6 | `frontend/src/components/Workspace/NewPrimaryModal.tsx` | Modify | Normalize field labels: drop `uppercase tracking-wider` (keep on modal header). Match the existing `NewCaseModal` field-label pattern. |
| 7 | `frontend/src/components/Workspace/CaseShell.tsx` | Modify | Add `.bg-grid-dark` to the center workspace surface so the workspace gains identity |

**Dropped from earlier draft (no-ops after audit):**
- ~~Settings page label normalization~~ — settings page has zero `uppercase tracking-wider` hits today; labels are already `text-sm text-ink-muted`.
- ~~NewCaseModal summary border softening~~ — `ResultRow` rows are bare (no border wrappers). The only `border-line-strong` in the summary path is on the clipboard-fallback input, which should stay sharp for usability.

### What changes (UX / DX)

**For the user (UX):**
- The landing page stops feeling like a Tailwind starter. It now reads "expert tool" instead of "consumer SaaS".
- Cards on `/` are alive — they lift slightly on hover, their borders breathe, the "+" tile invites action.
- Loader is branded; the breathing logo + brand-colored dots feel owned, not generic.
- Modals across the app share one quieter label style; forms feel less shouty.
- Workspace has a subtle grid backdrop so the dark canvas isn't void.

**For the developer (DX):**
- Tokens shift only in `globals.css`. Every existing class that references them (`bg-surface-panel`, `text-brand`, etc.) updates for free.
- Two new utilities (`.bg-hero-dark`, `.bg-grid-dark`) named symmetrically with the marketing site so future cross-repo work uses the same vocabulary.
- No new dependencies, no new components, no refactors.

---

## Engineering decisions logged (not flagged)

- **Token shifts are subtle on purpose.** `#4F6FD8` → `#5468C6` is a small visual difference but a big *positioning* one. Larger jumps (e.g., to the marketing site's `#1F3A93` directly) would lose dark-mode contrast.
- **`/60` opacity on borders, not full `/40`.** Softer than today but still usable for hit-testing in dense surfaces.
- **`.bg-hero-dark` only applied on the landing page**, not the workspace pages. Workspace gets `.bg-grid-dark` instead — different visual languages: hero for landing, grid for workspace.
- **No broad sweep of `border-line-strong` → `border-line-strong/60`.** 56 files use that token; touching them all is high-risk visual churn and we'd lose contrast on workspace tools where it matters. We only soften borders on the cards and surfaces we explicitly touch.
- **Label normalization scope is narrow.** 19 files contain `uppercase tracking-wider`, but many are intentional (admin role badges, kickers, section headers). We only touch FIELD LABELS in forms (the modals + settings field labels). Kickers and badges stay uppercase.

---

## Verification strategy

Styling changes have no unit tests. Each task verifies via:

1. **Type check / build:** `npm run build --prefix frontend` is the gating check; it catches any class name typos that produce no-op classes (Tailwind silently ignores unknown classes, but the build catches `className` syntax errors).
2. **Manual visual check:** start the dev stack (`npm run db && npm run be && npm run fe`) and inspect the affected route in a browser.
3. **Token diff sanity:** for Task 1, eyeball that the four tokens changed are the four listed, no others touched.

There's no test suite to add or update. The opus final review at the end will eyeball each diff for taste / accidental regressions.

---

## Phase 1 — Tokens (foundation)

### Task 1: Token tweaks + new background utilities

**File:** `frontend/src/app/globals.css`

**Step 1: Update the four tokens**

Inside `@layer base { :root { ... } }`, change:

- `--brand: #4F6FD8;` → `--brand: #5468C6;`
- `--accent: #2DD4D2;` → `--accent: #1FB5B0;`
- `--surface-panel: #18213A;` → `--surface-panel: #141C30;`
- `--line-strong: #3A4866;` → `--line-strong: #324363;`

Leave every other variable untouched.

**Step 2: Add background utilities**

Append (after the existing `@keyframes` blocks):

```css
@layer utilities {
  .bg-hero-dark {
    background:
      radial-gradient(900px 500px at 80% -10%, rgba(84, 104, 198, 0.18), transparent 60%),
      radial-gradient(700px 400px at 0% 10%, rgba(31, 181, 176, 0.10), transparent 60%);
  }

  .bg-grid-dark {
    background-image:
      linear-gradient(to right, rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 56px 56px;
  }
}
```

Note: `@layer utilities` is the right place because we want these to compose with other utilities (`hover:`, `md:`, etc.) just like first-party Tailwind classes.

**Step 3: Build**

```bash
npm run build --prefix frontend
```

Expected: green. Custom utilities declared via `@layer utilities` are emitted unconditionally into the CSS bundle — no JIT scanning is required for them. (JIT only applies to theme-derived utilities.) The CSS variable changes propagate to every existing `bg-surface-panel`, `text-brand`, etc.

**Step 4: Visual sanity**

Start dev (`npm run fe`) and load `/`. Cards should look subtly darker (lower `--surface-panel`). Brand-colored text (sign-in button, role badges if any) should look slightly deeper. The shift should be felt, not obvious.

**Leave changes in working tree.**

---

## Phase 2 — Landing page (`/`)

### Task 2: Hero treatment + kicker + sub-headline + watermark bump

**File:** `frontend/src/app/page.tsx`

**Step 1: Apply `.bg-hero-dark` to the outer container**

Find the outer `<div className="relative min-h-screen bg-surface text-white overflow-hidden">` and ADD `bg-hero-dark` to the class list:

```tsx
<div className="relative min-h-screen bg-surface bg-hero-dark text-white overflow-hidden">
```

**Layering note.** `.bg-hero-dark` sets `background: radial-gradient(...), radial-gradient(...)` — Tailwind's `background` shorthand for the utility overrides the `background-color` set by `bg-surface` on the same element. The dark surface still shows because the gradients fade to `transparent` and the body's `bg-surface` bleeds through behind them. This works in practice, but if a future ancestor adds an opaque background, the hero will look orphaned. Keep `bg-surface` on the element for documentation purposes (and for any future re-layering) even though it's effectively shadowed here.

Then DELETE the inline radial-gradient `<div className="pointer-events-none absolute inset-0 -z-10" style={{ background: '...' }} />` — the new utility replaces it.

**Step 2: Watermark logo treatment**

Find:

```tsx
<div className="pointer-events-none absolute -right-24 top-24 -z-10 opacity-[0.035] select-none">
  <Image src="/logo-light.png" alt="" width={520} height={520} priority />
</div>
```

Change to:

```tsx
<div className="pointer-events-none absolute -right-32 top-16 -z-10 opacity-[0.06] select-none">
  <Image src="/logo-light.png" alt="" width={720} height={720} priority />
</div>
```

Bigger + more opaque so it actually anchors the eye.

**Step 3: Header treatment**

Find the existing `<h2 className="text-xl font-semibold mb-6">Your Cases</h2>` and REPLACE the entire heading block with:

```tsx
<div className="mb-8">
  <span className="text-xs font-semibold uppercase tracking-widest text-brand">
    Workspace
  </span>
  <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
    Your cases
  </h2>
  {!loading && (
    <p className="mt-2 text-sm text-ink-muted">
      {cases.length === 0
        ? canCreate
          ? 'Start a new investigation.'
          : 'No cases assigned yet.'
        : `${cases.length} active ${cases.length === 1 ? 'investigation' : 'investigations'}`}
    </p>
  )}
</div>
```

This mirrors the marketing site's `kicker + h2 + lead` pattern from `Product.tsx`.

**Step 4: Empty-state branch tweak**

The existing empty-state branch (`cases.length === 0 && !canCreate`) renders "No cases assigned to your account yet. Contact your administrator…". Keep it, but soften: change the wrapper `text-center py-20` to `text-center py-24 max-w-md mx-auto` so it doesn't feel like a billboard, and replace the two `<p>` lines with:

```tsx
<p className="text-base text-ink-muted">No cases assigned to your account yet.</p>
<p className="text-sm text-ink-faint mt-2">Contact your administrator to get access.</p>
```

(Drops "to a case" because it's redundant after "cases".)

**Step 5: Build + visual check**

```bash
npm run build --prefix frontend
```

Then load `/` in dev. Expected:
- The radial-glow hero treatment is anchored to the top-right (blue glow at `80% -10%`) and to the left edge (teal glow at `0% 10%`) — these positions mirror the marketing site's `Hero.tsx`, NOT the old inline positions.
- The watermark is visible but still ghostly.
- The heading reads "Workspace" (uppercase brand) → "Your cases" → count line.

**Leave changes in working tree.**

---

### Task 3: Case card hover/lift treatment

**File:** `frontend/src/app/page.tsx`

**Step 1: Update the case card classes**

Find the case card inner `<button>` (renders for each `c in cases`). Current classes:

```tsx
className="w-full text-left p-4 bg-surface-panel border border-line-strong rounded-lg hover:border-gray-500 hover:bg-surface-raised/80 transition-colors"
```

Replace with:

```tsx
className="w-full text-left p-5 bg-surface-panel border border-line-strong/50 rounded-lg hover:border-brand/40 hover:bg-surface-raised/60 hover:-translate-y-px hover:shadow-lg hover:shadow-brand/5 transition-all duration-150"
```

Changes:
- `p-4` → `p-5` (more breathing room).
- `border-line-strong` → `border-line-strong/50` (softer).
- `hover:border-gray-500` → `hover:border-brand/40` (brand-tinted hover ring).
- `hover:bg-surface-raised/80` → `hover:bg-surface-raised/60` (lighter fill on hover so the border ring is the primary signal).
- `transition-colors` → `transition-all duration-150` (so transform animates too).
- Added `hover:-translate-y-px hover:shadow-lg hover:shadow-brand/5` for the subtle lift.

**Step 2: Build + visual check**

```bash
npm run build --prefix frontend
```

Load `/`. Hover each card — it should lift 1px with a brand-tinted shadow + border. Movement is subtle, not bouncy.

**Leave changes in working tree.**

---

### Task 4: "+ New case" tile — brand-tinted + subtitle

**File:** `frontend/src/app/page.tsx`

**Step 1: Update the "+" tile**

Find the `{canCreate && (<button ...>` block at the end of the grid. Current:

```tsx
<button
  onClick={() => setNewCaseOpen(true)}
  className="flex flex-col items-center justify-center gap-2 p-4 h-full min-h-[100px] bg-surface-panel border border-dashed border-line-strong rounded-lg hover:border-gray-500 hover:bg-surface-raised/80 transition-colors text-ink-muted hover:text-ink"
>
  <FaPlus size={22} />
  <span className="text-sm">New case</span>
</button>
```

Replace with:

```tsx
<button
  onClick={() => setNewCaseOpen(true)}
  className="flex flex-col items-center justify-center gap-1.5 p-5 h-full min-h-[100px] bg-surface-panel/60 border border-dashed border-brand/25 rounded-lg hover:border-brand/60 hover:bg-brand/5 transition-colors text-ink-muted hover:text-brand"
>
  <FaPlus size={22} />
  <span className="text-sm font-medium">New case</span>
  <span className="text-xs text-ink-faint">Start a new investigation</span>
</button>
```

Changes:
- `bg-surface-panel` → `bg-surface-panel/60` (lighter base so the dashed border reads).
- `border-line-strong` → `border-brand/25` (brand-tinted at rest).
- `hover:border-gray-500` → `hover:border-brand/60` (deeper on hover).
- `hover:bg-surface-raised/80` → `hover:bg-brand/5` (brand-tinted hover fill).
- `hover:text-ink` → `hover:text-brand` (text color shifts to brand).
- Added subtitle: `<span className="text-xs text-ink-faint">Start a new investigation</span>`.
- `gap-2` → `gap-1.5` — the tile now has three flex children (icon, label, subtitle); the tighter gap keeps the stack compact across all three.
- Added `font-medium` to the label so the subtitle reads as secondary.

**Step 2: Build + visual check**

```bash
npm run build --prefix frontend
```

Load `/`. The "+" tile should now invite clicks: dashed brand-tinted border, hover fills with a faint brand wash, text shifts to brand color, and the subtitle reads as a small affordance.

**Leave changes in working tree.**

---

## Phase 3 — Component polish

### Task 5: Loader — brand-color the dots

**File:** `frontend/src/components/Common/Loader.tsx`

**Step 1: Update the three dot spans**

Find:

```tsx
<span className="h-1.5 w-1.5 rounded-full bg-ink-muted animate-[dotFade_1.4s_ease-in-out_infinite]" />
```

(repeated three times, with `[animation-delay:200ms]` and `[animation-delay:400ms]` on the second and third).

Change `bg-ink-muted` to `bg-brand` on all three.

Leave the breathing logo and everything else untouched.

**Step 2: Build + visual check**

```bash
npm run build --prefix frontend
```

Load any page during initial fetch (or navigate quickly between routes) to see the Loader. The three dots beneath the breathing logo should now be brand-colored, not gray.

**Leave changes in working tree.**

---

### Task 6: `NewPrimaryModal` — label normalization

**File:** `frontend/src/components/Workspace/NewPrimaryModal.tsx`

**Step 1: Read the file**

Identify field labels. Today they are `className="text-xs font-medium text-ink-muted uppercase tracking-wider"` (around lines 86 and 103 — confirm with a grep on the file).

**Step 2: Replace label classes**

Match the existing `NewCaseModal.tsx` field-label pattern (lines ~245, ~262, ~273 use this style):

```tsx
className="text-sm text-ink-muted mb-1.5"
```

For each field-label line in `NewPrimaryModal`, replace the full `text-xs font-medium text-ink-muted uppercase tracking-wider` class string with the line above. Note that we INTENTIONALLY drop `font-medium` — the new style is plainer and reads less form-y next to the input.

Keep the tab headers (the "Investigation" / "Production" buttons at the top) untouched — those are headers, not field labels.

If the modal has a title bar that uses `uppercase tracking-wider`, leave it alone — headers stay shouty by convention.

**Step 3: Build + visual check**

```bash
npm run build --prefix frontend
```

Open a case workspace, click "+ Investigation" or whatever opens the modal. The form field labels should read as plain `text-sm text-ink-muted` — quiet, not shouty.

**Leave changes in working tree.**

---

### Task 7: Workspace `CaseShell` — `.bg-grid-dark` backdrop

**File:** `frontend/src/components/Workspace/CaseShell.tsx`

**Step 1: Identify the center surface**

The shell renders a 3-pane layout: sidebar (left), center children, AI chat (right). The center panel is `<div className="flex-1 flex flex-col overflow-hidden relative">` (around line 91). Currently it has no background — the parent's `bg-surface` shows through.

**Step 2: Apply `.bg-grid-dark`**

Add `bg-grid-dark` to the center-pane container. `.bg-grid-dark` uses `background-image` (not `background-color`), so it composes cleanly with the parent's `bg-surface` — no shorthand collision.

Do NOT add it to the sidebar or chat panel — only the center workspace area.

**Caveat — child-page bleed.** The child pages rendered into `{children}` (Cytoscape canvas in `/investigations`, the data-room file viewer in `/data-room`, the productions editor in `/productions`) may have their own `bg-surface` or `bg-surface-panel` backgrounds covering the full pane. In those cases the grid is only visible in any unfilled margins around the child. That's acceptable — the grid's job is to ground the empty workspace state and any pages that don't cover full-bleed. It's NOT meant to peek through Cytoscape's canvas.

**Step 3: Build + visual check**

```bash
npm run build --prefix frontend
```

Navigate to a case workspace. Visit `/cases/<id>/investigations` — the Cytoscape canvas covers the pane; grid is invisible (expected). Visit `/cases/<id>/data-room` and `/cases/<id>/productions` — grid is visible in the side margins between the content and the panes' edges, depending on the page's own background coverage. The grid is meant to be barely-visible — if you can clearly see it, increase the gridline opacity in `globals.css` (currently `0.025`).

**Leave changes in working tree.**

---

## Phase 4 — Verification

### Task 8: Full build + manual walkthrough

**Files:** none.

**Step 1: Final builds**

```bash
npm run build --prefix backend
npm run build --prefix frontend
```

Both green.

**Step 2: Manual walkthrough**

Start the stack (`npm run db && npm run be && npm run fe`). Sign in. Walk through:

1. `/` (cases dashboard):
   - Subtle hero gradient visible in the top-right.
   - Larger watermark on the right.
   - Header reads "Workspace / Your cases / N active investigations".
   - Cards lift on hover with brand-tinted border ring.
   - "+ New case" tile reads brand-tinted, with the subtitle.

2. Sign out, sign in as a different role to verify guest empty state still works.

3. Open a case workspace:
   - Center pane has the grid backdrop.
   - Sidebar + chat unchanged.

4. Click "+" → modal:
   - Field labels are already quiet (no change in this plan — `NewCaseModal` was normalized in an earlier plan).
   - Submit with one existing email + one invented email; summary still renders correctly.

5. Open a different modal — `NewPrimaryModal` (the "+ Investigation" or "+ Production" trigger inside the case workspace):
   - Field labels now read `text-sm text-ink-muted` instead of shouty uppercase.

6. Trigger the Loader (a hard refresh or slow network throttle):
   - Three dots beneath the breathing logo are brand-colored.

**Step 3: Report**

If anything visually misbehaves (e.g., contrast issue, broken layout), file a follow-up. Do NOT patch inline during verification.

**Leave changes in working tree. Do not commit.**

---

## Open follow-ups (out of scope)

- Add `bg-grid-dark` selectively to other workspace surfaces if the center-pane treatment lands well.
- Modal style audit across `ErrorModal`, `ConfirmDeleteModal`, `ExportModal` — header / footer consistency.
- Sidebar visual rhythm (item spacing, divider treatment) — needs UX work, not just styling.
- Case-grid empty state with branded illustration (would need a custom SVG asset).
- Sticky / blur-backdrop nav matching the marketing site's `Nav.tsx` pattern. Currently the app's `/` header is solid; adding `sticky top-0 z-40 bg-surface/80 backdrop-blur-md` would tie the app and the site visually.
- Standardize button radius from `rounded` → `rounded-md` for primary actions. Trivial find-replace, no risk, but high churn — defer to a dedicated PR.
