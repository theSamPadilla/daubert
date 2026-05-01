import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { MessageEntity } from '../../database/entities/message.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { TraceEntity } from '../../database/entities/trace.entity';
import { DataRoomConnectionEntity } from '../../database/entities/data-room-connection.entity';
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
  GET_INVESTIGATION_TOOL,
  GET_SKILL_TOOL,
  EXECUTE_SCRIPT_TOOL,
  LIST_SCRIPT_RUNS_TOOL,
  QUERY_LABELED_ENTITIES_TOOL,
  CREATE_PRODUCTION_TOOL,
  READ_PRODUCTION_TOOL,
  UPDATE_PRODUCTION_TOOL,
  SKILL_NAMES,
  getSkillContent,
} from './tools';
import { stripTraceForAgent, filterTraceData } from './investigation-data.utils';
import { AttachmentDto } from './dto/chat-message.dto';
import { buildAttachmentBlocks } from './attachment-blocks';

/**
 * Ensures every client tool_use block in an assistant message has a matching
 * tool_result in the following user message, and vice-versa. Strips broken
 * pairs so the API never sees orphaned blocks.
 *
 * Only client tools cross message boundaries. Server-side tools (web_search,
 * code_execution) pair within a single assistant message — both the
 * `server_tool_use` and its `*_tool_result` block live in the same assistant
 * turn — and must pass through this sanitizer untouched. Including them in
 * USE_TYPES caused server_tool_use blocks to be stripped (their results aren't
 * in the next user message), leaving orphaned web_search_tool_result blocks
 * that the API rejects with a 400.
 *
 * Broken cross-message pairs arise when:
 *  - Both rows were saved in the same DB transaction (same NOW() → unstable sort)
 *  - The compact-2026-01-12 beta summarised away a tool_use block but left its
 *    tool_result in the DB.
 */
function sanitizeToolPairs(
  messages: Anthropic.Beta.BetaMessageParam[],
): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];

  const USE_TYPES = new Set(['tool_use']);
  const RESULT_TYPES = new Set(['tool_result']);

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
 * Produce a compact version of a tool result for DB persistence.
 *
 * Only Production tools (create_production / read_production / update_production)
 * are slimmed: their payloads can be large documents/reports, and the production
 * itself is persisted in the DB — the model can re-read full data via
 * read_production if it later needs the body.
 *
 * Every other tool result (get_*, list_*, query_*, execute_*) is preserved
 * verbatim. Slimming retrieval results was misleading the agent: it would see
 * past summaries in conversation history and conclude that re-calling wouldn't
 * give more detail, even though the live tool returned the full data.
 */
function slimToolResult(toolName: string, full: string): string {
  if (
    toolName !== 'create_production' &&
    toolName !== 'read_production' &&
    toolName !== 'update_production'
  ) {
    return full;
  }

  // Strip the heavy `data` field from production payloads; keep id/name/type
  // metadata so the model can still reference the production by id later.
  try {
    const parsed = JSON.parse(full);
    const slimOne = (p: any) => ({ id: p?.id, name: p?.name, type: p?.type });
    if (Array.isArray(parsed)) return JSON.stringify(parsed.map(slimOne));
    if (parsed && typeof parsed === 'object') return JSON.stringify(slimOne(parsed));
  } catch { /* fall through */ }

  // Fallback: cap raw output at 3KB if shape was unexpected.
  if (full.length > 3000) return full.slice(0, 3000) + '...[truncated]';
  return full;
}

export interface SseEvent {
  type: 'text_delta' | 'tool_start' | 'tool_done' | 'graph_updated' | 'production_updated' | 'done' | 'error';
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
    @InjectRepository(TraceEntity)
    private readonly traceRepo: Repository<TraceEntity>,
    @InjectRepository(DataRoomConnectionEntity)
    private readonly dataRoomRepo: Repository<DataRoomConnectionEntity>,
  ) {}

  async *streamChat(
    conversationId: string,
    userId: string,
    userMessage: string | undefined,
    caseId?: string,
    investigationId?: string,
    attachments?: AttachmentDto[],
    model?: string,
  ): AsyncGenerator<SseEvent> {
    await this.conversationsService.findOne(conversationId, userId);

    // Load history and reconstruct MessageParam[] verbatim.
    // The Anthropic provider strips server-side and thinking blocks at the
    // stream layer, so persisted history is already clean of them.
    const dbMessages = await this.conversationsService.getMessages(conversationId, userId);
    const rawMessages: Anthropic.Beta.BetaMessageParam[] = dbMessages.map(
      (m) => ({ role: m.role, content: m.content }),
    ) as Anthropic.Beta.BetaMessageParam[];
    // Sanitize: remove orphaned tool_use / tool_result pairs that can arise
    // from same-transaction timestamps or compaction replacing old tool_use blocks.
    // Then merge any consecutive same-role messages (API requires alternating roles).
    const messages = mergeConsecutiveRoles(sanitizeToolPairs(rawMessages));

    // Build content blocks for the user turn — attachments are processed by
    // the shared helper so the same logic applies to chat uploads and (later)
    // Drive-tool reads.
    const attachmentBlocks = await buildAttachmentBlocks(attachments);
    const userContentBlocks: Anthropic.Beta.BetaContentBlockParam[] = [...attachmentBlocks];

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
      // Defensive: legacy DB rows persisted before the provider-layer strip
      // may still contain thinking blocks. The API rejects cache_control on them.
      for (let j = blocks.length - 1; j >= 0; j--) {
        const t = (blocks[j] as any).type;
        if (t !== 'thinking' && t !== 'redacted_thinking') {
          (blocks[j] as any).cache_control = { type: 'ephemeral' };
          break;
        }
      }
    }
    {
      const userBlocks = Array.isArray(userContentBlocks) ? userContentBlocks : [];
      if (userBlocks.length > 0) {
        (userBlocks[userBlocks.length - 1] as any).cache_control = { type: 'ephemeral' };
      }
    }

    // Fire title generation on the first message in a conversation.
    // Uses only the user message (no need to wait for assistant response).
    const isFirstMessage = dbMessages.length === 0;
    if (isFirstMessage) {
      void this.generateTitle(conversationId, userId, userMessage);
    }

    let prevToolKey = '';

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // System prompt is stable across all requests — cache it.
      const system: Anthropic.Beta.BetaTextBlockParam[] = [
        {
          type: 'text',
          text: INVESTIGATOR_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ];

      let response: Anthropic.Beta.BetaMessage | undefined;
      for await (const event of this.llm.streamChat({
        system,
        messages,
        tools: AGENT_TOOLS as Anthropic.Beta.BetaTool[],
        model,
      })) {
        if (event.type === 'text') {
          yield { type: 'text_delta', data: { content: event.content } };
        } else if (event.type === 'end_turn') {
          response = event.response;
        }
      }

      if (!response) break;

      // Provider already stripped server-side and thinking blocks.
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

        if (
          toolUse.name === CREATE_PRODUCTION_TOOL.name ||
          toolUse.name === UPDATE_PRODUCTION_TOOL.name
        ) {
          yield { type: 'production_updated', data: {} };
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
        return this.executeCaseDataTool(caseId);
      }

      case GET_INVESTIGATION_TOOL.name: {
        if (!caseId) {
          return { error: 'No case context. Ask the user to select an investigation.' };
        }
        const input = toolUse.input as {
          investigationId?: string;
          address?: string;
          token?: string;
        };
        return this.executeInvestigationTool(caseId, input, investigationId);
      }

      case GET_SKILL_TOOL.name: {
        const { name } = toolUse.input as { name: string };
        return this.loadSkill(name);
      }

      case EXECUTE_SCRIPT_TOOL.name: {
        if (!investigationId || !caseId) {
          return { error: 'No investigation context. Ask the user to select an investigation.' };
        }
        const { name, code } = toolUse.input as { name: string; code: string };
        return this.scriptExecutionService.execute(investigationId, caseId, name, code);
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
        return this.productionsService.create(
          caseId,
          { name: input.name, type: input.type as ProductionType, data: input.data },
          { kind: 'script', caseId },
        );
      }

      case READ_PRODUCTION_TOOL.name: {
        const input = toolUse.input as { productionId?: string; type?: string };
        if (!caseId) {
          return { error: 'No case context. Ask the user to open a case.' };
        }
        if (input.productionId) {
          return this.productionsService.findOne(input.productionId, { kind: 'script', caseId });
        }
        const validTypes = new Set(Object.values(ProductionType));
        const type = input.type && validTypes.has(input.type as ProductionType)
          ? (input.type as ProductionType)
          : undefined;
        return this.productionsService.findAllForCase(caseId, { kind: 'script', caseId }, type);
      }

      case UPDATE_PRODUCTION_TOOL.name: {
        if (!caseId) {
          return { error: 'No case context. Ask the user to open a case.' };
        }
        const input = toolUse.input as { productionId: string; name?: string; data?: Record<string, unknown> };
        if (!input.productionId) {
          return { error: 'productionId is required' };
        }
        return this.productionsService.update(
          input.productionId,
          { name: input.name, data: input.data },
          { kind: 'script', caseId },
        );
      }

      default:
        return { error: `Unknown tool: ${toolUse.name}` };
    }
  }

  // ---- Tool implementations ----

  private async executeCaseDataTool(caseId: string): Promise<unknown> {
    const investigations = await this.investigationRepo.find({
      where: { caseId },
      relations: ['traces'],
      order: { createdAt: 'ASC' },
    });

    const investigationSummaries = investigations.map((inv) => ({
      id: inv.id,
      name: inv.name,
      traceCount: inv.traces.length,
      totalNodes: inv.traces.reduce(
        (sum, t) => sum + ((t.data as any)?.nodes?.length || 0), 0,
      ),
      totalEdges: inv.traces.reduce(
        (sum, t) => sum + ((t.data as any)?.edges?.length || 0), 0,
      ),
    }));

    // Access already verified at conversation level; pass a script principal
    // bounded to this caseId — assertAccess just checks principal.caseId === caseId.
    const productions = await this.productionsService.findAllForCase(
      caseId,
      { kind: 'script', caseId },
    );
    const productionSummaries = (productions as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
    }));

    const drConn = await this.dataRoomRepo.findOneBy({ caseId });
    const dataRoom = drConn
      ? { connected: true, folderName: drConn.folderName, status: drConn.status }
      : { connected: false };

    return { investigations: investigationSummaries, productions: productionSummaries, dataRoom };
  }

  private async executeInvestigationTool(
    caseId: string,
    input: { investigationId?: string; address?: string; token?: string },
    contextInvestigationId?: string,
  ): Promise<unknown> {
    const invId = input.investigationId || contextInvestigationId;

    if (!invId) {
      const investigations = await this.investigationRepo.find({
        where: { caseId },
        relations: ['traces'],
        order: { createdAt: 'ASC' },
      });
      return investigations.map((inv) => ({
        id: inv.id,
        name: inv.name,
        notes: inv.notes,
        traces: inv.traces.map((t) => ({
          id: t.id,
          name: t.name,
          nodeCount: ((t.data as any)?.nodes?.length) || 0,
          edgeCount: ((t.data as any)?.edges?.length) || 0,
        })),
      }));
    }

    const investigation = await this.investigationRepo.findOne({
      where: { id: invId, caseId },
      relations: ['traces'],
    });
    if (!investigation) return { error: `Investigation ${invId} not found` };

    const traces = investigation.traces.map((t) => {
      const stripped = stripTraceForAgent(t.data);
      const filtered = filterTraceData(stripped, input.address, input.token);
      return { id: t.id, name: t.name, ...filtered };
    });

    return { id: investigation.id, name: investigation.name, notes: investigation.notes, traces };
  }

  private loadSkill(name: string): { content: string } | { error: string } {
    const content = getSkillContent(name);
    if (content === null) {
      return { error: `Unknown skill: ${name}. Available: ${SKILL_NAMES.join(', ')}` };
    }
    return { content };
  }

  private async generateTitle(
    conversationId: string,
    userId: string,
    userMessage: string | undefined,
  ): Promise<void> {
    try {
      const userPart = userMessage?.trim() || '(attachment)';
      if (userPart === '(attachment)') return; // nothing useful to title
      const title = await this.llm.generateText({
        maxTokens: 20,
        messages: [
          {
            role: 'user',
            content: `Generate a short title (5 words or fewer) for a conversation that starts with this message. Return only the title, no quotes or punctuation.\n\n${userPart}`,
          },
        ],
      });
      if (title) {
        // Hard cap at 30 chars — the chat header has limited space
        const truncated = title.length > 30 ? title.slice(0, 27) + '...' : title;
        await this.conversationsService.updateTitle(conversationId, userId, truncated);
      }
    } catch {
      // Best-effort — title generation failure is non-fatal
    }
  }
}
