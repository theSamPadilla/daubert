// backend/src/modules/ai/tools/label-tools.ts
import type { Tool } from '@anthropic-ai/sdk/resources/messages';

const ANCHOR_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      required: ['type', 'x', 'y'],
      properties: {
        type: { type: 'string', enum: ['free'] },
        x: { type: 'number', description: 'Model-space X coordinate' },
        y: { type: 'number', description: 'Model-space Y coordinate' },
      },
    },
    {
      type: 'object',
      required: ['type', 'anchorId', 'dx', 'dy'],
      properties: {
        type: { type: 'string', enum: ['node'] },
        anchorId: { type: 'string', description: 'Wallet node ID' },
        dx: { type: 'number', description: 'X offset from node center (model coords)' },
        dy: { type: 'number', description: 'Y offset from node center (model coords)' },
      },
    },
    {
      type: 'object',
      required: ['type', 'anchorId', 't', 'perpOffset'],
      properties: {
        type: { type: 'string', enum: ['edge'] },
        anchorId: { type: 'string', description: 'Cytoscape edge UUID. Prefer txEdge variant for transaction edges (stable across aggregation). Use this only for bundles or synthetic edges without a txHash.' },
        t: { type: 'number', minimum: 0, maximum: 1, description: 'Position along edge (0=source, 1=target)' },
        perpOffset: { type: 'number', description: 'Perpendicular offset from edge line (model coords, signed)' },
      },
    },
    {
      type: 'object',
      required: ['type', 'txHash', 't', 'perpOffset'],
      properties: {
        type: { type: 'string', enum: ['txEdge'] },
        txHash: { type: 'string', description: 'Transaction hash. PREFERRED for transaction edges — stable across bundling, aggregation, and cross-trace de-dup. Resolved at render time to the current cytoscape edge with matching txHash.' },
        t: { type: 'number', minimum: 0, maximum: 1, description: 'Position along edge (0=source, 1=target)' },
        perpOffset: { type: 'number', description: 'Perpendicular offset from edge line (model coords, signed)' },
      },
    },
  ],
} as const;

export const ADD_LABEL_TOOL: Tool = {
  name: 'add_label',
  description: 'Add a freeform markdown label to a trace. Labels annotate the graph and can be free-floating, tethered to a wallet node, or tethered to a transaction edge. Returns the created label\'s id.',
  input_schema: {
    type: 'object',
    required: ['traceId', 'text', 'anchor'],
    properties: {
      traceId: { type: 'string', format: 'uuid' },
      text: { type: 'string', description: 'Markdown content. Max 1000 chars. Bold, links, code, line breaks supported.' },
      anchor: ANCHOR_SCHEMA as any,
    },
  },
};

export const UPDATE_LABEL_TOOL: Tool = {
  name: 'update_label',
  description: 'Update the markdown text of an existing label. Anchor and position are unchanged.',
  input_schema: {
    type: 'object',
    required: ['traceId', 'labelId', 'text'],
    properties: {
      traceId: { type: 'string', format: 'uuid' },
      labelId: { type: 'string' },
      text: { type: 'string', description: 'New markdown content. Max 1000 chars.' },
    },
  },
};

export const DELETE_LABEL_TOOL: Tool = {
  name: 'delete_label',
  description: 'Remove a label from a trace. Irreversible (no soft-delete).',
  input_schema: {
    type: 'object',
    required: ['traceId', 'labelId'],
    properties: {
      traceId: { type: 'string', format: 'uuid' },
      labelId: { type: 'string' },
    },
  },
};

export const MOVE_LABEL_TOOL: Tool = {
  name: 'move_label',
  description: 'Move a label to a new position. Preserves the anchor type (free / node / edge) — only updates the position fields appropriate to that anchor type.',
  input_schema: {
    type: 'object',
    required: ['traceId', 'labelId', 'position'],
    properties: {
      traceId: { type: 'string', format: 'uuid' },
      labelId: { type: 'string' },
      position: {
        type: 'object',
        description: 'For free anchors: { x, y }. For node anchors: { dx, dy }. For edge anchors: { t, perpOffset }.',
        additionalProperties: true,
      },
    },
  },
};

export const TETHER_LABEL_TOOL: Tool = {
  name: 'tether_label',
  description: 'Change a label\'s anchor type — re-tether to a different node/edge, or convert between free-floating and tethered. Useful when an annotation should follow a specific element instead of staying at fixed coords.',
  input_schema: {
    type: 'object',
    required: ['traceId', 'labelId', 'anchor'],
    properties: {
      traceId: { type: 'string', format: 'uuid' },
      labelId: { type: 'string' },
      anchor: ANCHOR_SCHEMA as any,
    },
  },
};

export const LABEL_TOOLS = [
  ADD_LABEL_TOOL,
  UPDATE_LABEL_TOOL,
  DELETE_LABEL_TOOL,
  MOVE_LABEL_TOOL,
  TETHER_LABEL_TOOL,
];
