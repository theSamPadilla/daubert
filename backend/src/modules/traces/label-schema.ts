// backend/src/modules/traces/label-schema.ts

export const MAX_LABEL_TEXT_LENGTH = 1000;

export type LabelAnchor =
  | { type: 'free'; x: number; y: number }
  | { type: 'node'; anchorId: string; dx: number; dy: number }
  | { type: 'edge'; anchorId: string; t: number; perpOffset: number }
  | { type: 'txEdge'; txHash: string; t: number; perpOffset: number };

export type LabelFontSize = 'sm' | 'md' | 'lg';

export type LabelShape = 'rectangle' | 'rounded' | 'pill' | 'ellipse';

export interface TraceLabel {
  id: string;
  text: string;
  anchor: LabelAnchor;
  /** Optional hex color (e.g. "#ef4444") applied to the label wrapper text. */
  color?: string;
  /** Optional hex color applied to the label wrapper background. */
  bgColor?: string;
  /** Optional font size. Defaults to 'md' (11px) when absent. */
  fontSize?: LabelFontSize;
  /** Optional wrapper shape. Defaults to 'rounded' when absent. */
  shape?: LabelShape;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateAnchor(a: unknown, ctx: string): LabelAnchor {
  if (a === null || typeof a !== 'object') throw new Error(`${ctx}: anchor must be an object`);
  const r = a as Record<string, unknown>;
  switch (r.type) {
    case 'free':
      if (!isFiniteNumber(r.x) || !isFiniteNumber(r.y)) throw new Error(`${ctx}: free anchor requires finite x, y`);
      return { type: 'free', x: r.x, y: r.y };
    case 'node':
      if (typeof r.anchorId !== 'string' || !r.anchorId) throw new Error(`${ctx}: node anchor requires anchorId`);
      if (!isFiniteNumber(r.dx) || !isFiniteNumber(r.dy)) throw new Error(`${ctx}: node anchor requires finite dx, dy`);
      return { type: 'node', anchorId: r.anchorId, dx: r.dx, dy: r.dy };
    case 'edge':
      if (typeof r.anchorId !== 'string' || !r.anchorId) throw new Error(`${ctx}: edge anchor requires anchorId`);
      if (!isFiniteNumber(r.t) || r.t < 0 || r.t > 1) throw new Error(`${ctx}: edge anchor requires t in [0, 1]`);
      if (!isFiniteNumber(r.perpOffset)) throw new Error(`${ctx}: edge anchor requires finite perpOffset`);
      return { type: 'edge', anchorId: r.anchorId, t: r.t, perpOffset: r.perpOffset };
    case 'txEdge':
      if (typeof r.txHash !== 'string' || !r.txHash) throw new Error(`${ctx}: txEdge anchor requires txHash`);
      if (!isFiniteNumber(r.t) || r.t < 0 || r.t > 1) throw new Error(`${ctx}: txEdge anchor requires t in [0, 1]`);
      if (!isFiniteNumber(r.perpOffset)) throw new Error(`${ctx}: txEdge anchor requires finite perpOffset`);
      return { type: 'txEdge', txHash: r.txHash, t: r.t, perpOffset: r.perpOffset };
    default:
      throw new Error(`${ctx}: anchor.type must be "free" | "node" | "edge" | "txEdge"`);
  }
}

export function validateLabels(input: unknown): TraceLabel[] {
  if (!Array.isArray(input)) throw new Error('labels must be an array');
  const out: TraceLabel[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    const ctx = `labels[${i}]`;
    if (raw === null || typeof raw !== 'object') throw new Error(`${ctx}: label must be an object`);
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id) throw new Error(`${ctx}: id must be a non-empty string`);
    if (seen.has(r.id)) throw new Error(`${ctx}: duplicate label id "${r.id}"`);
    seen.add(r.id);
    if (typeof r.text !== 'string') throw new Error(`${ctx}: text must be a string`);
    if (r.text.length > MAX_LABEL_TEXT_LENGTH) throw new Error(`${ctx}: text length ${r.text.length} exceeds max ${MAX_LABEL_TEXT_LENGTH}`);
    const anchor = validateAnchor(r.anchor, ctx);
    const label: TraceLabel = { id: r.id, text: r.text, anchor };
    if (r.color !== undefined) {
      if (typeof r.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(r.color)) {
        throw new Error(`${ctx}: color must be a 6-digit hex string like "#ef4444"`);
      }
      label.color = r.color;
    }
    if (r.bgColor !== undefined) {
      if (typeof r.bgColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(r.bgColor)) {
        throw new Error(`${ctx}: bgColor must be a 6-digit hex string like "#ef4444"`);
      }
      label.bgColor = r.bgColor;
    }
    if (r.fontSize !== undefined) {
      if (r.fontSize !== 'sm' && r.fontSize !== 'md' && r.fontSize !== 'lg') {
        throw new Error(`${ctx}: fontSize must be "sm" | "md" | "lg"`);
      }
      label.fontSize = r.fontSize;
    }
    if (r.shape !== undefined) {
      if (r.shape !== 'rectangle' && r.shape !== 'rounded' && r.shape !== 'pill' && r.shape !== 'ellipse') {
        throw new Error(`${ctx}: shape must be "rectangle" | "rounded" | "pill" | "ellipse"`);
      }
      label.shape = r.shape;
    }
    out.push(label);
  });
  return out;
}

export function normalizeLabels(input: unknown): TraceLabel[] {
  if (input === undefined || input === null) return [];
  return validateLabels(input);
}
