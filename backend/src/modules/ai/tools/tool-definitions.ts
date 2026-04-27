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
    'Fetch the investigation graph for this case. Returns all investigations with their wallet nodes and transaction edges. Use this when the user asks about addresses, transactions, or patterns in their investigation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      investigationId: {
        type: 'string',
        description:
          'Optional. Fetch data for a specific investigation by ID. If omitted, returns all investigations for the case.',
      },
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
    'Create a production (report, chart, or chronology) for the current investigation. Reports store HTML content. Charts store Chart.js-compatible data. Chronologies store ordered entries with dates, descriptions, and source links.',
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
        description: 'Production data. For report: { content: "<html>" }. For chart: { chartType, datasets[], labels[], options }. For chronology: { title, entries: [{ source, date, description, details? }] }.',
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
  description:
    'Update a production\'s name, type, or data. Use to iteratively refine a report, update a chart, or add entries to a chronology.',
  input_schema: {
    type: 'object' as const,
    properties: {
      productionId: {
        type: 'string',
        description: 'The production ID to update.',
      },
      name: {
        type: 'string',
        description: 'New name (optional).',
      },
      data: {
        type: 'object',
        description: 'New data (replaces existing data entirely).',
      },
    },
    required: ['productionId'],
  },
};

