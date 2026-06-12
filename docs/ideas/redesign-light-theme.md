# App Redesign: Light-First Theme (Option A)

## Context

The app (frontend/) is visually incoherent: a dark workspace (`#11162A`) with light-mode fragments hardcoded throughout (sidebar headers `#F7F8FB`, AI chat white buttons), no component library (74 components, ~6 button recipes, 2 input recipes), arbitrary font sizes (10/11/15/16px), mixed radii, scattered z-indexes, inline style objects with off-palette hex, and a literal `✕` text character as a close button.

The marketing site (`../website-daubert`) has a strong, coherent identity: light, legal/fintech, Inter + JetBrains Mono kickers (`01 · WORKSPACE`), brand blue `#1F3A93` → teal `#0EA5A3`, 12–16px radii, soft hover shadows, generous whitespace. Both repos already share the token vocabulary (`ink`, `line`, `brand`, `accent`) — the app is an inconsistent dark inversion of it.

## Product decisions (LOCKED — approved by Sam 2026-06-12)

1. **Option A: light-first theme matching the website.** The whole app adopts the website's light tokens. Only the graph canvas stays dark — the website's own interactive trace demo establishes "dark = the canvas" as a brand pattern, and Cytoscape graphs read better on dark.
2. The existing light-mode fragments (sidebar headers, AI chat) stop being bugs and become the system; `variant="light"` props are deleted because there is one theme.
3. Dark mode is **deferred, not designed out** — the token layer makes it a later value-swap. Do not build a theme toggle now.
4. This is a visual redesign only: **no behavior, routing, data-model, or API changes.** Same screens, same features, new skin + design system.

## Scope — 4 phases

### Phase 1 — Port the token system
- Copy the website's design tokens into the app's `globals.css` / `tailwind.config.js` (same names, light values): ink `#0B1220`/`#1F2937`/`#5B6473`/`#9AA3B2`, bg `#FFFFFF`/`#F7F8FB`/`#F1F4FA`, line `#E5E7EB`/`#CFD4DD`, brand `#1F3A93`/strong `#162B6D`/soft `#E8EDFB`, accent `#0EA5A3`, redline `#B91C1C`.
- Add the missing scales: type scale (11/12/13/15/17px + mono-kicker style), spacing (4/8/12/16/24), radii (8/12/16/999), z-index ladder (dropdown 20 / panel 30 / modal 50 / toast 60), one focus-ring style (`ring-2 ring-brand/40`).
- Dark-canvas tokens for graph-floating UI: `white/10` borders, `white/[0.06]` fills, light mono text — the seam treatment the website uses.
- Delete every hardcoded hex in components and every `variant="light"` prop.

### Phase 2 — Build `frontend/src/components/ui/` primitives
~10 in-house Tailwind components, no shadcn/Radix: `Button` (primary/secondary/ghost/danger), `Input`/`Select`/`Textarea`, `Modal`, `Panel`, `Badge`/`Chip`, `Kicker` (mono uppercase label), `EmptyState`, `Tooltip`. All consume tokens only.

### Phase 3 — Migrate by surface, highest-traffic first
1. **Workspace shell** (`CaseShell`, `InvestigationsSidebar`, graph header/toolbars) — light chrome, dark canvas; pills/overlays floating on the graph use the dark-canvas treatment.
2. **AI chat** (`AIChat`) — already accidentally light; align to tokens + website chat-bubble treatment.
3. **Home/cases** — website card language for case tiles (rounded-xl, 1px border, hover lift + soft shadow).
4. **Settings / org / account / login / invite pages.**
5. **Superadmin** last.
- Graph-floating panels (`SelectionDetailsPanel`, `ContextMenu`, `LabelEditPopover`, `FloatingPanel`, etc.) get the dark-canvas treatment; everything else goes light.

### Phase 4 — Signature details
- Mono kickers as section headers (`01 · INVESTIGATIONS`).
- Brand→accent gradient reserved for one hero moment per screen.
- Entity chips color-coded to the website's category palette (exchange blue `#2563EB`, mixer amber `#B45309`, bridge cyan, protocol violet, Tron red `#EF4444`).
- Hover-lift + soft shadow on cards; `redline` only for destructive actions; react-icons (fa6) everywhere, no emoji/text glyphs.

## Engineering decisions (pre-made)
- No shadcn/Radix — thin in-house primitives (~10 needed, app has zero Radix today).
- Tokens stay CSS variables consumed by Tailwind 3 config (no Tailwind v4 migration in this effort).
- Migration is screen-by-screen; tokens flip globally in Phase 1, so unmigrated screens become coherent-if-plain, not broken.
- Fonts unchanged: Inter + JetBrains Mono are already loaded in the app.

## Non-goals
- No dark-mode toggle, no Tailwind v4 upgrade, no new features, no backend changes, no contracts changes, no Cytoscape graph-style overhaul (node/edge styling inside the canvas may get minor palette alignment only).

## Acceptance
- `npm run build --prefix frontend` passes.
- Zero hardcoded hex colors in component classNames/styles outside the token files and the Cytoscape style layer.
- All screens render in the light theme with the dark graph canvas; no light-on-dark seam artifacts.
