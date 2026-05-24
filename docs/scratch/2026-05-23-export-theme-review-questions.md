# Plan review — open questions

Mechanical fixes the reviewer flagged are not listed here — I'll just apply them to the plan.

## Q1: How wide is "full theme parity"?

The plan covers PNG bg, edge label color, edge label pill bg, parent compound bg/border opacity. Reviewer flagged these styled tokens that the plan does **not** cover:

- `node[addressType="contract"]` dashed border (dark-bg tuned)
- `node[addressType="exchange"]` solid border (dark-bg tuned)
- Collapsed trace node `background-opacity: 0.6` with `data(color)` — may wash out on white
- Subgroup compound `background-opacity: 0.12` — may vanish on white
- Edge label pill `text-background-opacity: 0.85` — pill on white may look weird

(Interactive states — `.cy-sel` yellow ring, `node:active` overlay — don't apply to exports; can skip.)

**Decision needed:** cover all of the above (true full parity) vs ship a narrower v1.

## Q2: Chart snapshot loses user-set height

Today's chart export reads from the live on-page canvas, so a user who resizes the chart (via the drag handle, stored in `storedChartHeight`/`liveChartHeight`) gets that exact height in their export.

The plan switches chart export to `useChartSnapshot`, which mounts a hidden `<ChartViewer>` at fixed `1000×600`. A user who resized a chart to 1400×400 and exports will get a 1000×600 PNG.

**Decision needed:** accept the standardized export size (consistent across users, ignores in-app resize) vs thread the user's height through to the snapshot.

## Q3 (implied by Q1 — only relevant if Q1 → narrower scope)

If we ship narrower theme parity in v1, what's the user's tolerance for a light-mode export that has dark-bg-tuned addressType borders or near-invisible subgroup compound regions on white?
