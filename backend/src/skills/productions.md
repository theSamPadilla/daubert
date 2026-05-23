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

Chronologies store ordered entries with dates, descriptions, and source links. Rendered as a table with Source, Date, Description, and Details columns.

### Data format

```json
{
  "name": "Transaction Timeline",
  "type": "chronology",
  "data": {
    "title": "Key Events — Wallet 0xABC...",
    "entries": [
      {
        "sourceUrl": "https://etherscan.io/tx/0x6ae5fc12abcd...",
        "sourceLabel": "0x6ae5…",
        "date": "2025-01-15",
        "description": "Initial deposit of 50 ETH from Coinbase",
        "details": "Block 19500000. Withdrawal from verified Coinbase hot wallet."
      },
      {
        "sourceUrl": "https://etherscan.io/tx/0x14b5ef89cdef...",
        "sourceLabel": "0x14b5…",
        "date": "2025-01-16",
        "description": "Transfer of 25 ETH to mixer contract",
        "details": "Tornado Cash 10 ETH pool, 2.5 deposits over 3 hours."
      }
    ]
  }
}
```

### Entry fields

| Field | Required | Description |
|-------|----------|-------------|
| `sourceUrl` | no | URL to the blockchain explorer transaction (used as the link `href`) |
| `sourceLabel` | no | Short display text for the link (e.g. `"0x6ae5…"`). If omitted, a label is auto-derived from `sourceUrl` (last 0x-hash, first 6 chars). |
| `source` | no | **Deprecated** alias for `sourceUrl`. Still accepted for backward compatibility. Prefer `sourceUrl`. |
| `date` | yes | Date string displayed in the Date column (e.g. `"2025-01-15"` or `"Jan 15, 2025"`) |
| `description` | yes | What happened — concise summary |
| `details` | no | Additional context (block number, amounts, counterparty info) |
| `sourceTraceId` | no | Internal cross-reference to a trace (for app linking, not display) |
| `sourceEdgeId` | no | Internal cross-reference to an edge (for app linking, not display) |

### Best practices

- Order entries chronologically (earliest first).
- Always include the explorer URL as `sourceUrl` when the entry references an on-chain transaction.
- Provide a `sourceLabel` for tx hashes (e.g. `"0x6ae5…"`) — keeps the Source column compact. The renderer will auto-derive one if you omit it.
- Keep `description` to one sentence. Put specifics in `details`.
- Use consistent date formatting across entries.
- The `title` field is optional but helpful for multi-chronology cases.

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
      "sourceUrl": "https://etherscan.io/tx/0xddc0fe45...",
      "sourceLabel": "0xddc0…",
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

// Replace just the chronology title
{ "op": "chronology_set_title", "title": "Updated timeline — May 2026" }
```

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
