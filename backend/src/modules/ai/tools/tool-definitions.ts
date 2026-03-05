import Anthropic from '@anthropic-ai/sdk';

export const SKILL_NAMES = ['blockchain-apis', 'graph-mutations'] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

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

export const GET_SKILL_TOOL: Anthropic.Tool = {
  name: 'get_skill',
  description:
    'Load a skill document into context for specialized instructions. Available: blockchain-apis (Etherscan + Tronscan API reference for direct blockchain queries), graph-mutations (how to add nodes/edges to the investigation graph via scripts).',
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
    'Write and execute a JavaScript script with fetch() and blockchain API key env vars. Use for batch API calls, data aggregation, complex queries, and graph mutations (fetch blockchain data → POST to import endpoint). The script runs in Node.js with top-level await support. Available env vars: process.env.ETHERSCAN_API_KEY, process.env.TRONSCAN_API_KEY, process.env.API_URL (backend base URL). Use console.log() for output. No filesystem or npm access. 30s timeout, 100KB output limit.',
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

