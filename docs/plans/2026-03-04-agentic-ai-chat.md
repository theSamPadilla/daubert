# Agentic AI Chat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the placeholder AI chat endpoint with a full agentic system — persistent conversations scoped to Cases, SSE streaming, native Anthropic web search, a `get_case_data` tool for graph access, and server-side compaction.

**Architecture:** Backend-managed conversation history in Postgres (`conversations` + `messages` tables, content stored as raw Anthropic JSONB). A manual agentic loop (Stackpad-style) handles `get_case_data` tool calls; Anthropic's `web_search_20260209` runs entirely server-side. Compaction is handled natively via Anthropic's `compact-2026-01-12` beta. SSE streams `text_delta`, `tool_start`, `tool_done`, `done`, and `error` events.

**Tech Stack:** NestJS + TypeORM + Postgres, `@anthropic-ai/sdk` (already installed), SSE via raw Express response.

---

## Task 1: Create `ConversationEntity` and `MessageEntity`

**Files:**
- Create: `backend/src/database/entities/conversation.entity.ts`
- Create: `backend/src/database/entities/message.entity.ts`
- Modify: `backend/src/database/entities/case.entity.ts`

**Step 1: Create ConversationEntity**

```typescript
// backend/src/database/entities/conversation.entity.ts
import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CaseEntity } from './case.entity';
import { MessageEntity } from './message.entity';

@Entity('conversations')
export class ConversationEntity extends BaseEntity {
  @Column({ name: 'case_id' })
  caseId: string;

  @ManyToOne(() => CaseEntity, (c) => c.conversations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  @Column({ nullable: true, type: 'varchar' })
  title: string | null;

  @OneToMany(() => MessageEntity, (m) => m.conversation, { cascade: true })
  messages: MessageEntity[];
}
```

**Step 2: Create MessageEntity**

```typescript
// backend/src/database/entities/message.entity.ts
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ConversationEntity } from './conversation.entity';

export type MessageRole = 'user' | 'assistant';

@Entity('messages')
export class MessageEntity extends BaseEntity {
  @Column({ name: 'conversation_id' })
  conversationId: string;

  @ManyToOne(() => ConversationEntity, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: ConversationEntity;

  @Column({ type: 'varchar' })
  role: MessageRole;

  // Stores Anthropic ContentBlock[] verbatim — includes text, tool_use,
  // tool_result, thinking, and compaction blocks.
  @Column({ type: 'jsonb' })
  content: unknown[];
}
```

**Step 3: Add OneToMany to CaseEntity**

In `backend/src/database/entities/case.entity.ts`, add the import and relation:

```typescript
// Add to imports:
import { ConversationEntity } from './conversation.entity';

// Add inside CaseEntity class (after the investigations relation):
@OneToMany(() => ConversationEntity, (c) => c.case, { cascade: true })
conversations: ConversationEntity[];
```

**Step 4: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add backend/src/database/entities/conversation.entity.ts \
        backend/src/database/entities/message.entity.ts \
        backend/src/database/entities/case.entity.ts
git commit -m "feat: add ConversationEntity and MessageEntity"
```

---

## Task 2: DTOs

**Files:**
- Create: `backend/src/modules/ai/dto/create-conversation.dto.ts`
- Create: `backend/src/modules/ai/dto/chat-message.dto.ts`

**Step 1: Create DTOs**

```typescript
// backend/src/modules/ai/dto/create-conversation.dto.ts
import { IsUUID } from 'class-validator';

export class CreateConversationDto {
  @IsUUID()
  caseId: string;
}
```

```typescript
// backend/src/modules/ai/dto/chat-message.dto.ts
import { IsString, MinLength } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @MinLength(1)
  message: string;
}
```

**Step 2: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add backend/src/modules/ai/dto/
git commit -m "feat: add AI module DTOs"
```

---

## Task 3: System Prompt and Tool Definitions

**Files:**
- Create: `backend/src/modules/ai/prompts.ts`
- Create: `backend/src/modules/ai/tools.ts`

**Step 1: Create prompts.ts**

```typescript
// backend/src/modules/ai/prompts.ts
export const SYSTEM_PROMPT = `You are a blockchain forensics analyst embedded in Daubert, an investigation tool. You help investigators trace funds, identify wallet clusters, analyze transaction patterns, and surface on-chain and off-chain intelligence.

You have access to:
- web_search: search for information about addresses, contracts, entities, exploits, sanctions, and news
- get_case_data: fetch the investigation graph for this case (wallet nodes, transaction edges, traces)

Guidelines:
- Be concise and precise. Lead with findings, not process.
- When citing web search results, include source URLs.
- When referencing graph data, use specific addresses or transaction hashes.
- Flag mixer usage, CEX deposit patterns, tornado cash interactions, and known bad actors.
- If asked about a wallet or transaction not in the graph, use web_search to look it up.`.trim();
```

**Step 2: Create tools.ts**

```typescript
// backend/src/modules/ai/tools.ts
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
```

**Step 3: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add backend/src/modules/ai/prompts.ts backend/src/modules/ai/tools.ts
git commit -m "feat: add AI system prompt and tool definitions"
```

---

## Task 4: ConversationsService

**Files:**
- Create: `backend/src/modules/ai/conversations.service.ts`

**Step 1: Implement ConversationsService**

```typescript
// backend/src/modules/ai/conversations.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { CaseEntity } from '../../database/entities/case.entity';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @InjectRepository(CaseEntity)
    private readonly caseRepo: Repository<CaseEntity>,
  ) {}

  async create(caseId: string): Promise<ConversationEntity> {
    const c = await this.caseRepo.findOneBy({ id: caseId });
    if (!c) throw new NotFoundException(`Case ${caseId} not found`);
    const conversation = this.conversationRepo.create({ caseId, title: null });
    return this.conversationRepo.save(conversation);
  }

  async findAllForCase(caseId: string): Promise<ConversationEntity[]> {
    const c = await this.caseRepo.findOneBy({ id: caseId });
    if (!c) throw new NotFoundException(`Case ${caseId} not found`);
    return this.conversationRepo.find({
      where: { caseId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<ConversationEntity> {
    const conv = await this.conversationRepo.findOneBy({ id });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  async getMessages(conversationId: string): Promise<MessageEntity[]> {
    await this.findOne(conversationId); // validates existence
    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  async updateTitle(id: string, title: string): Promise<void> {
    await this.conversationRepo.update(id, { title });
  }
}
```

**Step 2: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add backend/src/modules/ai/conversations.service.ts
git commit -m "feat: add ConversationsService"
```

---

## Task 5: Rewrite AiService with Agentic Loop

**Files:**
- Modify: `backend/src/modules/ai/ai.service.ts`

This is the core implementation. The service:
1. Loads conversation history from DB, reconstructs `MessageParam[]` verbatim (preserves compaction blocks)
2. Appends the user message, persists to DB
3. Runs a streaming agentic loop (max 10 iterations):
   - Streams tokens → yields `text_delta` events
   - On `end_turn` or no tool calls → saves assistant message, yields `done`, breaks
   - On `get_case_data` tool call → executes, saves atomically, continues loop
   - Web search runs server-side; we never see tool_use blocks for it
4. Guards against infinite loops with repeat-tool detection
5. Fire-and-forgets a title generation (Haiku) after first response

**Step 1: Write the new AiService**

```typescript
// backend/src/modules/ai/ai.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { ConversationsService } from './conversations.service';
import { SYSTEM_PROMPT } from './prompts';
import { AGENT_TOOLS, GET_CASE_DATA_TOOL } from './tools';

export interface SseEvent {
  type: 'text_delta' | 'tool_start' | 'tool_done' | 'done' | 'error';
  data: unknown;
}

const MAX_ITERATIONS = 10;

@Injectable()
export class AiService {
  private client: Anthropic;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationsService: ConversationsService,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @InjectRepository(InvestigationEntity)
    private readonly investigationRepo: Repository<InvestigationEntity>,
  ) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    this.client = new Anthropic({ apiKey });
  }

  async *streamChat(
    conversationId: string,
    userMessage: string,
  ): AsyncGenerator<SseEvent> {
    const conversation =
      await this.conversationsService.findOne(conversationId);

    // Load history and reconstruct MessageParam[] verbatim.
    // Compaction blocks stored in assistant content are preserved automatically.
    const dbMessages = await this.conversationsService.getMessages(conversationId);
    const messages: Anthropic.Beta.BetaMessageParam[] = dbMessages.map(
      (m) => ({
        role: m.role,
        content: m.content as Anthropic.Beta.BetaContentBlockParam[],
      }),
    );

    // Persist and append user message
    await this.messageRepo.save(
      this.messageRepo.create({
        conversationId,
        role: 'user',
        content: [{ type: 'text', text: userMessage }],
      }),
    );
    messages.push({ role: 'user', content: userMessage });

    let prevToolKey = '';
    let isFirstTurn = true;
    let firstAssistantText = '';

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const stream = this.client.beta.messages.stream({
        betas: ['compact-2026-01-12'],
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        messages,
        tools: AGENT_TOOLS as Anthropic.Beta.BetaTool[],
        context_management: { edits: [{ type: 'compact_20260112' }] },
      } as Parameters<typeof this.client.beta.messages.stream>[0]);

      // Stream text tokens to client
      stream.on('text', (delta) => {
        if (isFirstTurn) firstAssistantText += delta;
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text_delta', data: { content: event.delta.text } };
        }
      }

      const response = await stream.finalMessage();
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

      // Execute user-defined tools
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        if (toolUse.name === GET_CASE_DATA_TOOL.name) {
          yield { type: 'tool_start', data: { name: toolUse.name, input: toolUse.input } };

          const result = await this.executeCaseDataTool(
            conversation.caseId,
            toolUse.input as { investigationId?: string },
          );

          yield { type: 'tool_done', data: { name: toolUse.name } };

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        }
      }

      // Atomic save: assistant message + tool results together.
      // Prevents orphaned tool_use blocks if the process dies mid-loop.
      await this.messageRepo.manager.transaction(async (manager) => {
        await manager.save(
          manager.create(MessageEntity, {
            conversationId,
            role: 'assistant',
            content: responseContent,
          }),
        );
        if (toolResults.length > 0) {
          await manager.save(
            manager.create(MessageEntity, {
              conversationId,
              role: 'user',
              content: toolResults,
            }),
          );
        }
      });

      messages.push({ role: 'assistant', content: responseContent });
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }

      isFirstTurn = false;
    }

    // Exhausted iterations
    yield { type: 'done', data: { conversationId } };
  }

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

  private generateTitle(
    conversationId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    const run = async () => {
      try {
        const response = await this.client.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 20,
          messages: [
            {
              role: 'user',
              content: `Summarize this conversation exchange in 5 words or fewer. Return only the title, no punctuation.\n\nUser: ${userMessage}\n\nAssistant: ${assistantResponse.slice(0, 500)}`,
            },
          ],
        });
        const title =
          response.content[0].type === 'text'
            ? response.content[0].text.trim()
            : null;
        if (title) {
          await this.conversationsService.updateTitle(conversationId, title);
        }
      } catch {
        // Best-effort — title generation failure is non-fatal
      }
    };
    return run();
  }
}
```

**Step 2: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors. If there are type errors on `client.beta.messages.stream()` params, add `as any` casts where noted and document them.

**Step 3: Commit**

```bash
git add backend/src/modules/ai/ai.service.ts
git commit -m "feat: rewrite AiService with agentic loop, web search, compaction"
```

---

## Task 6: ConversationsController

**Files:**
- Create: `backend/src/modules/ai/conversations.controller.ts`
- Modify: `backend/src/modules/ai/ai.controller.ts`

**Step 1: Create ConversationsController**

Routes:
- `POST /cases/:caseId/conversations` → create
- `GET /cases/:caseId/conversations` → list
- `GET /conversations/:id/messages` → get history
- `POST /conversations/:id/chat` → SSE stream

```typescript
// backend/src/modules/ai/conversations.controller.ts
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ConversationsService } from './conversations.service';
import { AiService } from './ai.service';
import { ChatMessageDto } from './dto/chat-message.dto';

@Controller()
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly aiService: AiService,
  ) {}

  @Post('cases/:caseId/conversations')
  create(@Param('caseId') caseId: string) {
    return this.conversationsService.create(caseId);
  }

  @Get('cases/:caseId/conversations')
  findAllForCase(@Param('caseId') caseId: string) {
    return this.conversationsService.findAllForCase(caseId);
  }

  @Get('conversations/:id/messages')
  getMessages(@Param('id') id: string) {
    return this.conversationsService.getMessages(id);
  }

  @Post('conversations/:id/chat')
  async chat(
    @Param('id') id: string,
    @Body() body: ChatMessageDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      for await (const event of this.aiService.streamChat(id, body.message)) {
        res.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.write(
        `event: error\ndata: ${JSON.stringify({ message })}\n\n`,
      );
    } finally {
      res.end();
    }
  }
}
```

**Step 2: Replace AiController**

The old `/ai/chat` placeholder is superseded. Replace it with a minimal stub so the file stays valid:

```typescript
// backend/src/modules/ai/ai.controller.ts
import { Controller } from '@nestjs/common';

@Controller('ai')
export class AiController {}
```

**Step 3: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add backend/src/modules/ai/conversations.controller.ts \
        backend/src/modules/ai/ai.controller.ts
git commit -m "feat: add ConversationsController with SSE chat endpoint"
```

---

## Task 7: Wire Up AiModule

**Files:**
- Modify: `backend/src/modules/ai/ai.module.ts`

**Step 1: Update AiModule**

```typescript
// backend/src/modules/ai/ai.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      CaseEntity,
      InvestigationEntity,
    ]),
  ],
  controllers: [AiController, ConversationsController],
  providers: [AiService, ConversationsService],
  exports: [AiService],
})
export class AiModule {}
```

**Step 2: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Start the backend and verify it boots**

```bash
cd backend && npm run start:dev
```

Expected: `Daubert backend running on http://localhost:8081` with no startup errors.

**Step 4: Smoke test — create a conversation**

```bash
curl -s -X POST http://localhost:8081/cases/<a-valid-case-id>/conversations | jq .
```

Expected: `{ "id": "...", "caseId": "...", "title": null, "createdAt": "...", "updatedAt": "..." }`

**Step 5: Commit**

```bash
git add backend/src/modules/ai/ai.module.ts
git commit -m "feat: wire AiModule with ConversationsService and entities"
```

---

## Task 8: Update OpenAPI Contracts

**Files:**
- Modify: `contracts/schemas/ai.yaml`
- Modify: `contracts/paths/ai.yaml`
- Modify: `contracts/openapi.yaml`

**Step 1: Update schemas/ai.yaml**

```yaml
# contracts/schemas/ai.yaml

Conversation:
  type: object
  required: [id, caseId, createdAt, updatedAt]
  properties:
    id:
      type: string
      format: uuid
    caseId:
      type: string
      format: uuid
    title:
      type: string
      nullable: true
    createdAt:
      type: string
      format: date-time
    updatedAt:
      type: string
      format: date-time

Message:
  type: object
  required: [id, conversationId, role, content, createdAt]
  properties:
    id:
      type: string
      format: uuid
    conversationId:
      type: string
      format: uuid
    role:
      type: string
      enum: [user, assistant]
    content:
      type: array
      items:
        type: object
    createdAt:
      type: string
      format: date-time

ChatRequest:
  type: object
  required: [message]
  properties:
    message:
      type: string
      minLength: 1

# SSE stream — documents the event types emitted on the chat endpoint.
# Actual response is text/event-stream, not JSON.
ChatSseEvent:
  type: object
  properties:
    type:
      type: string
      enum: [text_delta, tool_start, tool_done, done, error]
    data:
      type: object
```

**Step 2: Update paths/ai.yaml**

```yaml
# contracts/paths/ai.yaml

/cases/{caseId}/conversations:
  post:
    summary: Create a new conversation for a case
    operationId: createConversation
    tags: [AI]
    parameters:
      - name: caseId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    responses:
      '201':
        description: Conversation created
        content:
          application/json:
            schema:
              $ref: '../schemas/ai.yaml#/Conversation'
  get:
    summary: List conversations for a case
    operationId: listConversations
    tags: [AI]
    parameters:
      - name: caseId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    responses:
      '200':
        description: List of conversations
        content:
          application/json:
            schema:
              type: array
              items:
                $ref: '../schemas/ai.yaml#/Conversation'

/conversations/{id}/messages:
  get:
    summary: Get message history for a conversation
    operationId: getConversationMessages
    tags: [AI]
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    responses:
      '200':
        description: Message list
        content:
          application/json:
            schema:
              type: array
              items:
                $ref: '../schemas/ai.yaml#/Message'

/conversations/{id}/chat:
  post:
    summary: Send a message and receive an SSE stream
    operationId: chatStream
    tags: [AI]
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '../schemas/ai.yaml#/ChatRequest'
    responses:
      '200':
        description: SSE stream of chat events (text/event-stream)
        content:
          text/event-stream:
            schema:
              $ref: '../schemas/ai.yaml#/ChatSseEvent'
```

**Step 3: Update openapi.yaml**

Add these paths and remove the old `/ai/chat` entry. The full `paths:` section should become:

```yaml
paths:
  /cases:
    $ref: './paths/cases.yaml#/~1cases'
  /cases/{id}:
    $ref: './paths/cases.yaml#/~1cases~1{id}'
  /cases/{caseId}/investigations:
    $ref: './paths/investigations.yaml#/~1cases~1{caseId}~1investigations'
  /investigations/{id}:
    $ref: './paths/investigations.yaml#/~1investigations~1{id}'
  /investigations/{investigationId}/traces:
    $ref: './paths/traces.yaml#/~1investigations~1{investigationId}~1traces'
  /traces/{id}:
    $ref: './paths/traces.yaml#/~1traces~1{id}'
  /blockchain/fetch-history:
    $ref: './paths/blockchain.yaml#/~1blockchain~1fetch-history'
  /cases/{caseId}/conversations:
    $ref: './paths/ai.yaml#/~1cases~1{caseId}~1conversations'
  /conversations/{id}/messages:
    $ref: './paths/ai.yaml#/~1conversations~1{id}~1messages'
  /conversations/{id}/chat:
    $ref: './paths/ai.yaml#/~1conversations~1{id}~1chat'
```

Also add the new schemas to `components/schemas:`:

```yaml
    Conversation:
      $ref: './schemas/ai.yaml#/Conversation'
    Message:
      $ref: './schemas/ai.yaml#/Message'
    ChatRequest:
      $ref: './schemas/ai.yaml#/ChatRequest'
    ChatSseEvent:
      $ref: './schemas/ai.yaml#/ChatSseEvent'
```

**Step 4: Commit**

```bash
git add contracts/
git commit -m "feat: update OpenAPI contract for agentic chat endpoints"
```

---

## Task 9: Regenerate Types

**Step 1: Run codegen**

```bash
cd /path/to/daubert && npm run gen
```

Expected: `frontend/src/generated/api-types.ts` and `backend/src/generated/api-types.ts` regenerated without errors.

**Step 2: Type-check both sides**

```bash
cd backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add frontend/src/generated/ backend/src/generated/
git commit -m "chore: regenerate api-types after agentic chat contract update"
```

---

## Task 10: End-to-End Smoke Test

With the backend running (`npm run start:dev` in `/backend`):

**Step 1: Create a conversation**

```bash
CASE_ID=$(curl -s http://localhost:8081/cases | jq -r '.[0].id')
CONV_ID=$(curl -s -X POST http://localhost:8081/cases/$CASE_ID/conversations | jq -r '.id')
echo "Conversation: $CONV_ID"
```

**Step 2: Send a chat message and watch SSE events**

```bash
curl -s -N -X POST http://localhost:8081/conversations/$CONV_ID/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is Tornado Cash and why is it significant in blockchain forensics?"}'
```

Expected output: a stream of SSE events:
```
event: text_delta
data: {"content":"Tornado"}

event: text_delta
data: {"content":" Cash"}

... (more tokens)

event: done
data: {"conversationId":"<id>"}
```

**Step 3: Verify message was persisted**

```bash
curl -s http://localhost:8081/conversations/$CONV_ID/messages | jq 'length'
```

Expected: `2` (one user message, one assistant message).

**Step 4: Verify title was generated (wait ~5s)**

```bash
curl -s http://localhost:8081/cases/$CASE_ID/conversations | jq '.[0].title'
```

Expected: a short title string like `"Tornado Cash forensics overview"`.

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete agentic AI chat — conversations, SSE, web search, compaction"
```

---

## Reference: SSE Event Schema

| Event | Data shape | When |
|---|---|---|
| `text_delta` | `{ content: string }` | Each text token |
| `tool_start` | `{ name: string, input: object }` | `get_case_data` begins |
| `tool_done` | `{ name: string }` | `get_case_data` completes |
| `done` | `{ conversationId: string }` | Full response complete |
| `error` | `{ message: string }` | Any unhandled exception |

## Reference: Key Design Decisions

- **Raw JSONB content** — storing Anthropic `ContentBlock[]` verbatim means compaction blocks are naturally preserved and replayed. No special compaction handling needed.
- **Atomic transactions** — `tool_use` + `tool_result` messages saved together to prevent orphaned blocks that would break history replay on the next turn.
- **Repeat-tool guard** — hashing `name:input` detects if the model is stuck calling the same tool. Breaks the loop cleanly.
- **`web_search` is server-side** — it never produces a `tool_use` block in the response; we never see it in the agentic loop. Anthropic runs it transparently.
- **Fire-and-forget title** — title generation is async and non-blocking; failure is silently swallowed.
