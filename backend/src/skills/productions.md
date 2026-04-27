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
        "backgroundColor": "rgba(59, 130, 246, 0.7)"
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
| `backgroundColor` | no | Color(s) — string or array of strings. Use `rgba()` for transparency. |
| `borderColor` | no | Line/border color |
| `borderWidth` | no | Line/border width in pixels |

### Best practices

- Use descriptive labels that make sense without context.
- For multi-dataset charts, use distinct colors with consistent opacity.
- Prefer `bar` for comparisons, `line` for time series.
- Keep label count reasonable (under 20) — too many labels crowd the axis.
- The chart renders at a fixed height of 384px (h-96), so design for a landscape aspect ratio.
- The `options` field accepts any Chart.js options object — use it for axis labels, custom scales, or legend positioning.

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
        "source": "https://etherscan.io/tx/0x123...",
        "date": "2025-01-15",
        "description": "Initial deposit of 50 ETH from Coinbase",
        "details": "Block 19500000. Withdrawal from verified Coinbase hot wallet."
      },
      {
        "source": "https://etherscan.io/tx/0x456...",
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
| `source` | no | URL to the blockchain explorer transaction (renders as a clickable link) |
| `date` | yes | Date string displayed in the Date column (e.g. `"2025-01-15"` or `"Jan 15, 2025"`) |
| `description` | yes | What happened — concise summary |
| `details` | no | Additional context (block number, amounts, counterparty info) |
| `sourceTraceId` | no | Internal cross-reference to a trace (for app linking, not display) |
| `sourceEdgeId` | no | Internal cross-reference to an edge (for app linking, not display) |

### Best practices

- Order entries chronologically (earliest first).
- Always include the explorer URL as `source` when the entry references an on-chain transaction.
- Keep `description` to one sentence. Put specifics in `details`.
- Use consistent date formatting across entries.
- The `title` field is optional but helpful for multi-chronology cases.

## Updating productions

Use `update_production` with the production ID (from `create_production` or `read_production`). The `data` field is a **full replacement** — always send the complete data object, not a partial update.

To add entries to a chronology: read it first with `read_production`, append new entries to the array, then `update_production` with the full data.
