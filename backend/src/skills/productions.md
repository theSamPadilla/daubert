---
name: productions
description: How to create reports (HTML), charts (Chart.js), and chronologies for case investigations
---

# Productions

Productions are deliverables attached to a case. Use the `create_production`, `read_production`, and `update_production` tools to manage them. Three types are supported.

## Reports

Reports store HTML content rendered in a TipTap WYSIWYG editor.

### Data format

```json
{
  "name": "Flow of Funds Summary",
  "type": "report",
  "data": {
    "content": "<h2>Executive Summary</h2><p>Analysis of fund movements...</p>"
  }
}
```

### Supported HTML elements

The TipTap editor renders these elements:
- Headings: `<h1>` through `<h4>`
- Paragraphs: `<p>`
- Inline formatting: `<strong>`, `<em>`, `<code>`
- Lists: `<ul>`, `<ol>`, `<li>`
- Tables: `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`
- Blockquotes: `<blockquote>`
- Horizontal rules: `<hr>`
- Links: `<a href="...">`

### Best practices

- Structure with clear headings (`<h2>` for sections, `<h3>` for subsections).
- Use tables for transaction summaries and address lists.
- Bold key figures and addresses with `<strong>`.
- Include specific addresses and transaction hashes — don't be vague.
- Keep reports focused on findings, not process.

## Charts

Charts store Chart.js-compatible data. The frontend renders them with react-chartjs-2.

### Data format

```json
{
  "name": "Monthly Transaction Volume",
  "type": "chart",
  "data": {
    "chartType": "bar",
    "labels": ["Jan", "Feb", "Mar", "Apr"],
    "datasets": [
      {
        "label": "ETH Volume",
        "data": [12.5, 8.3, 15.1, 22.7],
      }
    ],
    "options": {}
  }
}
```

### Supported chart types

| Type | Use case |
|------|----------|
| `bar` | Comparing quantities across categories (volume by month, balance by wallet) |
| `line` | Trends over time (daily transaction counts, cumulative flow) |
| `pie` | Proportional breakdown (fund distribution, token allocation) |
| `doughnut` | Same as pie with a hollow center |

### Dataset fields

| Field | Required | Description |
|-------|----------|-------------|
| `label` | yes | Legend label for this dataset |
| `data` | yes | Array of numeric values (one per label) |
| `borderWidth` | no | Line/border width in pixels |

### Chart height

Charts render at 384px tall by default. Set `data.height` (200–1200) on the production to give the chart more vertical room when it needs it — many series, dense annotations, or crowded axis labels. The user can also drag a handle below the chart to override this; either way, the value persists on the production. Use the `chart_set_height` op rather than rewriting the full `data` block.

### Annotations (reference lines, highlights, markers)

The frontend registers `chartjs-plugin-annotation`, so you can attach annotations to any cartesian chart (`bar` or `line`) via `options.plugins.annotation.annotations`. Each entry is keyed by an arbitrary id.

Supported annotation `type`s:

| Type | Use case |
|------|----------|
| `line` | Horizontal threshold (constant `yMin`/`yMax`) or vertical event marker (constant `xMin`/`xMax`) |
| `box` | Highlight a rectangular region (e.g. a time window of interest) |
| `label` | Free-floating text label anchored to data coordinates |
| `point` | Emphasise a single data point |
| `ellipse` | Highlight a circular/elliptical region |

#### Example: horizontal threshold + vertical event + highlighted window

```json
{
  "chartType": "line",
  "labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
  "datasets": [{ "label": "NFTs held", "data": [40, 70, 120, 180, 220, 260] }],
  "options": {
    "plugins": {
      "annotation": {
        "annotations": {
          "threshold": {
            "type": "line",
            "yMin": 100, "yMax": 100,
            "borderColor": "rgba(239, 68, 68, 0.8)",
            "borderWidth": 2,
            "borderDash": [6, 4],
            "label": { "display": true, "content": "100 NFT threshold", "position": "end", "color": "#fca5a5" }
          },
          "airdropEvent": {
            "type": "line",
            "xMin": "Mar", "xMax": "Mar",
            "borderColor": "rgba(168, 85, 247, 0.8)",
            "borderWidth": 2,
            "label": { "display": true, "content": "Airdrop", "position": "start", "color": "#d8b4fe" }
          },
          "accumulationWindow": {
            "type": "box",
            "xMin": "Feb", "xMax": "Apr",
            "backgroundColor": "rgba(59, 130, 246, 0.08)",
            "borderColor": "rgba(59, 130, 246, 0.3)"
          }
        }
      }
    }
  }
}
```

For category-axis charts (the default), `xMin`/`xMax` must be **exact label strings** (e.g. `"Mar"`), not indices. For time/linear axes, use the raw value.

### Best practices

- Use descriptive labels that make sense without context.
- Series colors are assigned automatically by the renderer.
- Prefer `bar` for comparisons, `line` for time series.
- Keep label count reasonable (under 20) — too many labels crowd the axis.
- The chart renders at a fixed height of 384px (h-96), so design for a landscape aspect ratio.
- The `options` field accepts any Chart.js options object — use it for axis labels, custom scales, legend positioning, or annotations.
- Annotations are great for: regulatory thresholds, event timelines (airdrops, hacks, regime changes), and zone highlighting. Keep them sparse — too many turn the chart into noise.

## Chronologies

Chronologies store ordered entries rendered as a table. The column set is mutable — the default four columns (Source, Date, Description, Details) are a starting point, not a fixed schema.

### Data format

```json
{
  "name": "Transaction Timeline",
  "type": "chronology",
  "data": {
    "columns": [
      { "key": "source",      "label": "Source",      "width": 18, "kind": "link" },
      { "key": "date",        "label": "Date",        "width": 14, "kind": "text" },
      { "key": "description", "label": "Description", "width": 40, "kind": "text" },
      { "key": "details",     "label": "Details",     "width": 28, "kind": "text" }
    ],
    "entries": [
      {
        "source": { "url": "https://etherscan.io/tx/0x6ae5fc12abcd...", "label": "0x6ae5…" },
        "date": "2025-01-15",
        "description": "Initial deposit of 50 ETH from Coinbase",
        "details": "Block 19500000. Withdrawal from verified Coinbase hot wallet."
      },
      {
        "source": { "url": "https://etherscan.io/tx/0x14b5ef89cdef...", "label": "0x14b5…" },
        "date": "2025-01-16",
        "description": "Transfer of 25 ETH to mixer contract",
        "details": "Tornado Cash 10 ETH pool, 2.5 deposits over 3 hours.",
        "highlight": "red"
      }
    ]
  }
}
```

`columns` is optional — omit it and the renderer uses the four defaults above.

### Entry fields

| Field | Required | Description |
|-------|----------|-------------|
| `source` | no | `{ url: string, label?: string } \| null`. Link shown in the Source column. If `label` is omitted, one is auto-derived from the URL (last 0x-hash, first 6 chars). |
| `date` | yes | Date string displayed in the Date column (e.g. `"2025-01-15"` or `"Jan 15, 2025"`) |
| `description` | yes | What happened — concise summary |
| `details` | no | Additional context (block number, amounts, counterparty info) |
| `[customKey]` | no | Value for any custom column added via `chronology_add_column`. Keys are arbitrary strings matching the column `key`. Values are plain strings. |
| `highlight` | no | Row background color — one of `"yellow"`, `"gray"`, `"red"`, `"green"`, `"blue"`. Omit for no highlight. Renders in both the in-app table and the PDF/HTML export. Suggested semantics: `red` = suspicious/alert, `gray` = needs review, `yellow` = note, `green` = verified/cleared, `blue` = informational. |
| `sourceTraceId` | no | Internal cross-reference to a trace (for app linking, not display) |
| `sourceEdgeId` | no | Internal cross-reference to an edge (for app linking, not display) |

**Legacy entry shape accepted:** `{ sourceUrl, sourceLabel, ... }` (top-level string fields) is silently normalized to the `{ source: { url, label } }` shape on ingest. No need to convert existing data before appending.

### Column fields

| Field | Required | Description |
|-------|----------|-------------|
| `key` | yes | Unique identifier. Immutable after creation. Must not collide with reserved keys: `highlight`, `sourceTraceId`, `sourceEdgeId`, `source`. |
| `label` | yes | Column header displayed in the table |
| `width` | yes | Percent of total table width (5–80) |
| `kind` | yes | `"text"` (plain string) or `"link"` (renders as hyperlink). Custom columns must use `"text"`. |

### Column management ops

Use these `update_production` ops to shape the table to the case. They can be mixed with row ops in a single call.

```json
// Add a custom text column (index is optional; omit to append at end)
{ "op": "chronology_add_column", "column": { "key": "amount", "label": "Amount (USD)", "width": 12, "kind": "text" }, "index": 3 }

// Remove a column (entry data under that key is preserved — re-adding the key restores rendering)
{ "op": "chronology_remove_column", "key": "details" }

// Rename or resize a column (key and kind are immutable)
{ "op": "chronology_update_column", "key": "amount", "patch": { "label": "Amount", "width": 15 } }

// Reorder columns — keys must be a permutation of current column keys
{ "op": "chronology_reorder_columns", "keys": ["source", "date", "amount", "description", "details"] }

// Resize existing columns by key (partial updates merged; missing columns keep current width)
{ "op": "chronology_set_column_widths", "widths": { "description": 35, "details": 20 } }
```

**When to add a column:** If this chronology centers on a dominant attribute — cash amounts, exhibit numbers, counterparties, token symbols — add a column for it so the value is first-class instead of squeezed into `details`. Example: a funds-flow chronology dominated by transfer amounts:

```json
// Step 1: add the column
{ "op": "chronology_add_column", "column": { "key": "amount", "label": "Amount (USD)", "width": 12, "kind": "text" } }

// Step 2: append entries that include the new field
{ "op": "chronology_append", "entries": [
    { "source": { "url": "https://etherscan.io/tx/0xabc...", "label": "0xabc…" }, "date": "2025-03-10", "description": "Transfer to cold wallet", "amount": "$1,200,000" },
    { "source": { "url": "https://etherscan.io/tx/0xdef...", "label": "0xdef…" }, "date": "2025-03-11", "description": "Withdrawal to exchange", "amount": "$450,000" }
  ]
}
```

Entries that predate the column (no `amount` key) render an empty cell — no backfill required.

### Best practices

- Order entries chronologically (earliest first).
- Always set `source.url` when the entry references an on-chain transaction.
- Provide `source.label` for tx hashes (e.g. `"0x6ae5…"`) — keeps the Source column compact.
- Keep `description` to one sentence. Put specifics in `details` or a custom column.
- Use consistent date formatting across entries.
- The chronology's title is the top-level `name` field — there is no separate `title` inside `data`. Pick a descriptive name at creation; rename later via `update_production` with just `name`.

### Large chronologies (>50 entries)

A single `create_production` call carries the entire `data` blob in the tool input, which counts against the model's per-turn output cap. On long timelines (hundreds of edges, transactions, or events) it routinely hits max_tokens mid-emission and the chronology never lands.

**Pattern: seed empty, then append in batches.**

1. `create_production` with `data: { entries: [] }` — tiny call, returns the new production's id. The title goes in the top-level `name`.
2. Loop `update_production` with the `chronology_append` op, ~50 entries per call, until done.

Each `chronology_append` call only emits the rows being added, so the per-turn cost is bounded by the batch size, not the chronology length. The batch size is a guideline — go smaller if individual entries are heavy (long `details`, many fields), larger if they're terse.

```json
// Step 1 — seed
{
  "name": "Wallet 0xABC… — full timeline",
  "type": "chronology",
  "data": { "entries": [] }
}

// Step 2..N — append batches
{
  "productionId": "<id from step 1>",
  "ops": [
    {
      "op": "chronology_append",
      "entries": [
        { "source": { "url": "...", "label": "..." }, "date": "...", "description": "..." },
        // ... up to ~50 entries ...
      ]
    }
  ]
}
```

If you are composing entries from a script (e.g. iterating over graph edges), prefer building the entries inside `execute_script`, POSTing them to the local API directly via the script, and only using the tool calls to seed and confirm. That keeps the entry data out of the conversation entirely.

## Updating productions

`update_production` has three modes — pick the cheapest one:

| Want to... | Pass | Token cost |
|---|---|---|
| Rename only | `name` | tiny |
| Modify part of the data | `ops` (preferred) | proportional to the change |
| Replace the whole data blob | `data` (last resort) | proportional to the entire production |

`data` and `ops` are mutually exclusive. `name` may accompany either.

### Atomic ops

Each entry in `ops` is an object with an `op` discriminator. Ops are applied in order, each operating on the result of the prior op. Indexes refer to the chronology *after* prior ops in the same call.

Supported ops:

```json
// Append rows to the end
{ "op": "chronology_append", "entries": [
    {
      "source": { "url": "https://etherscan.io/tx/0xddc0fe45...", "label": "0xddc0…" },
      "date": "2025-08-29",
      "description": "Sun sends 300,000 USDC to 0xa624 / Gnosis Safe",
      "details": "Block 19700730. Intermediary route."
    }
  ]
}

// Replace one row by zero-based index
{ "op": "chronology_replace", "index": 5, "entry": { ... } }

// Delete one or more rows by zero-based index
{ "op": "chronology_delete", "indexes": [3, 7] }

// Highlight one or more rows (or clear with color: null)
{ "op": "chronology_set_row_highlight", "indexes": [3, 7], "color": "red" }
{ "op": "chronology_set_row_highlight", "indexes": [3], "color": null }
```

**Row highlights** — use the dedicated op (above), not `chronology_replace`. Costs a few tokens, survives the row's content. Use sparingly; highlighting a third of the rows defeats the point. Default semantic mapping:

- `red` — suspicious, alert, fraud indicator
- `gray` — needs review, ambiguous
- `yellow` — note, worth attention
- `green` — verified, cleared, exonerating
- `blue` — informational, context

### Example: add three rows + fix one row + delete one row, in one call

```json
{
  "productionId": "<chronology id>",
  "ops": [
    { "op": "chronology_replace", "index": 4, "entry": { ... } },
    { "op": "chronology_delete", "indexes": [9] },
    { "op": "chronology_append", "entries": [{ ... }, { ... }, { ... }] }
  ]
}
```

Cost: ~size of the four changed rows. Not proportional to the chronology length.

### When `data` (full replace) is correct

- Rewriting a report (HTML blob) end-to-end. There are no `ops` for reports yet.
- Replacing an entire chart's datasets/options. No chart ops yet either.
- Migrating a chronology to a totally different shape (rare).
