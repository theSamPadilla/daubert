# Exhibits — Open Decisions

## Q1. Persistence model

Are Exhibits saved entities, or ad-hoc one-shot compilations?

- **A. Saved entity (recommended).** `exhibits` + `exhibit_items` tables. Users can revisit, refine, re-export. Matches legal workflow (exhibits get cited and iterated). Costs: new module, new list page, ~3 new endpoints, cascade behavior on source delete.
- **B. Ad-hoc only.** "Create Exhibit" button opens a builder, user picks items, downloads, gone. No persistence. Costs: nothing (lighter), but no iteration loop.

## Q2. Graph snapshot timing

How fresh is the graph image in a re-exported exhibit?

- **A. Snapshot at add-time, frozen until user re-snapshots (recommended).** Adding an investigation captures `cy.png()` and stores it. Re-export uses the stored bytes. Stale-by-design; explicit "Update snapshot" button refreshes. Pro: deterministic, fast re-exports, works without opening the investigation.
- **B. Capture on every export.** Builder loads each referenced investigation in a hidden Cytoscape instance at export time, captures fresh. Pro: never stale. Con: slow exports, all referenced investigations must still exist with valid data, complex error handling per-item.
- **C. Server-side graph rendering.** Run Cytoscape headlessly on the server. Pro: cleanest semantics. Con: large effort — Cytoscape isn't designed for headless server use; we'd need jsdom + canvas polyfills and probably a different layout engine.

## Q3. (Engineering — deciding myself unless flagged)

- **Snapshot storage**: Postgres `BYTEA` on `exhibit_items`. Graph PNGs are <500 KB typically. Object storage is premature.
- **PDF assembly**: single Puppeteer pass over composed HTML, not per-item PDFs merged with `pdf-lib`. Simpler, one binary path, page breaks via `page-break-before: always` CSS.
- **Title page**: each item gets a small banner header (Title + Subtitle) on the same page as the content, not a dedicated cover page. Saves pages, looks like standard exhibit formatting. Override with a config flag if needed later.
- **Reordering**: native HTML5 drag-and-drop, no `react-dnd`. Few items, simple list.
