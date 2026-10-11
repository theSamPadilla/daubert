import type Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import type { FileNotes } from '../../database/entities/data-room-file-note.entity';
import { PDF_B64_LIMIT } from './attachment-blocks';

/**
 * Data-room files in a conversation are persisted as `data_room_ref` pointer
 * blocks, never as file bytes. This module decides, when history is loaded,
 * which pointers to reload as real document/image blocks and which to prune
 * to a short stub. Pure: no IO, never mutates its input.
 *
 * One rule for every file: its full content stays in the conversation for the
 * next FILE_WINDOW_PROMPTS user messages, then becomes a stub with a short
 * version of its notes. Re-reading restarts the window.
 */

/** Text of the synthetic assistant row persisted between a read's tool_result
 *  row and its pointer row. Hidden from the chat UI. */
export const FILE_CONTENT_MARKER = '(file content follows)';

/** Start of the agent-facing note persistUserMessage stores in a user row with
 *  chat attachments ("Attached files saved to the data room: <name> (fileId
 *  <id>), ..."). Hidden from the chat UI and exports. */
export const DATA_ROOM_ATTACHED_PREFIX = 'Attached files saved to the data room';

/** How many user prompts a file's full content stays loaded for. */
export const FILE_WINDOW_PROMPTS = 10;

const NOTES_SUMMARY_CHARS = 600;

type Message = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;

/** Persisted pointer to a data-room file. `size` (bytes) and `pages` (PDFs)
 *  feed the rehydration budget; absent values count as zero. */
export interface DataRoomRefBlock {
  type: 'data_room_ref';
  origin: 'read' | 'upload';
  fileId: string;
  name: string;
  mediaType: string;
  size?: number;
  pages?: number;
}

/** Placeholder for a pointer that will become a notes stub in swapRefs. Never
 *  leaves this module's pipeline (swapRefs replaces every one). */
interface RefStubBlock {
  type: 'data_room_ref_stub';
  fileId: string;
  name: string;
}

export interface RefBudget {
  /** Max total request bytes for reloaded files (raw size; Files API PDFs count zero). */
  maxBytes: number;
  /** Max total PDF pages across reloaded files. */
  maxPdfPages: number;
}

export interface CollectedRefs {
  /** Copy of the history: kept pointers are still raw (swapRefs loads them);
   *  everything else is already a text block or a stub placeholder. */
  messages: Message[];
  /** Pointers to load, newest first. One per fileId. */
  load: DataRoomRefBlock[];
  /** Files whose pointer becomes a notes stub; load their notes for swapRefs. */
  stubFileIds: string[];
}

export function isDataRoomRef(b: unknown): b is DataRoomRefBlock {
  return (b as { type?: string })?.type === 'data_room_ref';
}

/** Build a pointer block for a file the agent read or the user attached. */
export async function buildDataRoomRef(args: {
  origin: 'read' | 'upload';
  fileId: string;
  name: string;
  mediaType: string;
  buffer: Buffer;
}): Promise<DataRoomRefBlock> {
  const ref: DataRoomRefBlock = {
    type: 'data_room_ref',
    origin: args.origin,
    fileId: args.fileId,
    name: args.name,
    mediaType: args.mediaType,
    size: args.buffer.length,
  };
  if (args.mediaType === 'application/pdf') {
    try {
      const doc = await PDFDocument.load(args.buffer, { ignoreEncryption: true, updateMetadata: false });
      ref.pages = doc.getPageCount();
    } catch {
      // Unparseable: leave pages unknown; the byte budget still applies.
    }
  }
  return ref;
}

function blocksOf(m: Message): Block[] {
  return Array.isArray(m.content) ? (m.content as Block[]) : [];
}

/**
 * Index of the last assistant message holding a compaction block with a
 * summary, or -1. The API ignores everything before such a block. A block
 * with null content is a failed compaction the API treats as a no-op, so it
 * is not a boundary.
 */
export function lastCompactionIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    if (blocksOf(m).some((b: any) => b?.type === 'compaction' && typeof b.content === 'string')) return i;
  }
  return -1;
}

/** A user row the user typed (or attached files to). Rows holding only
 *  tool_result blocks or only read pointers are produced by the agent loop. */
function isPrompt(m: Message): boolean {
  if (m.role !== 'user') return false;
  if (!Array.isArray(m.content)) return true;
  const content = m.content as any[];
  if (content.length === 0) return false;
  if (content.every((b) => b?.type === 'tool_result')) return false;
  if (content.every((b) => isDataRoomRef(b) && b.origin === 'read')) return false;
  return true;
}

/** Stub text must not change from one message to the next (no "N messages
 *  ago"), or it busts the prompt cache from the first stub onward. */
function legacyStub(block: any): Block {
  const title = typeof block.title === 'string' && block.title ? block.title : 'unnamed';
  return {
    type: 'text',
    text: `[attached file ${title} was shared earlier in this conversation; its content is no longer loaded.]`,
  };
}

/** Bytes a reloaded file adds to the request. PDFs too big for inline base64
 *  go by Files API id (see buildAttachmentBlocks) and add almost nothing. */
function requestBytes(ref: DataRoomRefBlock): number {
  const size = ref.size ?? 0;
  if (ref.mediaType === 'application/pdf' && size * (4 / 3) > PDF_B64_LIMIT) return 0;
  return size;
}

/** What a loaded file counts against the rehydration budget. */
export function refRequestCost(ref: DataRoomRefBlock): { bytes: number; pages: number } {
  return { bytes: requestBytes(ref), pages: ref.mediaType === 'application/pdf' ? ref.pages ?? 0 : 0 };
}

/**
 * Plan which pointers to reload. See the module comment for the rule.
 *  - Only pointers after the last compaction block count; earlier ones become
 *    plain text (the API ignores everything before a compaction block).
 *  - Only the last pointer per fileId counts; earlier ones say so.
 *  - A pointer is in the window when fewer than `windowPrompts` prompts follow
 *    the prompt it belongs to. Outside it, it becomes a notes stub.
 *  - Inside the window, a byte and PDF-page budget keeps the newest files and
 *    stubs the older ones that do not fit.
 *  - Legacy inline document/image blocks get the same window.
 */
export function collectRefs(
  messages: Message[],
  opts: { windowPrompts: number; budget: RefBudget },
): CollectedRefs {
  // Prompts after each row's own prompt.
  const promptIdx: number[] = [];
  messages.forEach((m, i) => { if (isPrompt(m)) promptIdx.push(i); });
  const agoOf = (row: number): number => {
    // Prompts strictly after the prompt this row belongs to (the last prompt
    // at or before it). A row before any prompt counts every prompt.
    let ownPrompt = -1;
    for (const p of promptIdx) { if (p <= row) ownPrompt = p; else break; }
    return promptIdx.filter((p) => p > ownPrompt).length;
  };

  const lastCompaction = lastCompactionIndex(messages);

  // Last pointer per fileId after the compaction.
  const lastRefAt = new Map<string, { row: number; col: number }>();
  messages.forEach((m, row) => {
    if (row <= lastCompaction || m.role !== 'user') return;
    (blocksOf(m) as unknown[]).forEach((b, col) => {
      if (isDataRoomRef(b)) lastRefAt.set(b.fileId, { row, col });
    });
  });

  // Budget over in-window pointers, newest first.
  const inWindow = [...lastRefAt.entries()]
    .map(([fileId, pos]) => ({ fileId, ...pos, ago: agoOf(pos.row) }))
    .filter((r) => r.ago < opts.windowPrompts)
    .sort((a, b) => b.row - a.row || b.col - a.col);
  const loaded = new Set<string>();
  let bytes = 0;
  let pages = 0;
  for (const r of inWindow) {
    const ref = blocksOf(messages[r.row])[r.col] as unknown as DataRoomRefBlock;
    const { bytes: b, pages: p } = refRequestCost(ref);
    if (bytes + b > opts.budget.maxBytes || pages + p > opts.budget.maxPdfPages) continue;
    bytes += b;
    pages += p;
    loaded.add(r.fileId);
  }

  const load: DataRoomRefBlock[] = [];
  const stubFileIds: string[] = [];
  const out = messages.map((m, row): Message => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return m;
    const ago = agoOf(row);
    const beforeCompaction = row <= lastCompaction;
    let changed = false;
    const content = (m.content as any[]).map((b, col): any => {
      if (isDataRoomRef(b)) {
        changed = true;
        if (beforeCompaction) {
          return { type: 'text', text: `[file ${b.name} was read before this conversation was summarized]` };
        }
        const last = lastRefAt.get(b.fileId)!;
        if (last.row !== row || last.col !== col) {
          return { type: 'text', text: `[file ${b.name} re-read later in this conversation]` };
        }
        if (loaded.has(b.fileId)) {
          load.push(b);
          return { ...b };
        }
        stubFileIds.push(b.fileId);
        const stub: RefStubBlock = { type: 'data_room_ref_stub', fileId: b.fileId, name: b.name };
        return stub;
      }
      if ((b?.type === 'document' || b?.type === 'image') && (beforeCompaction || ago >= opts.windowPrompts)) {
        changed = true;
        return legacyStub(b);
      }
      return b;
    });
    return changed ? { ...m, content } : m;
  });

  load.reverse(); // built oldest first; callers get newest first
  stubFileIds.reverse();
  return { messages: out, load, stubFileIds };
}

/** Text that replaces a file's content once it is pruned from the request. */
export function fileStubText(name: string, fileId: string, notes: FileNotes | undefined): string {
  return `[file ${name} (fileId ${fileId}) was read earlier in this conversation; full content pruned to keep this conversation light. Notes: ${clipSummary(notes)}. Call get_file_notes for full notes or read_data_room_file for exact text.]`;
}

function clipSummary(notes: FileNotes | undefined): string {
  const summary = (typeof notes?.summary === 'string' ? notes.summary : '').trim().replace(/\.+$/, '');
  if (!summary) return 'none recorded';
  return summary.length > NOTES_SUMMARY_CHARS ? `${summary.slice(0, NOTES_SUMMARY_CHARS)}...` : summary;
}

/**
 * Replace the pointers left by {@link collectRefs}: kept pointers become their
 * loaded blocks (or a "no longer available" note), stubbed pointers become a
 * stub carrying a short version of the file's notes. After this no
 * `data_room_ref` block remains, so the result is safe to send to the API.
 */
export function swapRefs(
  messages: Message[],
  blocksByFileId: Map<string, Block[]>,
  notesByFileId: Map<string, FileNotes | undefined> = new Map(),
  /** Files that exist but could not go into the request (too large, unsupported). */
  unloadableFileIds: Set<string> = new Set(),
): Message[] {
  return messages.map((m): Message => {
    if (!Array.isArray(m.content)) return m;
    const content = m.content as any[];
    if (!content.some((b) => isDataRoomRef(b) || b?.type === 'data_room_ref_stub')) return m;
    return {
      ...m,
      content: content.flatMap((b): Block[] => {
        if (isDataRoomRef(b)) {
          const loaded = blocksByFileId.get(b.fileId);
          if (loaded?.length) return loaded;
          if (unloadableFileIds.has(b.fileId)) {
            return [{
              type: 'text',
              text: `[file ${b.name} (fileId ${b.fileId}) could not be loaded into this request (too large or unsupported); call read_data_room_file for details.]`,
            }];
          }
          return [{ type: 'text', text: `[file ${b.name} no longer available]` }];
        }
        if (b?.type === 'data_room_ref_stub') {
          const s = b as RefStubBlock;
          return [{ type: 'text', text: fileStubText(s.name, s.fileId, notesByFileId.get(s.fileId)) }];
        }
        return [b];
      }),
    };
  });
}
