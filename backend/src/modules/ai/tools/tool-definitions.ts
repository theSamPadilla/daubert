import Anthropic from '@anthropic-ai/sdk';
import { SKILL_REGISTRY, SKILL_NAMES } from '../../../skills/skill-registry';

// ---------- Built-in ----------

export const WEB_SEARCH_TOOL = {
  type: 'web_search_20260209',
  name: 'web_search',
} as unknown as Anthropic.Tool;

// ---------- Case data ----------

export const GET_CASE_DATA_TOOL: Anthropic.Tool = {
  name: 'get_case_data',
  description:
    'Get a high-level overview of this case: investigations (names, trace counts), productions (names, types), and data room connection status. Does NOT return graph data — use get_investigation for that.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

// ---------- Investigation data ----------

export const GET_INVESTIGATION_TOOL: Anthropic.Tool = {
  name: 'get_investigation',
  description:
    'Query investigation data. Without investigationId: returns summaries of all investigations (per-trace node/edge counts). With investigationId: returns full graph data (nodes, edges, groups, bundles — visual metadata stripped, edges denormalized with addresses). Optional address and token filters narrow the result. For very large datasets, prefer execute_script that fetches data via the local API and processes it without entering the conversation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      investigationId: { type: 'string', description: 'Investigation ID. Omit for summaries.' },
      address: { type: 'string', description: 'Filter to nodes matching this address and their incident edges.' },
      token: { type: 'string', description: 'Filter to edges with this token symbol (e.g. "ETH", "USDT").' },
    },
    required: [],
  },
};

// ---------- Skills ----------

const skillList = SKILL_REGISTRY.map((s) => `${s.name} (${s.description})`).join(', ');

export const GET_SKILL_TOOL: Anthropic.Tool = {
  name: 'get_skill',
  description: `Load a skill document into context for specialized instructions. Available: ${skillList}.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        enum: SKILL_NAMES as unknown as string[],
        description: 'The skill to load',
      },
    },
    required: ['name'],
  },
};

// ---------- Script execution ----------

export const EXECUTE_SCRIPT_TOOL: Anthropic.Tool = {
  name: 'execute_script',
  description:
    'Write and execute a JavaScript script with fetch() for HTTP calls. Use for batch API calls, data aggregation, complex queries, and graph mutations (fetch blockchain data → POST to import endpoint). The script runs in a sandboxed V8 isolate with top-level await support. API keys for Etherscan and Tronscan are injected automatically — do NOT include apikey params or TRON-PRO-API-KEY headers, just call the URLs directly. Available env: process.env.API_URL (backend base URL). Use console.log() for output. No filesystem or npm access. 30s timeout, 100KB output limit.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description:
          'Short descriptive name for this script run (e.g. "fetch-eth-txns", "check-tron-balance")',
      },
      code: {
        type: 'string',
        description:
          'JavaScript code to execute. Top-level await is supported. Use fetch() for HTTP calls. Print results with console.log().',
      },
    },
    required: ['name', 'code'],
  },
};

export const LIST_SCRIPT_RUNS_TOOL: Anthropic.Tool = {
  name: 'list_script_runs',
  description:
    'List recent script runs for the current investigation. Returns the last 20 runs with name, status, duration, and truncated output. Check this before re-running a script to avoid duplicate work.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

// ---------- Labeled entities ----------

export const QUERY_LABELED_ENTITIES_TOOL: Anthropic.Tool = {
  name: 'query_labeled_entities',
  description:
    'Search the Daubert labeled entity registry. Returns known entities (exchanges, mixers, bridges, protocols, individuals, etc.) matching the query. Use to identify who owns a wallet address or to find known entities by name or category.',
  input_schema: {
    type: 'object' as const,
    properties: {
      address: {
        type: 'string',
        description: 'Look up entities by wallet address. Case-insensitive.',
      },
      search: {
        type: 'string',
        description: 'Search entities by name (partial match).',
      },
      category: {
        type: 'string',
        enum: ['exchange', 'mixer', 'bridge', 'protocol', 'individual', 'contract', 'government', 'custodian', 'other'],
        description: 'Filter by entity category.',
      },
    },
    required: [],
  },
};

// ---------- Productions ----------

export const CREATE_PRODUCTION_TOOL: Anthropic.Tool = {
  name: 'create_production',
  description:
    'Create a production (report, chart, or chronology) for the current investigation. Reports store HTML content. Charts store Chart.js-compatible data. Chronologies store ordered entries with dates, descriptions, and source links. For large chronologies (expected to exceed ~50 entries), do NOT pass all entries here — the whole `data` blob counts against the per-turn output cap and routinely hits max_tokens. Instead seed an empty chronology (`data: { title, entries: [] }`), then loop `update_production` with `chronology_append` ops, ~50 entries per call. Same applies if you cannot bound the entry count up front.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: 'Name for the production (e.g. "Flow of Funds Summary", "Transaction Chronology")',
      },
      type: {
        type: 'string',
        enum: ['report', 'chart', 'chronology'],
        description: 'Production type',
      },
      data: {
        type: 'object',
        description: 'Production data. For report: { content: "<html>" }. For chart: { chartType, datasets[], labels[], options }. `options` accepts any Chart.js options object including `plugins.annotation.annotations` (chartjs-plugin-annotation is registered) for reference lines, thresholds, highlighted boxes, and labels — see the productions skill for the schema. For chronology: { entries: [{ sourceUrl, sourceLabel?, date, description, details?, highlight? }] }. The chronology title comes from the top-level `name` field; there is no separate title inside `data`. sourceLabel is the short clickable text (e.g. "0x6ae5…"); if omitted, a label is auto-derived from sourceUrl. `highlight` is an optional row background color — one of "yellow" | "gray" | "red" | "green" | "blue" — used to call attention to a row in both the app and the export. Legacy `source` is also accepted as an alias for sourceUrl.',
      },
    },
    required: ['name', 'type', 'data'],
  },
};

export const READ_PRODUCTION_TOOL: Anthropic.Tool = {
  name: 'read_production',
  description:
    'Read a production by ID, or list all productions for the current investigation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      productionId: {
        type: 'string',
        description: 'Get a specific production by ID.',
      },
      type: {
        type: 'string',
        enum: ['report', 'chart', 'chronology'],
        description: 'Filter by type when listing.',
      },
    },
    required: [],
  },
};

export const UPDATE_PRODUCTION_TOOL: Anthropic.Tool = {
  name: 'update_production',
  description: `Update a production. Three modes — pick the cheapest one that does the job:

1. **Rename only** — pass \`name\`, omit \`data\` and \`ops\`.
2. **Atomic ops** (preferred when modifying part of a large production) — pass \`ops\` as a list of operations applied in order. Each op carries only the slice that changes, so token cost is proportional to the change, not the whole production.
3. **Full replacement** (last resort) — pass \`data\`. Re-emits the entire data blob in the tool input. Token cost grows with production size and routinely hits max_tokens on long chronologies and reports. Only use when no \`ops\` covers your case.

\`data\` and \`ops\` are mutually exclusive. \`name\` may accompany either.

Supported operations (extend over time):

- \`{ op: "chronology_append", entries: [...] }\` — append rows to the end of a chronology. Each entry: { sourceUrl, sourceLabel?, date, description, details? }.
- \`{ op: "chronology_replace", index: <int>, entry: {...} }\` — replace the entry at zero-based index. Use the index from the most recent \`read_production\`. If you sequenced multiple ops in one call, the index applies to the chronology AFTER prior ops in the array have been applied.
- \`{ op: "chronology_delete", indexes: [<int>, ...] }\` — delete entries at the given zero-based indexes (applied in descending order so earlier indexes stay valid).
- \`{ op: "chronology_set_column_widths", widths: { source?: <pct>, date?: <pct>, description?: <pct>, details?: <pct> } }\` — set the table column widths used in both the in-app view and the PDF/HTML export. Each value is a number between 5 and 80 (percent of total table width). Partial updates are merged; missing columns keep their current width. The user normally sets these by dragging in the UI.
- \`{ op: "chronology_set_row_highlight", indexes: [<int>, ...], color: "yellow" | "gray" | "red" | "green" | "blue" | null }\` — set or clear the background highlight on one or more chronology rows. Indexes are zero-based. \`color: null\` clears the highlight. Use this (not \`chronology_replace\`) when you only want to highlight rows — it's a fraction of the token cost and survives full row content. Semantics are up to you; reasonable defaults: \`red\` = suspicious/alert, \`gray\` = needs review, \`yellow\` = note, \`green\` = verified/cleared, \`blue\` = informational. Highlights render in both the in-app table and the PDF/HTML export.
- \`{ op: "chart_set_height", height: <px> }\` — set the rendered height of a chart production. Pixels between 200 and 1200; default if unset is 384. The user normally sets this by dragging the handle below the chart, but you can adjust it when a chart needs more vertical room (e.g. many series, dense annotations, or wide axis labels causing crowding).

Use atomic ops aggressively — they are the difference between a 200-token call and a 10,000-token call on a long chronology.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      productionId: {
        type: 'string',
        description: 'The production ID to update.',
      },
      name: {
        type: 'string',
        description: 'New name. Optional. Compatible with both `data` and `ops` modes, or alone for a rename-only update.',
      },
      data: {
        type: 'object',
        description: 'Full replacement of the production data. Mutually exclusive with `ops`. Avoid for chronologies and large reports — use `ops` instead.',
      },
      ops: {
        type: 'array',
        description: 'List of atomic operations applied in order. Each item is an object with an `op` discriminator field. See the tool description for the supported op shapes. Mutually exclusive with `data`.',
        items: { type: 'object' },
      },
    },
    required: ['productionId'],
  },
};

