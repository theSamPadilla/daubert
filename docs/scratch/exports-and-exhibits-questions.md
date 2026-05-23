# Open product questions from plan review

## Q1. DOCX fidelity for reports with citations

`html-to-docx` won't preserve TipTap citation styling — citations will appear as inline `[N]` rather than superscript with the works-cited block below it. Tables also lose explicit column widths.

- **A. Accept degraded DOCX.** Ship as-is; mark format as "best-effort, edit in Word as needed."
- **B. Block DOCX when report contains `<span class="citation">`.** Show PDF as the only option for citation-bearing reports.

## Q2. Investigation snapshot view in exhibits

When snapshotting an investigation graph, should the captured image reflect the user's current visibility/collapsed state, or always force a "full view" (expand all traces, show all nodes)?

- **A. Respect current state.** Whatever traces are visible and however groups are collapsed at add-time stays that way. Simpler.
- **B. Force full expansion.** Snapshot a deterministic "everything visible" view regardless of UI state.

## Q3. Oversize graphs

If a graph is wider/taller than the 1400×900 hidden container, `cy.png({ full: true })` returns the full bounding box anyway (Cytoscape doesn't constrain to container). The PDF page is A4 portrait. Options:

- **A. Scale-to-fit on the PDF page** — letterbox a tall graph into the page, will look small but complete.
- **B. Render landscape A4 for graph items only** — same approach as the standalone graph PDF.
- **C. Don't worry about it** — graphs that exceed the page just get cropped or rendered tiny; user can re-layout the source investigation.

## Q4. Charts in exhibits — capture timing

Charts (Chart.js) render only when the production is mounted. If the user adds a chart production to an exhibit but never visits that production's page in this session, there's no canvas to `toDataURL`.

- **A. Mount the chart off-screen at export time** (mirror the graph snapshot approach).
- **B. Refuse chart items added to the exhibit unless the user opened that chart at least once this session** (cache the data URL on first view).
- **C. Re-render charts server-side at export time** (would require porting Chart.js config to server — large effort).

---

Surface Q1 first — it gates Task 4b implementation.
