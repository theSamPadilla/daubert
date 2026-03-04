import Anthropic from '@anthropic-ai/sdk';

export const WEB_SEARCH_TOOL = {
  type: 'web_search_20260209',
  name: 'web_search',
} as unknown as Anthropic.Tool;

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

export const AGENT_TOOLS = [WEB_SEARCH_TOOL, GET_CASE_DATA_TOOL];
