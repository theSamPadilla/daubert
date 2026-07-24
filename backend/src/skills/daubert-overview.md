---
name: daubert-overview
description: Orientation for a connected agent — what Daubert is, the MCP tool surface, the fetch→import workflow, the access model, and execution constraints
---

# Daubert — Agent Orientation

## What is Daubert

Daubert is a blockchain-transaction investigation tool. It organizes work as:

- **Cases** — a top-level container for an investigation (e.g. "FTX fraud", "Ronin Bridge hack")
- **Investigations** — workspaces inside a case, each containing one or more **traces**
- **Traces** — graph layers within an investigation. Each trace holds wallet nodes and transaction edges
- **Productions** — deliverables attached to a case: HTML reports, Chart.js charts, chronologies, declarations, and redlines
- **Data room** — file storage for a case (PDFs, CSVs, supporting documents)

You operate inside one organization. Cases, investigations, and traces all belong to that organization. Your access to each case is bounded by your role on it (see Access Model below).

## MCP Tool Surface

### Navigate (read-only, no case role needed beyond viewer)

| Tool | What it does |
|------|-------------|
| `list_cases` | List cases visible to you in this org (returns id, name, your role) |
| `get_case` | Get one case by id, including its investigations |
| `list_investigations` | List investigations under a case |

### Read (requires viewer role on the case)

| Tool | What it does |
|------|-------------|
| `get_case_data` | Get an aggregated case overview: investigations (with trace counts), productions (name + type), and the data-room file manifest |
| `get_investigation` | Read investigation graph data (nodes/edges/groups/bundles). Summaries without `investigationId`; full slimmed graph with it. Optional `address`/`token` filters. Requires viewer access. |
| `read_production` | Read the content of a production (report/chart/chronology/declaration/redline) |
| `query_labeled_entities` | Search for wallet nodes with a given label across an investigation |
| `get_skill` | Retrieve a skill document by name (workflow guidance for this agent) |
| `list_data_room_files` | List every data-room file for a case (id, name, mimeType, size, folder path) |
| `read_data_room_file` | Read a data-room file's contents — extracted text for docx/pdf/xlsx/csv/txt, an image block for images, or a size note if too large |

### Org library (org-scoped, no case role needed)

| Tool | What it does |
|------|-------------|
| `get_declarants` | List the org's saved declarant (expert witness) profiles |
| `get_declaration_library` | List the org's reusable boilerplate declaration blocks |

### Blockchain (no case role needed — uses Daubert's server-side API keys)

| Tool | What it does |
|------|-------------|
| `blockchain_fetch_history` | Fetch transaction history for an address on a given chain |
| `blockchain_get_transaction` | Fetch detail for a single transaction by hash |
| `blockchain_get_address_info` | Get balance, address type (wallet/contract), and known label |

Supported chains: `ethereum`, `polygon`, `arbitrum`, `base`, `tron`.

### Write (requires editor role on the case)

| Tool | What it does |
|------|-------------|
| `create_investigation` | Create a new investigation inside a case |
| `import_transactions` | Import transaction records into a trace (creates nodes + edges) |
| `create_production` | Create a new production (report, chart, chronology, declaration, or redline) |
| `update_production` | Update an existing production's content |

## Canonical Workflow: Fetch → Import

1. **Identify the target**: use `list_cases` / `get_case` / `list_investigations` to find the right investigation and trace id. Once identified, `get_investigation` reads its actual graph (nodes/edges).
2. **Fetch on-chain data**: call `blockchain_fetch_history` for the address(es) of interest. Results are pre-truncated to ~8 KB; use `page` and `limit` params to paginate if `truncated: true`.
3. **Filter and transform client-side**: select the transactions you want (by token, direction, time range, counterparties). Convert amounts to human-readable form (÷ 10^decimals). Map fields to the `import_transactions` shape: `{ from, to, txHash, chain, timestamp, amount, token, blockNumber?, fromLabel?, toLabel? }`.
4. **Import**: call `import_transactions` with the transformed records and the target `traceId`. The endpoint deduplicates by `{txHash}-{from}-{to}` — safe to call multiple times with overlapping data.
5. **Label and annotate** (optional): use the graph-mutations skill (`get_skill` with name `graph-mutations`) to edit node labels, colors, groups, and edge annotations after import.
6. **Produce a deliverable** (optional): call `create_production` to generate a report or chart from the investigation data.

For detailed Etherscan/Tronscan endpoint formats, call `get_skill` with name `etherscan-apis` or `tronscan-apis`.
For graph mutation patterns (edit nodes, edges, groups), call `get_skill` with name `graph-mutations`.
For production format details (HTML reports, Chart.js, chronologies), call `get_skill` with name `productions`.

## Execution Constraints

**All code runs in YOUR runtime, not on Daubert's servers.** Daubert does not expose a script-execution sandbox over MCP. There is an in-app script sandbox available to human users in the browser, but it is not accessible to MCP sessions. When you need to compute, transform, or aggregate data, do it in your own execution environment and then call the appropriate write tool with the results.

## Access Model

You act as the connected user, inside ONE organization:

- **Org boundary is hard**: you cannot read or write data belonging to a different organization, regardless of tool arguments.
- **Case roles**: each case grants you a role (`owner`, `editor`, or `viewer`). `list_cases` shows your effective role per case.
  - `viewer` — read access (navigate + read tools)
  - `editor` — read + write access (all tools)
  - `owner` — same as editor, plus case membership management (managed via the web UI, not MCP)
- **Role violations** surface as MCP tool errors (`isError: true`) — they do not crash the session.
- When in doubt about your role on a case, call `list_cases` first.
