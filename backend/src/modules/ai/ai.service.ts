import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { MessageEntity } from '../../database/entities/message.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { INVESTIGATOR_PROMPT } from '../../prompts/investigator';
import { ConversationsService } from './conversations.service';
import { ScriptExecutionService } from './services/script-execution.service';
import { LabeledEntitiesService } from '../labeled-entities/labeled-entities.service';
import { EntityCategory } from '../../database/entities/labeled-entity.entity';
import { ProductionsService } from '../productions/productions.service';
import { ProductionType } from '../../database/entities/production.entity';
import { AnthropicProvider } from './providers/anthropic.provider';
import {
  AGENT_TOOLS,
  GET_CASE_DATA_TOOL,
  GET_SKILL_TOOL,
  EXECUTE_SCRIPT_TOOL,
  LIST_SCRIPT_RUNS_TOOL,
  QUERY_LABELED_ENTITIES_TOOL,
  CREATE_PRODUCTION_TOOL,
  READ_PRODUCTION_TOOL,
  UPDATE_PRODUCTION_TOOL,
  SKILL_NAMES,
} from './tools';
import { AttachmentDto } from './dto/chat-message.dto';

/**
 * Ensures every tool_use / code_execution block in an assistant message has a
 * matching tool_result / code_execution_tool_result in the following user
 * message, and vice-versa. Strips broken pairs so the API never sees orphaned
 * blocks.
 *
 * Broken pairs arise when:
 *  - Both rows were saved in the same DB transaction (same NOW() → unstable sort)
 *  - The compact-2026-01-12 beta summarised away a tool_use block but left its
 *    tool_result in the DB.
 *  - adaptive thinking causes the model to emit code_execution blocks that need
 *    a matching code_execution_tool_result in the next user turn.
 */
function sanitizeToolPairs(
  messages: Anthropic.Beta.BetaMessageParam[],
): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];

  // Types that act like tool_use and need a matching result in the next turn
  const USE_TYPES = new Set(['tool_use', 'code_execution']);
  // Types that act like tool_result and need a matching use in the prev turn
  const RESULT_TYPES = new Set(['tool_result', 'code_execution_tool_result']);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const content = (Array.isArray(msg.content) ? msg.content : []) as any[];

    if (msg.role === 'assistant') {
      const toolUses = content.filter((b) => USE_TYPES.has(b.type));

      if (toolUses.length > 0) {
        // Collect result IDs from the immediately following user message
        const next = messages[i + 1];
        const nextContent = (next?.role === 'user' && Array.isArray(next.content)
          ? next.content
          : []) as any[];
        const resultIds = new Set(
          nextContent
            .filter((b) => RESULT_TYPES.has(b.type))
            .map((b) => b.tool_use_id),
        );

        // Keep only tool-use blocks that have a matching result; keep all others
        const kept = content.filter(
          (b) => !USE_TYPES.has(b.type) || resultIds.has(b.id),
        );
        if (kept.length === 0) continue; // skip empty assistant message
        out.push({ ...msg, content: kept });
        continue;
      }
    }

    if (msg.role === 'user') {
      const toolResults = content.filter((b) => RESULT_TYPES.has(b.type));

      if (toolResults.length > 0) {
        // Collect tool-use IDs from the immediately preceding assistant message
        const prev = out[out.length - 1];
        const prevContent = (prev?.role === 'assistant' && Array.isArray(prev.content)
          ? prev.content
          : []) as any[];
        const useIds = new Set(
          prevContent.filter((b) => USE_TYPES.has(b.type)).map((b) => b.id),
        );

        // Keep only results with a matching use; keep all others
        const kept = content.filter(
          (b) => !RESULT_TYPES.has(b.type) || useIds.has(b.tool_use_id),
        );
        if (kept.length === 0) continue; // skip empty user message
        out.push({ ...msg, content: kept });
        continue;
      }
    }

    out.push(msg);
  }

  return out;
}

/**
 * Merge consecutive messages with the same role. This can happen when tool
 * results from compaction or DB ordering produce adjacent user messages.
 * The Anthropic API requires strictly alternating roles.
 */
function mergeConsecutiveRoles(
  messages: Anthropic.Beta.BetaMessageParam[],
): Anthropic.Beta.BetaMessageParam[] {
  if (messages.length === 0) return messages;
  const merged: Anthropic.Beta.BetaMessageParam[] = [messages[0]];
  for (let i = 1; i < messages.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = messages[i];
    if (prev.role === curr.role) {
      const prevBlocks = Array.isArray(prev.content) ? prev.content : [{ type: 'text' as const, text: prev.content as string }];
      const currBlocks = Array.isArray(curr.content) ? curr.content : [{ type: 'text' as const, text: curr.content as string }];
      prev.content = [...prevBlocks, ...currBlocks] as any;
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * Detects whether an Anthropic API error is the "tool use without result" class
 * of invalid_request_error that can be auto-healed by stripping server-side
 * tool blocks from the history.
 */
function isOrphanedToolError(err: unknown): boolean {
  if (!(err instanceof Anthropic.BadRequestError)) return false;
  const msg = (err as any)?.error?.error?.message ?? err.message ?? '';
  return (
    msg.includes('code_execution') ||
    msg.includes('tool_use') ||
    msg.includes('without a corresponding') ||
    msg.includes('tool_result')
  );
}

/**
 * Produce a compact version of a tool result for DB persistence. The full
 * result feeds the current agent loop (in-memory); the slim version is what
 * future requests see when loading conversation history. The model can
 * re-call tools if it needs full data again.
 */
function slimToolResult(toolName: string, full: string): string {
  switch (toolName) {
    case 'get_case_data': {
      // Summarise graph data: investigation/trace/node/edge counts
      try {
        const data = JSON.parse(full);
        if (Array.isArray(data)) {
          const summary = data.map((inv: any) => ({
            id: inv.id,
            name: inv.name,
            traceCount: inv.traces?.length ?? 0,
            nodeCount: inv.traces?.reduce((n: number, t: any) => n + (t.data?.nodes?.length ?? 0), 0) ?? 0,
            edgeCount: inv.traces?.reduce((n: number, t: any) => n + (t.data?.edges?.length ?? 0), 0) ?? 0,
          }));
          return JSON.stringify(summary);
        }
      } catch { /* fall through */ }
      break;
    }

    case 'get_skill':
      // Skill was loaded into context for the current turn — future turns can re-load
      try {
        const parsed = JSON.parse(full);
        if (parsed.content) return JSON.stringify({ loaded: true });
      } catch { /* fall through */ }
      break;

    case 'execute_script':
    case 'list_script_runs':
      // Truncate large outputs
      if (full.length > 2000) {
        return full.slice(0, 2000) + '...[truncated]';
      }
      break;
  }

  // Default cap for any tool result
  if (full.length > 3000) {
    return full.slice(0, 3000) + '...[truncated]';
  }
  return full;
}

export interface SseEvent {
  type: 'text_delta' | 'tool_start' | 'tool_done' | 'graph_updated' | 'done' | 'error';
  data: unknown;
}

const MAX_ITERATIONS = 10;

@Injectable()
export class AiService {
  constructor(
    private readonly llm: AnthropicProvider,
    private readonly conversationsService: ConversationsService,
    private readonly scriptExecutionService: ScriptExecutionService,
    private readonly labeledEntitiesService: LabeledEntitiesService,
    private readonly productionsService: ProductionsService,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @InjectRepository(InvestigationEntity)
    private readonly investigationRepo: Repository<InvestigationEntity>,
  ) {}

  async *streamChat(
    conversationId: string,
    userMessage: string | undefined,
    caseId?: string,
    investigationId?: string,
    attachments?: AttachmentDto[],
    model?: string,
  ): AsyncGenerator<SseEvent> {
    await this.conversationsService.findOne(conversationId);

    // Load history and reconstruct MessageParam[] verbatim.
    // Compaction blocks stored in assistant content are preserved automatically.
    const dbMessages = await this.conversationsService.getMessages(conversationId);
    const rawMessages: Anthropic.Beta.BetaMessageParam[] = dbMessages.map(
      (m) => ({
        role: m.role,
        content: m.content as Anthropic.Beta.BetaContentBlockParam[],
      }),
    );
    // Sanitize: remove orphaned tool_use / tool_result pairs that can arise
    // from same-transaction timestamps or compaction replacing old tool_use blocks.
    // Then merge any consecutive same-role messages (API requires alternating roles).
    const messages = mergeConsecutiveRoles(sanitizeToolPairs(rawMessages));

    // Build content blocks for the user turn
    const userContentBlocks: Anthropic.Beta.BetaContentBlockParam[] = [];

    // Anthropic size limits (base64 chars ≈ raw bytes * 1.37)
    // Images: 5 MB raw → ~6.8 MB base64 chars
    // PDFs:   4.5 MB raw → ~6.2 MB base64 chars (API hard limit for document blocks)
    // XLSX:   same document limit as PDFs
    const IMAGE_B64_LIMIT = 6_800_000;
    const PDF_B64_LIMIT   = 6_200_000;
    const XLSX_B64_LIMIT  = 6_200_000;

    // Attach images and documents before the text
    if (attachments?.length) {
      for (const att of attachments) {
        if (att.mediaType === 'application/pdf') {
          if (att.data.length > PDF_B64_LIMIT) {
            // Too large for the API — send a text stub so the turn still works
            userContentBlocks.push({
              type: 'text',
              text: `[Attached PDF "${att.name}" (${(att.data.length * 0.75 / 1_048_576).toFixed(1)} MB) is too large to pass verbatim. Summarise or ask the user for the relevant excerpt.]`,
            });
          } else {
            userContentBlocks.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: att.data },
              title: att.name,
            } as any);
          }
        } else if (att.mediaType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
          if (att.data.length > XLSX_B64_LIMIT) {
            userContentBlocks.push({
              type: 'text',
              text: `[Attached spreadsheet "${att.name}" (${(att.data.length * 0.75 / 1_048_576).toFixed(1)} MB) is too large to process. Ask the user for the relevant excerpt.]`,
            });
          } else {
            try {
              const buf = Buffer.from(att.data, 'base64');
              const workbook = XLSX.read(buf, { type: 'buffer' });
              const sheets: string[] = [];
              for (const name of workbook.SheetNames) {
                const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
                sheets.push(`--- Sheet: ${name} ---\n${csv}`);
              }
              userContentBlocks.push({
                type: 'text',
                text: `[Spreadsheet: ${att.name}]\n\n${sheets.join('\n\n')}`,
              });
            } catch {
              userContentBlocks.push({
                type: 'text',
                text: `[Failed to parse spreadsheet "${att.name}". The file may be corrupted.]`,
              });
            }
          }
        } else if (
          att.mediaType === 'image/jpeg' ||
          att.mediaType === 'image/png' ||
          att.mediaType === 'image/gif' ||
          att.mediaType === 'image/webp'
        ) {
          if (att.data.length > IMAGE_B64_LIMIT) {
            userContentBlocks.push({
              type: 'text',
              text: `[Attached image "${att.name}" (${(att.data.length * 0.75 / 1_048_576).toFixed(1)} MB) exceeds the 5 MB image limit and was not included.]`,
            });
          } else {
            userContentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: att.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: att.data,
              },
            });
          }
        }
      }
    }

    if (userMessage?.trim()) {
      userContentBlocks.push({ type: 'text', text: userMessage });
    }

    if (userContentBlocks.length === 0) {
      userContentBlocks.push({ type: 'text', text: '(attachment)' });
    }

    // Persist and append user message
    await this.messageRepo.save(
      this.messageRepo.create({
        conversationId,
        role: 'user',
        content: userContentBlocks,
      }),
    );
    messages.push({ role: 'user', content: userContentBlocks });

    // Mark cache breakpoints on message history for prompt caching.
    // Breakpoint 1: end of old history — cached between user turns so prior
    //   conversation context isn't re-processed on every new message.
    // Breakpoint 2: end of new user message — cached within the agent loop so
    //   iterations 1+ (after tool results) don't re-process the user turn.
    const newUserIdx = messages.length - 1;
    if (newUserIdx > 0) {
      const lastOld = messages[newUserIdx - 1];
      const blocks = Array.isArray(lastOld.content) ? lastOld.content : [];
      if (blocks.length > 0) {
        (blocks[blocks.length - 1] as any).cache_control = { type: 'ephemeral' };
      }
    }
    {
      const userBlocks = Array.isArray(userContentBlocks) ? userContentBlocks : [];
      if (userBlocks.length > 0) {
        (userBlocks[userBlocks.length - 1] as any).cache_control = { type: 'ephemeral' };
      }
    }

    let prevToolKey = '';
    let isFirstTurn = true;
    let firstAssistantText = '';

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // Stream from LLM provider — with one auto-heal retry on orphaned-tool errors
      let response: Anthropic.Beta.BetaMessage | undefined;
      let streamMessages = messages;

      // System prompt is stable across all requests — cache it.
      const system: Anthropic.Beta.BetaTextBlockParam[] = [
        {
          type: 'text',
          text: INVESTIGATOR_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ];

      for (let attempt = 0; attempt < 2; attempt++) {
        response = undefined;
        try {
          for await (const event of this.llm.streamChat({
            system,
            messages: streamMessages,
            tools: AGENT_TOOLS as Anthropic.Beta.BetaTool[],
            model,
          })) {
            if (event.type === 'text') {
              if (isFirstTurn) firstAssistantText += event.content;
              yield { type: 'text_delta', data: { content: event.content } };
            } else if (event.type === 'end_turn') {
              response = event.response;
            }
          }
          break; // success — exit retry loop
        } catch (err) {
          if (attempt === 0 && isOrphanedToolError(err)) {
            // Strip ALL server-side / code_execution blocks from history and retry
            streamMessages = streamMessages.map((m) => {
              if (!Array.isArray(m.content)) return m;
              const STRIP = new Set(['code_execution', 'code_execution_tool_result']);
              const kept = (m.content as any[]).filter((b) => !STRIP.has(b.type));
              return kept.length ? { ...m, content: kept } : m;
            }).filter((m) => {
              if (!Array.isArray(m.content)) return true;
              return (m.content as any[]).length > 0;
            });
            // Re-sanitize after stripping
            streamMessages = sanitizeToolPairs(streamMessages);
            yield { type: 'text_delta', data: { content: '' } }; // keep SSE alive
            continue;
          }
          throw err; // non-recoverable — re-throw
        }
      }

      if (!response) break;

      const responseContent =
        response.content as unknown as Anthropic.Beta.BetaContentBlock[];

      // Find user-defined tool calls (web_search is server-side, never appears here)
      const toolUseBlocks = responseContent.filter(
        (b) => b.type === 'tool_use',
      ) as Anthropic.ToolUseBlock[];

      if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
        await this.messageRepo.save(
          this.messageRepo.create({
            conversationId,
            role: 'assistant',
            content: responseContent,
          }),
        );

        if (isFirstTurn) {
          void this.generateTitle(
            conversationId,
            userMessage,
            firstAssistantText,
          );
        }

        yield { type: 'done', data: { conversationId } };
        return;
      }

      // Repeat-tool guard: break if same tools called with same inputs
      const toolKey = toolUseBlocks
        .map((b) => `${b.name}:${JSON.stringify(b.input)}`)
        .join('|');
      if (toolKey === prevToolKey) {
        yield { type: 'done', data: { conversationId } };
        return;
      }
      prevToolKey = toolKey;

      // Execute tools — keep full results in memory, slim versions for DB
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      const slimResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        yield { type: 'tool_start', data: { name: toolUse.name, input: toolUse.input } };

        const result = await this.executeTool(toolUse, caseId, investigationId);

        yield { type: 'tool_done', data: { name: toolUse.name } };

        if (toolUse.name === EXECUTE_SCRIPT_TOOL.name) {
          yield { type: 'graph_updated', data: {} };
        }

        const fullContent = JSON.stringify(result);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: fullContent,
        });
        slimResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: slimToolResult(toolUse.name, fullContent),
        });
      }

      // Save assistant message first, then slim tool results in a separate
      // save so each row gets a distinct created_at timestamp. Saving both
      // inside one transaction gives them the same PostgreSQL NOW() value,
      // making the ORDER BY created_at ASC retrieval non-deterministic and
      // causing orphaned tool_result errors on the next request.
      await this.messageRepo.save(
        this.messageRepo.create({
          conversationId,
          role: 'assistant',
          content: responseContent,
        }),
      );
      if (slimResults.length > 0) {
        await this.messageRepo.save(
          this.messageRepo.create({
            conversationId,
            role: 'user',
            content: slimResults,
          }),
        );
      }

      // In-memory history uses full results for the current agent loop
      messages.push({ role: 'assistant', content: responseContent });
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }

      isFirstTurn = false;
    }

    // Exhausted iterations
    yield { type: 'done', data: { conversationId } };
  }

  // ---- Tool dispatch ----

  private async executeTool(
    toolUse: Anthropic.ToolUseBlock,
    caseId?: string,
    investigationId?: string,
  ): Promise<unknown> {
    switch (toolUse.name) {
      case GET_CASE_DATA_TOOL.name: {
        if (!caseId) {
          return { error: 'No case context. Ask the user to select an investigation.' };
        }
        const toolInput = toolUse.input as { investigationId?: string };
        return this.executeCaseDataTool(
          caseId,
          investigationId ? { investigationId } : toolInput,
        );
      }

      case GET_SKILL_TOOL.name: {
        const { name } = toolUse.input as { name: string };
        return this.loadSkill(name);
      }

      case EXECUTE_SCRIPT_TOOL.name: {
        if (!investigationId) {
          return { error: 'No investigation context. Ask the user to select an investigation.' };
        }
        const { name, code } = toolUse.input as { name: string; code: string };
        return this.scriptExecutionService.execute(investigationId, name, code);
      }

      case LIST_SCRIPT_RUNS_TOOL.name: {
        if (!investigationId) {
          return { error: 'No investigation context. Ask the user to select an investigation.' };
        }
        const runs = await this.scriptExecutionService.listRuns(investigationId);
        return runs.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          durationMs: r.durationMs,
          createdAt: r.createdAt,
          output: r.output && r.output.length > 2000
            ? r.output.slice(0, 2000) + '\n...[truncated]'
            : r.output,
        }));
      }

      case QUERY_LABELED_ENTITIES_TOOL.name: {
        const input = toolUse.input as { address?: string; search?: string; category?: string };
        if (input.address) {
          return this.labeledEntitiesService.lookupByAddress(input.address);
        }
        const validCategories = new Set(Object.values(EntityCategory));
        const category = input.category && validCategories.has(input.category as EntityCategory)
          ? (input.category as EntityCategory)
          : undefined;
        return this.labeledEntitiesService.findAll({ category, search: input.search });
      }

      case CREATE_PRODUCTION_TOOL.name: {
        if (!caseId) {
          return { error: 'No case context. Ask the user to open a case.' };
        }
        const input = toolUse.input as { name: string; type: string; data: Record<string, unknown> };
        const validTypes = new Set(Object.values(ProductionType));
        if (!validTypes.has(input.type as ProductionType)) {
          return { error: `Invalid production type: ${input.type}` };
        }
        return this.productionsService.create(caseId, {
          name: input.name,
          type: input.type as ProductionType,
          data: input.data,
        });
      }

      case READ_PRODUCTION_TOOL.name: {
        const input = toolUse.input as { productionId?: string; type?: string };
        if (input.productionId) {
          return this.productionsService.findOne(input.productionId);
        }
        if (!caseId) {
          return { error: 'No case context. Ask the user to open a case.' };
        }
        const validTypes = new Set(Object.values(ProductionType));
        const type = input.type && validTypes.has(input.type as ProductionType)
          ? (input.type as ProductionType)
          : undefined;
        return this.productionsService.findAllForCase(caseId, undefined, type);
      }

      case UPDATE_PRODUCTION_TOOL.name: {
        const input = toolUse.input as { productionId: string; name?: string; data?: Record<string, unknown> };
        if (!input.productionId) {
          return { error: 'productionId is required' };
        }
        return this.productionsService.update(input.productionId, {
          name: input.name,
          data: input.data,
        });
      }

      default:
        return { error: `Unknown tool: ${toolUse.name}` };
    }
  }

  // ---- Tool implementations ----

  private async executeCaseDataTool(
    caseId: string,
    input: { investigationId?: string },
  ): Promise<unknown> {
    const where = input.investigationId
      ? { id: input.investigationId, caseId }
      : { caseId };

    const investigations = await this.investigationRepo.find({
      where,
      relations: ['traces'],
    });

    return investigations.map((inv) => ({
      id: inv.id,
      name: inv.name,
      notes: inv.notes,
      traces: inv.traces.map((t) => ({
        id: t.id,
        name: t.name,
        data: t.data,
      })),
    }));
  }

  private loadSkill(name: string): { content: string } | { error: string } {
    if (!(SKILL_NAMES as readonly string[]).includes(name)) {
      return { error: `Unknown skill: ${name}. Available: ${SKILL_NAMES.join(', ')}` };
    }
    const skillPath = path.join(__dirname, '..', '..', 'skills', `${name}.md`);
    try {
      const content = fs.readFileSync(skillPath, 'utf-8');
      return { content };
    } catch {
      return { error: `Failed to load skill file: ${name}` };
    }
  }

  private async generateTitle(
    conversationId: string,
    userMessage: string | undefined,
    assistantResponse: string,
  ): Promise<void> {
    try {
      const userPart = userMessage?.trim() || '(attachment)';
      const title = await this.llm.generateText({
        maxTokens: 20,
        messages: [
          {
            role: 'user',
            content: `Summarize this conversation exchange in 5 words or fewer. Return only the title, no punctuation.\n\nUser: ${userPart}\n\nAssistant: ${assistantResponse.slice(0, 500)}`,
          },
        ],
      });
      if (title) {
        await this.conversationsService.updateTitle(conversationId, title);
      }
    } catch {
      // Best-effort — title generation failure is non-fatal
    }
  }
}
