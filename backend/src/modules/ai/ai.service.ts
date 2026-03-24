import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { MessageEntity } from '../../database/entities/message.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { INVESTIGATOR_PROMPT } from '../../prompts/investigator';
import { ConversationsService } from './conversations.service';
import { ScriptExecutionService } from './services/script-execution.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import {
  AGENT_TOOLS,
  GET_CASE_DATA_TOOL,
  GET_SKILL_TOOL,
  EXECUTE_SCRIPT_TOOL,
  LIST_SCRIPT_RUNS_TOOL,
  SKILL_NAMES,
} from './tools';

/**
 * Ensures every tool_use in an assistant message has a matching tool_result in
 * the following user message, and vice-versa. Strips broken pairs so the API
 * never sees an orphaned tool_use or tool_result block.
 *
 * Broken pairs arise when:
 *  - Both rows were saved in the same DB transaction (same NOW() → unstable sort)
 *  - The compact-2026-01-12 beta summarised away a tool_use block but left its
 *    tool_result in the DB.
 */
function sanitizeToolPairs(
  messages: Anthropic.Beta.BetaMessageParam[],
): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const content = (Array.isArray(msg.content) ? msg.content : []) as any[];

    if (msg.role === 'assistant') {
      const toolUses = content.filter((b) => b.type === 'tool_use');

      if (toolUses.length > 0) {
        // Collect tool_result IDs from the immediately following user message
        const next = messages[i + 1];
        const nextContent = (next?.role === 'user' && Array.isArray(next.content)
          ? next.content
          : []) as any[];
        const resultIds = new Set(
          nextContent
            .filter((b) => b.type === 'tool_result')
            .map((b) => b.tool_use_id),
        );

        // Keep only tool_use blocks that have a matching result; keep all others
        const kept = content.filter(
          (b) => b.type !== 'tool_use' || resultIds.has(b.id),
        );
        if (kept.length === 0) continue; // skip empty assistant message
        out.push({ ...msg, content: kept });
        continue;
      }
    }

    if (msg.role === 'user') {
      const toolResults = content.filter((b) => b.type === 'tool_result');

      if (toolResults.length > 0) {
        // Collect tool_use IDs from the immediately preceding assistant message
        const prev = out[out.length - 1];
        const prevContent = (prev?.role === 'assistant' && Array.isArray(prev.content)
          ? prev.content
          : []) as any[];
        const useIds = new Set(
          prevContent.filter((b) => b.type === 'tool_use').map((b) => b.id),
        );

        // Keep only tool_results with a matching tool_use; keep all others
        const kept = content.filter(
          (b) => b.type !== 'tool_result' || useIds.has(b.tool_use_id),
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
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @InjectRepository(InvestigationEntity)
    private readonly investigationRepo: Repository<InvestigationEntity>,
  ) {}

  async *streamChat(
    conversationId: string,
    userMessage: string,
    caseId?: string,
    investigationId?: string,
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
    const messages = sanitizeToolPairs(rawMessages);

    // Persist and append user message
    await this.messageRepo.save(
      this.messageRepo.create({
        conversationId,
        role: 'user',
        content: [{ type: 'text', text: userMessage }],
      }),
    );
    messages.push({ role: 'user', content: [{ type: 'text', text: userMessage }] });

    let prevToolKey = '';
    let isFirstTurn = true;
    let firstAssistantText = '';

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      // Stream from LLM provider
      let response: Anthropic.Beta.BetaMessage | undefined;

      for await (const event of this.llm.streamChat({
        system: INVESTIGATOR_PROMPT,
        messages,
        tools: AGENT_TOOLS as Anthropic.Beta.BetaTool[],
      })) {
        if (event.type === 'text') {
          if (isFirstTurn) firstAssistantText += event.content;
          yield { type: 'text_delta', data: { content: event.content } };
        } else if (event.type === 'end_turn') {
          response = event.response;
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

      // Execute tools
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        yield { type: 'tool_start', data: { name: toolUse.name, input: toolUse.input } };

        const result = await this.executeTool(toolUse, caseId, investigationId);

        yield { type: 'tool_done', data: { name: toolUse.name } };

        if (toolUse.name === EXECUTE_SCRIPT_TOOL.name) {
          yield { type: 'graph_updated', data: {} };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      // Save assistant message first, then tool results in a separate save so
      // each row gets a distinct created_at timestamp. Saving both inside one
      // transaction gives them the same PostgreSQL NOW() value, making the
      // ORDER BY created_at ASC retrieval non-deterministic and causing
      // orphaned tool_result errors on the next request.
      await this.messageRepo.save(
        this.messageRepo.create({
          conversationId,
          role: 'assistant',
          content: responseContent,
        }),
      );
      if (toolResults.length > 0) {
        await this.messageRepo.save(
          this.messageRepo.create({
            conversationId,
            role: 'user',
            content: toolResults,
          }),
        );
      }

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
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    try {
      const title = await this.llm.generateText({
        maxTokens: 20,
        messages: [
          {
            role: 'user',
            content: `Summarize this conversation exchange in 5 words or fewer. Return only the title, no punctuation.\n\nUser: ${userMessage}\n\nAssistant: ${assistantResponse.slice(0, 500)}`,
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
