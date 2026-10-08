# Durable Agent Runs Implementation Plan

**Goal:** Run each AI chat turn as a durable server-side run that doesn't depend on the browser's HTTP request, so long turns stop failing with 502s and dropped connections stop losing work.

## Summary

- **What & why:** Today a chat turn only lives as long as `POST /conversations/:id/chat`. Cloud Run cuts that request at 300s, and turns now take 5 to 16 minutes, so users get a 502. The agent loop then keeps running headless on throttled CPU, and the user's retry starts a second loop on the same conversation, which interleaves history writes and bills tokens twice (prod diagnosis, 2026-10-07). This plan turns each turn into a run. The POST creates the run and returns immediately. Cloud Tasks executes the run inside its own request. Events go to Postgres, and the browser follows them through a resumable stream.
- **Key product decisions:**
  - Closing the tab, losing Wi-Fi or a deploy no longer kills a response. Reopening the conversation reattaches to the running turn and replays its progress so far.
  - Stop really stops. The server halts the model, keeps the text already shown, and adds "(Stopped by user.)".
  - One response at a time per conversation. A second send gets "A response is already in progress in this conversation."
  - A single response is capped at 25 minutes (the longest observed today is about 16). At the cap it stops with "Send another message to continue."
  - If the last response failed or was interrupted, reopening the conversation shows a notice instead of silence.
- **Load-bearing architecture decisions:**
  - **Where runs execute:** Cloud Tasks dispatches each run to an OIDC-authenticated internal endpoint on the same Cloud Run service, and the turn runs inside that request. Cloud Run lets in-flight requests finish through deploys and scale-in, so runs survive both. That makes "CPU always allocated" unnecessary, which supersedes that part of option B. In dev, runs execute in-process.
  - **Postgres is the event bus:** `agent_runs` holds status, the heartbeat lease and the cancel flag. `agent_run_events` is an append-only log with a per-run `seq`. Subscribers poll every 300 ms and resume with `?after=<seq>`. No Redis or other new datastore. Text deltas are coalesced into 250 ms windows.
  - **Liveness:** the executor heartbeats every 3 s. A run silent for more than 60 s is swept to `interrupted` lazily: when a conversation is opened, when a new run starts, or while someone is subscribed. The sweep also repairs the "user(tool_result) tail" that otherwise blocks every later message.
  - **Compatibility:** the legacy `POST /chat` becomes a thin bridge onto runs so already-open tabs keep working. Delete it in a follow-up.
  - **Opus-tagged tasks** (highest risk): 4, 6, 8, 18.
- **Operator steps (you run these):** the Cloud Tasks queue, the service account, IAM, Cloud Run env vars and timeout, and the prod migration. See **Rollout runbook** at the end. These must be done before the backend change is pushed to `main`.

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task.
>
> **Repo rules (from CLAUDE.md):** never commit. Leave all changes in the working tree and run `git status` at the end of each task. Never apply migrations. Never add a `Co-Authored-By` trailer. Steps titled "Commit" in this plan mean **stage nothing, commit nothing**: just run `git status`.

## Atomized Changes

| # | Task | File | Action | Purpose |
|---|------|------|--------|---------|
| 1 | 1 | `backend/src/database/entities/agent-run.entity.ts` | Create | A turn becomes a durable row with a status, a lease and a cancel flag, and only one can be active per conversation |
| 2 | 1 | `backend/src/database/entities/agent-run-event.entity.ts` | Create | Append-only event log, so a browser can replay or resume a turn from any point |
| 3 | 1 | `backend/src/database/entities/index.ts` | Modify | Register both entities |
| 4 | 2 | `backend/src/database/migrations/<ts>-AddAgentRuns.ts` | Create (generated, not applied) | Prod schema for runs and events |
| 5 | 3 | `backend/src/modules/ai/providers/llm-provider.interface.ts`, `anthropic.provider.ts`, `anthropic.provider.spec.ts` (new) | Modify / Create | Model calls can be aborted (Stop, time limit) |
| 6 | 4 | `backend/src/modules/ai/runs/run-abort.ts` | Create | Shared abort reasons and stop-note copy |
| 7 | 4 | `backend/src/modules/ai/ai.service.ts`, `ai.service.spec.ts` | Modify | The agent loop runs from a persisted user message, honors abort, keeps partial text on Stop, and logs model-call timings |
| 8 | 5 | `backend/src/modules/ai/conversations.service.ts`, `conversations.service.spec.ts` | Modify | Repairs a wedged tool_result tail after a crashed run, and removes a message when launch is rolled back |
| 9 | 6 | `backend/src/modules/ai/runs/agent-runs.service.ts` | Create | Run state machine: create, claim, heartbeat, cancel, finish, sweep, event log |
| 10 | 6 | `backend/test/agent-runs.e2e-spec.ts` | Create | Proves the claim, the one-active-run index and the sweep against real Postgres |
| 11 | 6, 7 | `backend/src/modules/ai/runs/run-event-writer.ts`, `run-event-writer.spec.ts` | Create | Ordered event writes with text-delta coalescing |
| 12 | 8 | `backend/src/modules/ai/runs/agent-run-executor.service.ts`, `.spec.ts` | Create | Executes a run end to end, with heartbeat, cancel, time limit and terminal status |
| 13 | 9 | `backend/src/modules/ai/runs/dispatch/{agent-run-dispatcher,in-process.dispatcher,cloud-tasks.dispatcher,dispatcher.factory}.ts`, `dispatcher.factory.spec.ts` | Create | Cloud Tasks dispatch in prod, in-process in dev |
| 14 | 9 | `backend/src/config/env.validation.ts`, `env.validation.spec.ts`, `backend/.env.example` | Modify | Cloud Tasks config is required in prod |
| 15 | 9 | `backend/package.json`, `backend/package-lock.json` | Modify | Add `@google-cloud/tasks` and `google-auth-library` |
| 16 | 10 | `backend/src/modules/ai/runs/cloud-tasks-oidc.guard.ts`, `.spec.ts`, `agent-runs-internal.controller.ts` | Create | Internal execute endpoint that only Cloud Tasks can call |
| 17 | 11 | `backend/src/modules/ai/runs/agent-run-launcher.service.ts`, `.spec.ts`, `resolve-viewer-role.ts` | Create | Starting a run: persist the user message, then dispatch, rolling back on failure |
| 18 | 12 | `backend/src/modules/ai/runs/agent-run-events.streamer.ts`, `.spec.ts` | Create | Resumable SSE that survives Cloud Run timeouts by rotating subscriptions |
| 19 | 13 | `backend/src/modules/ai/runs/agent-runs.controller.ts`, `.spec.ts` | Create | `POST /runs`, `GET /runs/latest`, `GET /runs/:runId/events`, `POST /runs/:runId/cancel` |
| 20 | 13 | `backend/src/modules/ai/conversations.controller.ts` | Modify | Legacy `/chat` becomes a bridge onto runs, so stale tabs keep working |
| 21 | 13 | `backend/src/modules/ai/ai.module.ts` | Modify | Wire everything |
| 22 | 14 | `contracts/paths/ai.yaml`, `contracts/schemas/ai.yaml`, `contracts/openapi.yaml`, `{backend,frontend}/src/generated/api-types.ts` | Modify | Contract for the run endpoints. `ChatRequest` is synced with the DTO, and `/chat` is marked deprecated |
| 23 | 15 | `frontend/src/lib/sse.ts`, `sse.test.ts` | Create | Spec-correct SSE frame parser that reads `id:` |
| 24 | 16 | `frontend/src/lib/run-events.ts`, `run-events.test.ts` | Create | Follow a run with auto-reconnect from the last event |
| 25 | 16 | `frontend/src/lib/api-client.ts` | Modify | `startRun`, `getLatestRun`, `cancelRun` |
| 26 | 17 | `frontend/src/components/Workspace/chatTurn.ts`, `chatTurn.test.ts` | Create | Pure turn model, shared by live sends and reattach |
| 27 | 18 | `frontend/src/components/Workspace/AIChat.tsx` | Modify | Sends via runs, reattaches on open, Stop cancels on the server, shows failure notices |
| 28 | 19 | `docs/agent-runs.md` | Create | How runs work, plus the operational runbook |

## Engineering decisions (already made; flag any you disagree with)

- **Event retention:** when a new run starts, the events of earlier runs in that conversation are deleted, so storage is bounded per conversation. Messages remain the durable record.
- **Resume cursor:** `?after=<seq>` as a query param rather than the `Last-Event-ID` header, which avoids a CORS change.
- **Subscription rotation:** the server ends each subscription after 240 s and the client reconnects from its last `seq`. This is independent of the Cloud Run timeout.
- **Timing:** heartbeat every 3 s, a run is stale after 60 s without one, and a queued run is stale after 300 s. Cloud Tasks gets 5 attempts with 2 to 30 s backoff, and retries are safe because `claim` only moves a run out of `queued` once.
- **Abort granularity:** abort interrupts the model stream immediately. A tool batch that has started finishes first, so tool side effects are never half-done.
- **On abort, partial text is persisted** together with the stop note as one assistant row. That also terminates a tool_result tail.
- **Launch failures:** if the dispatch fails, the user message is deleted and the run is marked failed, returning 503. If persisting the user message fails, the original error is rethrown, so attachment validation messages reach the user.
- **Worker URL:** the run.app URL, not `api.dauberts.ai`, so no proxy sits between Cloud Tasks and the service.
- **Dedicated invoker service account** (`agent-runs-invoker`), so the OIDC check proves the caller is Cloud Tasks.
- **`error` events no longer replace partial text** in the UI. Partial text is kept and the error gets its own bubble. This changes today's behavior, where an error was dropped whenever text existed.

---

## Task 1: Run and event entities

**Implementer:** sonnet
**Files:** Create `backend/src/database/entities/agent-run.entity.ts`, `backend/src/database/entities/agent-run-event.entity.ts`. Modify `backend/src/database/entities/index.ts`.

**Step 1: Create `agent-run.entity.ts`**

```ts
import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ConversationEntity } from './conversation.entity';
import { CaseRole } from './case-member.entity';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'interrupted';

export type TerminalRunStatus = Exclude<AgentRunStatus, 'queued' | 'running'>;

export const ACTIVE_RUN_STATUSES: AgentRunStatus[] = ['queued', 'running'];

/** Name of the partial unique index; matched on unique-violation errors. */
export const ACTIVE_RUN_INDEX = 'uq_agent_runs_active_per_conversation';

export interface RunError {
  errorId: string;
  /** User-safe message, shown in the chat. */
  message: string;
}

/**
 * One agent turn, executed server-side independently of any browser request
 * (see docs/agent-runs.md). The partial unique index allows at most one
 * queued/running run per conversation.
 */
@Entity('agent_runs')
@Index(ACTIVE_RUN_INDEX, ['conversationId'], {
  unique: true,
  where: `"status" IN ('queued', 'running')`,
})
@Index('ix_agent_runs_conversation_created', ['conversationId', 'createdAt'])
export class AgentRunEntity extends BaseEntity {
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => ConversationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: ConversationEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', default: 'queued' })
  status: AgentRunStatus;

  /** The user row this run answers. Set by the launcher before dispatch. */
  @Column({ name: 'user_message_id', type: 'uuid', nullable: true })
  userMessageId: string | null;

  @Column({ name: 'case_id', type: 'uuid', nullable: true })
  caseId: string | null;

  @Column({ name: 'investigation_id', type: 'uuid', nullable: true })
  investigationId: string | null;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  /** Caller's case role when the run was started; picks the tool set. */
  @Column({ name: 'viewer_role', type: 'varchar' })
  viewerRole: CaseRole;

  @Column({ name: 'cancel_requested_at', type: 'timestamptz', nullable: true })
  cancelRequestedAt: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  /** Lease: the executor bumps this every few seconds while it is alive. */
  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  error: RunError | null;
}
```

**Step 2: Create `agent-run-event.entity.ts`**

```ts
import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { AgentRunEntity } from './agent-run.entity';

/**
 * Append-only event log for one agent run, replayed to subscribers in seq
 * order. seq is 1-based and assigned in application code by whoever owns the
 * run (the executor, or the sweeper once the executor is declared dead), so
 * the table needs no sequence. Events of earlier runs in a conversation are
 * deleted when a new run starts.
 */
@Entity('agent_run_events')
export class AgentRunEventEntity {
  @PrimaryColumn({ name: 'run_id', type: 'uuid' })
  runId: string;

  @PrimaryColumn({ type: 'int' })
  seq: number;

  @ManyToOne(() => AgentRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: AgentRunEntity;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ type: 'jsonb' })
  data: unknown;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

**Step 3: Register in `backend/src/database/entities/index.ts`.** Add the two imports next to the others and add `AgentRunEntity, AgentRunEventEntity` to the exported `entities` array, keeping its existing ordering style.

**Step 4: Type-check**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: exits 0.

**Step 5:** Run `git status`. Do not commit.

---

## Task 2: Generate the prod migration

**Implementer:** sonnet
**Files:** Create `backend/src/database/migrations/<timestamp>-AddAgentRuns.ts` (generated).

**Step 1: Generate it against prod (read-only diff)**

Run from the repo root: `./migrations.sh --prod --generate AddAgentRuns`
Expected: a new file `backend/src/database/migrations/<timestamp>-AddAgentRuns.ts`.

**Step 2: Review the generated file.** `up()` must contain only:
- `CREATE TABLE "agent_runs"` (with every column from Task 1)
- `CREATE TABLE "agent_run_events"` (composite PK `run_id, seq`)
- `CREATE UNIQUE INDEX "uq_agent_runs_active_per_conversation" ... WHERE "status" IN ('queued', 'running')`
- `CREATE INDEX "ix_agent_runs_conversation_created"`
- FK constraints `agent_runs.conversation_id -> conversations(id) ON DELETE CASCADE` and `agent_run_events.run_id -> agent_runs(id) ON DELETE CASCADE`

`down()` must reverse these in order. **If the generated file contains statements for any other table, stop and report them instead of editing them away.** That would mean prod has schema drift, and the user needs to decide what to do about it.

**Step 3: Do NOT run it.** The user applies migrations with `./migrations.sh --prod --run`.

**Step 4:** Run `git status`. Do not commit.

---

## Task 3: Abortable model calls

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/ai/providers/llm-provider.interface.ts` and `backend/src/modules/ai/providers/anthropic.provider.ts`. Create `backend/src/modules/ai/providers/anthropic.provider.spec.ts`.

**Step 1: Write the failing test** `anthropic.provider.spec.ts`

```ts
import { AnthropicProvider } from './anthropic.provider';

function fakeStream(finalMessage: any) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
    },
    finalMessage: jest.fn().mockResolvedValue(finalMessage),
  };
}

describe('AnthropicProvider.streamChat', () => {
  it('passes the abort signal to the SDK stream call', async () => {
    const provider = new AnthropicProvider({ get: () => 'sk-ant-test' } as any);
    const stream = jest.fn().mockReturnValue(fakeStream({ content: [], stop_reason: 'end_turn' }));
    (provider as any).client = { beta: { messages: { stream } } };
    const controller = new AbortController();

    const events: any[] = [];
    for await (const ev of provider.streamChat({ system: [], messages: [], tools: [], signal: controller.signal })) {
      events.push(ev);
    }

    expect(stream).toHaveBeenCalledWith(expect.any(Object), { signal: controller.signal });
    expect(events.map((e) => e.type)).toEqual(['text', 'end_turn']);
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `cd backend && npx jest src/modules/ai/providers/anthropic.provider.spec.ts`
Expected: FAIL, with a TypeScript error that `signal` does not exist in the params type, or with the `toHaveBeenCalledWith` mismatch.

**Step 3: Implement**

In `llm-provider.interface.ts`, add `signal?: AbortSignal;` to the `streamChat` params object:

```ts
  streamChat(params: {
    system: Anthropic.Beta.BetaTextBlockParam[];
    messages: Anthropic.Beta.BetaMessageParam[];
    tools: Anthropic.Beta.BetaTool[];
    model?: string;
    containerId?: string;
    /** Aborts the in-flight request (Stop, run time limit, lost lease). */
    signal?: AbortSignal;
  }): AsyncIterable<StreamEvent>;
```

In `anthropic.provider.ts`, add `signal?: AbortSignal;` to the same params type in `streamChat`, and pass request options as the second argument:

```ts
    const stream = this.client.beta.messages.stream(
      {
        betas: ['compact-2026-01-12', 'files-api-2025-04-14'],
        model: params.model ?? DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        system: params.system,
        messages: params.messages,
        tools: params.tools,
        ...(params.containerId ? { container: params.containerId } : {}),
      } as Parameters<typeof this.client.beta.messages.stream>[0],
      { signal: params.signal },
    );
```

**Step 4: Run the test and confirm it passes**

Run: `cd backend && npx jest src/modules/ai/providers/anthropic.provider.spec.ts`
Expected: PASS, 1 test.

**Step 5:** Run `git status`. Do not commit.

---

## Task 4: Agent loop runs from a persisted user message and honors abort

**Implementer:** opus. This is the core loop that every chat turn goes through, and the abort and terminator semantics are subtle.
**Files:** Create `backend/src/modules/ai/runs/run-abort.ts`. Modify `backend/src/modules/ai/ai.service.ts` (`SseEvent` ~line 300, `streamChat` lines 342-693) and `backend/src/modules/ai/ai.service.spec.ts`.

**Step 1: Create `backend/src/modules/ai/runs/run-abort.ts`**

```ts
/**
 * Why a run's AbortController fired. The executor calls
 * `controller.abort(reason)` and AiService.runTurn reads it back from
 * `signal.reason`.
 */
export type RunAbortReason = 'cancelled' | 'time_limit' | 'lease_lost';

export function abortReasonOf(signal: AbortSignal): RunAbortReason | null {
  if (!signal.aborted) return null;
  const r = signal.reason;
  return r === 'cancelled' || r === 'time_limit' || r === 'lease_lost' ? r : 'cancelled';
}

/** Appended to whatever text the user already saw when a run stops early. */
export const STOP_NOTES: Record<Exclude<RunAbortReason, 'lease_lost'>, string> = {
  cancelled: '(Stopped by user.)',
  time_limit:
    '(Stopped after reaching the time limit for one response. Send another message to continue.)',
};

/**
 * Persisted when a turn ends with a user(tool_result) tail. The compact beta
 * rejects a next user turn that mixes text into a tool-responding turn, so
 * leaving that tail wedges the conversation.
 */
export const TOOL_RESULT_TERMINATOR =
  '(Stopped before continuation. Send another message to resume.)';
```

**Step 2: Write the failing tests.** In `ai.service.spec.ts`:

(a) Update the two existing `streamChat` callers to the new API.
- **Token-usage metering test (~line 568):** change `mockConversationsService.getMessages.mockResolvedValue([])` to:
  ```ts
  mockConversationsService.getMessages.mockResolvedValue([
    { id: 'run-user-msg', role: 'user', content: [{ type: 'text', text: 'Hello AI' }] },
  ]);
  ```
  Replace the call with:
  ```ts
  for await (const ev of aiService.runTurn({
    conversationId: CONV_ID, userId: USER_ID, userMessageId: 'run-user-msg',
    caseId: CHAT_CASE_ID, investigationId: undefined, model: undefined,
    viewerRole: 'editor', signal: new AbortController().signal,
  }))
  ```
  Replace `expect(events.some((e) => e.type === 'done')).toBe(true);` with `expect(events.some((e) => e.type === 'done')).toBe(false);`. The executor now owns `done`.
- **Cache-breakpoint test (~line 749):** append `{ id: 'run-user-msg', role: 'user', content: [{ type: 'text', text: 'new question' }] }` as the third element of the `getMessages` mock. Change the call to `aiService.runTurn({ conversationId: 'conv-1', userId: 'user-1', userMessageId: 'run-user-msg', caseId: CASE_ID, investigationId: undefined, model: undefined, viewerRole: 'editor', signal: new AbortController().signal })`. All existing assertions stay unchanged.

(b) Add a new describe block at the end of the file. Copy the `beforeEach` from `describe('AiService — token usage metering')` verbatim, including the provider list and `aiService = module.get(AiService)`:

```ts
import { STOP_NOTES, TOOL_RESULT_TERMINATOR } from './runs/run-abort';

describe('AiService — runTurn lifecycle', () => {
  let aiService: AiService;
  // beforeEach: copy verbatim from 'AiService — token usage metering'

  const resp = (content: any[], stop_reason: string) => ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
    content, stop_reason, container: null,
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation: null },
  });
  const history = [
    { id: 'm1', role: 'user', content: [{ type: 'text', text: 'earlier question' }] },
    { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] },
    { id: 'run-user-msg', role: 'user', content: [{ type: 'text', text: 'new question' }] },
  ];
  const params = (signal: AbortSignal) => ({
    conversationId: 'conv-1', userId: 'user-1', userMessageId: 'run-user-msg',
    caseId: CASE_ID, investigationId: undefined, model: undefined,
    viewerRole: 'editor' as const, signal,
  });
  const drain = async (gen: AsyncGenerator<any>) => {
    const out: any[] = [];
    for await (const ev of gen) out.push(ev);
    return out;
  };

  beforeEach(() => {
    mockConversationRepo.findOne.mockResolvedValue({ id: 'conv-1', caseId: CASE_ID, case: { orgId: 'org-1' } });
    mockConversationsService.findOne.mockResolvedValue({ id: 'conv-1' });
    mockConversationsService.getMessages.mockResolvedValue(structuredClone(history));
    mockMessageRepo.create.mockImplementation((e: any) => e);
    mockMessageRepo.save.mockImplementation(async (e: any) => ({ id: 'saved', ...e }));
    mockTokenUsageService.record.mockResolvedValue(undefined);
  });

  it('sends prior history plus the run user message last, and does not re-persist it', async () => {
    const requests: any[] = [];
    mockAnthropicProvider.streamChat.mockImplementation((p: any) => {
      requests.push(p);
      return (async function* () { yield { type: 'end_turn', response: resp([{ type: 'text', text: 'ok' }], 'end_turn') }; })();
    });

    const events = await drain(aiService.runTurn(params(new AbortController().signal)));

    expect(requests[0].messages).toHaveLength(3);
    expect(requests[0].messages[2].content[0].text).toBe('new question');
    expect(mockMessageRepo.save).not.toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }));
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('passes the run signal to the provider', async () => {
    const controller = new AbortController();
    mockAnthropicProvider.streamChat.mockImplementation(() =>
      (async function* () { yield { type: 'end_turn', response: resp([{ type: 'text', text: 'ok' }], 'end_turn') }; })(),
    );
    await drain(aiService.runTurn(params(controller.signal)));
    expect(mockAnthropicProvider.streamChat).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });

  it('throws when the run user message is missing', async () => {
    mockConversationsService.getMessages.mockResolvedValue(history.slice(0, 2));
    await expect(drain(aiService.runTurn(params(new AbortController().signal)))).rejects.toThrow(/run-user-msg/);
  });

  it('persists partial text with the stop note when cancelled mid-response', async () => {
    const controller = new AbortController();
    mockAnthropicProvider.streamChat.mockImplementation(() =>
      (async function* () {
        yield { type: 'text', content: 'Partial' };
        controller.abort('cancelled');
        throw new Error('Request was aborted.');
      })(),
    );

    const events = await drain(aiService.runTurn(params(controller.signal)));

    expect(events).toEqual([{ type: 'text_delta', data: { content: 'Partial' } }]);
    expect(mockMessageRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({
      role: 'assistant',
      content: [{ type: 'text', text: `Partial\n\n${STOP_NOTES.cancelled}` }],
    }));
  });

  it('persists nothing when the lease is lost mid-response', async () => {
    const controller = new AbortController();
    mockAnthropicProvider.streamChat.mockImplementation(() =>
      (async function* () {
        yield { type: 'text', content: 'Partial' };
        controller.abort('lease_lost');
        throw new Error('Request was aborted.');
      })(),
    );
    await drain(aiService.runTurn(params(controller.signal)));
    expect(mockMessageRepo.save).not.toHaveBeenCalled();
  });

  it('stops between iterations with the time-limit note instead of the generic terminator', async () => {
    const controller = new AbortController();
    mockAnthropicProvider.streamChat.mockImplementation(() =>
      (async function* () {
        yield { type: 'end_turn', response: resp([{ type: 'tool_use', id: 'tu-1', name: 'get_case_data', input: {} }], 'tool_use') };
      })(),
    );
    jest.spyOn(aiService as any, 'executeTool').mockImplementation(async () => {
      controller.abort('time_limit');
      return { ok: true };
    });

    await drain(aiService.runTurn(params(controller.signal)));

    const saved = mockMessageRepo.save.mock.calls.map((c: any[]) => c[0]);
    expect(saved.map((r: any) => r.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(saved[2].content).toEqual([{ type: 'text', text: STOP_NOTES.time_limit }]);
    expect(JSON.stringify(saved)).not.toContain(TOOL_RESULT_TERMINATOR);
    expect(mockAnthropicProvider.streamChat).toHaveBeenCalledTimes(1);
  });

  it('persistUserMessage saves attachment blocks then text, or a placeholder', async () => {
    await aiService.persistUserMessage('conv-1', 'hello', undefined);
    expect(mockMessageRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({
      conversationId: 'conv-1', role: 'user', content: [{ type: 'text', text: 'hello' }],
    }));
    await aiService.persistUserMessage('conv-1', undefined, undefined);
    expect(mockMessageRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: '(attachment)' }],
    }));
  });
});
```

If `mockTokenUsageService`, `mockConversationRepo` or `CASE_ID` have different names in the file, use the existing names.

**Step 3: Run them and confirm they fail**

Run: `cd backend && npx jest src/modules/ai/ai.service.spec.ts`
Expected: FAIL, because `runTurn` and `persistUserMessage` do not exist.

**Step 4: Implement in `ai.service.ts`**

4a. Add this import:

```ts
import { abortReasonOf, STOP_NOTES, TOOL_RESULT_TERMINATOR } from './runs/run-abort';
```

4b. Below `slimToolResult` (before `export interface SseEvent`), add:

```ts
/** Plain text of a persisted user turn, for title generation. */
function textOf(content: unknown): string | undefined {
  const text = (content as Array<{ type?: string; text?: string }>)
    .filter((b) => b?.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .trim();
  return text || undefined;
}

export interface RunTurnParams {
  conversationId: string;
  userId: string;
  /** The user row the launcher persisted for this run; it is the conversation's newest row. */
  userMessageId: string;
  caseId: string | undefined;
  investigationId: string | undefined;
  model: string | undefined;
  viewerRole: CaseRole;
  /** Aborted by the executor; `signal.reason` is a RunAbortReason. */
  signal: AbortSignal;
}
```

4c. Add `persistUserMessage` directly above the current `streamChat`:

```ts
  /**
   * Build and persist the user turn for a new run. Attachments go through the
   * shared helper; an empty turn is stored as "(attachment)".
   */
  async persistUserMessage(
    conversationId: string,
    userMessage: string | undefined,
    attachments: AttachmentDto[] | undefined,
  ): Promise<MessageEntity> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(await buildAttachmentBlocks(attachments)),
    ];
    if (userMessage?.trim()) content.push({ type: 'text', text: userMessage });
    if (content.length === 0) content.push({ type: 'text', text: '(attachment)' });
    return this.messageRepo.save(
      this.messageRepo.create({ conversationId, role: 'user', content }),
    );
  }

  /**
   * Persist the text the user already saw plus a stop note, as one assistant
   * row. Returns false (nothing written) for a lost lease: the sweeper has
   * already closed the run and repaired the tail.
   */
  private async persistStopNote(
    conversationId: string,
    partialText: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const reason = abortReasonOf(signal);
    if (reason === null || reason === 'lease_lost') return false;
    const note = STOP_NOTES[reason];
    await this.messageRepo.save(
      this.messageRepo.create({
        conversationId,
        role: 'assistant',
        content: [{ type: 'text', text: partialText ? `${partialText}\n\n${note}` : note }],
      }),
    );
    return true;
  }
```

4d. Replace the whole `streamChat` method with `runTurn`. Everything not shown as changed below stays **verbatim** from the current `streamChat`: all comments, the prompt-cache section, the tool execution block, the save ordering, and `recordUsage` calls.

```ts
  async *runTurn(params: RunTurnParams): AsyncGenerator<SseEvent> {
    const { conversationId, userId, userMessageId, caseId, investigationId, model, viewerRole, signal } = params;
    await this.conversationsService.findOne(conversationId, userId);

    // (unchanged) convWithCase / resolvedCaseId / resolvedOrgId block

    // Load history and reconstruct MessageParam[] verbatim. The launcher
    // persisted this run's user message before dispatch, and only one run is
    // active per conversation, so that row is the newest: everything before
    // it is prior history.
    // The Anthropic provider strips server-side and thinking blocks at the
    // stream layer, so persisted history is already clean of them.
    const dbMessages = await this.conversationsService.getMessages(conversationId, userId);
    const userIdx = dbMessages.findIndex((m) => m.id === userMessageId);
    if (userIdx === -1) {
      throw new NotFoundException(
        `User message ${userMessageId} not found in conversation ${conversationId}`,
      );
    }
    const userRow = dbMessages[userIdx];
    const rawMessages: Anthropic.Beta.BetaMessageParam[] = dbMessages
      .slice(0, userIdx)
      .map((m) => ({ role: m.role, content: m.content })) as Anthropic.Beta.BetaMessageParam[];
    // (unchanged) the three-step "Sanitize, in order" comment
    const messages = mergeConsecutiveRoles(
      sanitizeToolPairs(dropOrphanServerToolResults(rawMessages)),
    );
    messages.push({
      role: 'user',
      content: userRow.content as Anthropic.Beta.BetaContentBlockParam[],
    });

    // (unchanged) prompt-cache breakpoints: newUserIdx, lastOld, tailBreakpoints, markTailBreakpoint

    // Fire title generation on the first message in a conversation.
    // Uses only the user message (no need to wait for assistant response).
    if (userIdx === 0) {
      void this.generateTitle(conversationId, userId, textOf(userRow.content));
    }

    // (unchanged) tools, prevToolKey, containerId, lastPersistedWasToolResult (+ their comments)

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        // Cancel or time limit landed between iterations. Tools run to
        // completion once started, so their side effects are never half-done.
        if (signal.aborted) {
          if (await this.persistStopNote(conversationId, '', signal)) {
            lastPersistedWasToolResult = false;
          }
          return;
        }

        markTailBreakpoint();

        // (unchanged) system prompt block

        let response: Anthropic.Beta.BetaMessage | undefined;
        // Text streamed by this call. Persisted with a stop note if the run is
        // aborted mid-response, so what the user saw survives a reload.
        let partialText = '';
        const callStartedAt = Date.now();
        try {
          for await (const event of this.llm.streamChat({
            system,
            messages,
            tools: tools as Anthropic.Beta.BetaTool[],
            model,
            containerId,
            signal,
          })) {
            if (event.type === 'text') {
              partialText += event.content;
              yield { type: 'text_delta', data: { content: event.content } };
            } else if (event.type === 'end_turn') {
              response = event.response;
            }
          }
        } catch (err) {
          if (!signal.aborted) throw err;
          if (await this.persistStopNote(conversationId, partialText, signal)) {
            lastPersistedWasToolResult = false;
          }
          return;
        }

        if (!response) break;

        this.logger.log(
          `turn_model_call conversationId=${conversationId} iteration=${i} stopReason=${response.stop_reason} durationMs=${Date.now() - callStartedAt}`,
        );

        // (unchanged) containerId capture, responseContent, toolUseBlocks

        if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
          // (unchanged) save assistant, recordUsage, non-end_turn warning + error yield
          // CHANGED: delete `yield { type: 'done', data: { conversationId } };`. The executor emits done.
          return;
        }

        // (unchanged) repeat-tool guard; inside it:
        //   CHANGED: delete `yield { type: 'done', data: { conversationId } };` and keep the `return;`.

        // (unchanged) tool execution, saves, in-memory history pushes
      }
      // CHANGED: delete the trailing `yield { type: 'done', data: { conversationId } };` after the loop.
    } finally {
      // A lost lease means the sweeper already declared this run dead and
      // repaired the tail; writing here would duplicate its terminator.
      if (lastPersistedWasToolResult && abortReasonOf(signal) !== 'lease_lost') {
        try {
          await this.messageRepo.save(
            this.messageRepo.create({
              conversationId,
              role: 'assistant',
              content: [{ type: 'text', text: TOOL_RESULT_TERMINATOR }],
            }),
          );
        } catch {
          // Best-effort — never mask the original error from the loop.
        }
      }
    }
  }
```

Also delete the user-message construction and persistence block that `streamChat` had: `buildAttachmentBlocks(attachments)` through `messages.push({ role: 'user', content: userContentBlocks })`. It now lives in `persistUserMessage`. Remove `const isFirstMessage = dbMessages.length === 0;`.

4e. Leave the `SseEvent` union unchanged. `done` is still a valid event type; the executor emits it.

**Step 5: Run the tests and confirm they pass**

Run: `cd backend && npx jest src/modules/ai/ai.service.spec.ts`
Expected: PASS for all tests, including the 7 new ones.

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: exactly one error, in `conversations.controller.ts`, about `streamChat` not existing. Task 13 fixes it. Any other error must be fixed now.

**Step 6:** Run `git status`. Do not commit.

---

## Task 5: Conversation helpers for runs

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/ai/conversations.service.ts` and `backend/src/modules/ai/conversations.service.spec.ts`.

**Step 1: Write the failing tests.** In `conversations.service.spec.ts`, extend `mockMessageRepo` to:

```ts
const mockMessageRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((e: any) => e),
  save: jest.fn(async (e: any) => e),
  delete: jest.fn(),
};
```

Then add the import at the top of the file, and nest the new `describe` **inside** the existing top-level `describe('ConversationsService', ...)` block (as its last child), so that it shares that block's `service` variable and its `beforeEach`, which already calls `jest.clearAllMocks()`:

```ts
import { TOOL_RESULT_TERMINATOR } from './runs/run-abort';

  // inside describe('ConversationsService', ...)
  describe('run helpers', () => {
  it('appends the terminator when the tail is a user turn of only tool_result blocks', async () => {
    mockMessageRepo.findOne.mockResolvedValue({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] });
    await service.appendTerminatorIfToolResultTail('conv-1');
    expect(mockMessageRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1', role: 'assistant', content: [{ type: 'text', text: TOOL_RESULT_TERMINATOR }],
    }));
  });

  it('does nothing when the tail is an assistant turn or a user text turn', async () => {
    mockMessageRepo.findOne.mockResolvedValueOnce({ role: 'assistant', content: [{ type: 'text', text: 'hi' }] });
    await service.appendTerminatorIfToolResultTail('conv-1');
    mockMessageRepo.findOne.mockResolvedValueOnce({ role: 'user', content: [{ type: 'text', text: 'q' }] });
    await service.appendTerminatorIfToolResultTail('conv-1');
    expect(mockMessageRepo.save).not.toHaveBeenCalled();
  });

  it('deleteMessage deletes only within the conversation', async () => {
    await service.deleteMessage('conv-1', 'msg-1');
    expect(mockMessageRepo.delete).toHaveBeenCalledWith({ id: 'msg-1', conversationId: 'conv-1' });
  });
  });
```

**Step 2: Run them and confirm they fail**

Run: `cd backend && npx jest src/modules/ai/conversations.service.spec.ts`
Expected: FAIL, because the methods do not exist.

**Step 3: Implement.** Add these to `ConversationsService`, and add `import { TOOL_RESULT_TERMINATOR } from './runs/run-abort';`:

```ts
  /**
   * Append the synthetic assistant terminator if the conversation ends in a
   * user turn made only of tool_result blocks. AiService.runTurn does this
   * itself when it exits cleanly; this covers runs that died without running
   * their finally block (see AgentRunsService.sweepStale).
   */
  async appendTerminatorIfToolResultTail(conversationId: string): Promise<void> {
    const last = await this.messageRepo.findOne({
      where: { conversationId },
      order: { createdAt: 'DESC' },
    });
    if (!last || last.role !== 'user') return;
    const blocks = last.content as Array<{ type?: string }>;
    if (blocks.length === 0 || !blocks.every((b) => b?.type === 'tool_result')) return;
    await this.messageRepo.save(
      this.messageRepo.create({
        conversationId,
        role: 'assistant',
        content: [{ type: 'text', text: TOOL_RESULT_TERMINATOR }],
      }),
    );
  }

  /** Remove one message. Used to roll back a run that could not be dispatched. */
  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    await this.messageRepo.delete({ id: messageId, conversationId });
  }
```

**Step 4: Run the tests and confirm they pass**

Run: `cd backend && npx jest src/modules/ai/conversations.service.spec.ts`
Expected: PASS.

**Step 5:** Run `git status`. Do not commit.

---

## Task 6: Run state machine (`AgentRunsService`) with a Postgres e2e test

**Implementer:** opus. The concurrency guarantees (single claim, one active run, sweep) all live in this SQL.
**Files:** Create `backend/src/modules/ai/runs/agent-runs.service.ts` and `backend/test/agent-runs.e2e-spec.ts`.

**Step 0: Make sure the dev DB has the new tables.** The e2e suite uses `synchronize: false`, so sync the dev schema from the entities first. `npm run be` won't compile at this point because of the known `conversations.controller.ts` error from Task 4, so use this instead (dev DB only; `npm run db` must be up):

```bash
cd backend && DATABASE_URL=postgresql://daubert:daubert@localhost:5455/daubert npx ts-node --transpile-only -e "require('./src/database/cli-data-source').AppDataSource.initialize().then(d => d.synchronize()).then(() => { console.log('synced'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"
```

Expected: prints `synced`.

**Step 1: Write the failing e2e test** `backend/test/agent-runs.e2e-spec.ts`

```ts
/**
 * E2E: AgentRunsService against real Postgres. Covers the guarantees that
 * only the database can enforce: one active run per conversation, a single
 * claim, conditional transitions, and the stale-run sweep.
 */
import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { entities } from '../src/database/entities';
import { AgentRunEntity } from '../src/database/entities/agent-run.entity';
import { AgentRunEventEntity } from '../src/database/entities/agent-run-event.entity';
import { CaseEntity } from '../src/database/entities/case.entity';
import { ConversationEntity } from '../src/database/entities/conversation.entity';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { UserEntity } from '../src/database/entities/user.entity';
import { AgentRunsService } from '../src/modules/ai/runs/agent-runs.service';
import { ConversationsService } from '../src/modules/ai/conversations.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://daubert:daubert@localhost:5455/daubert';

describe('AgentRunsService (e2e)', () => {
  let service: AgentRunsService;
  let runRepo: Repository<AgentRunEntity>;
  let eventRepo: Repository<AgentRunEventEntity>;
  let userRepo: Repository<UserEntity>;
  let orgRepo: Repository<OrganizationEntity>;
  let caseRepo: Repository<CaseEntity>;
  let convRepo: Repository<ConversationEntity>;
  let close: () => Promise<void>;
  const conversations = { appendTerminatorIfToolResultTail: jest.fn() };
  let userId: string;
  let orgId: string;
  let caseId: string;

  const newConversation = async () =>
    (await convRepo.save(convRepo.create({ caseId, userId, title: null }))).id;
  const queue = (conversationId: string) =>
    service.createQueued({ conversationId, userId, caseId, investigationId: null, model: null, viewerRole: 'editor' });
  const events = (runId: string) => eventRepo.find({ where: { runId }, order: { seq: 'ASC' } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        TypeOrmModule.forRoot({ type: 'postgres', url: process.env.DATABASE_URL, entities, synchronize: false, ssl: false }),
        TypeOrmModule.forFeature([AgentRunEntity, AgentRunEventEntity, UserEntity, OrganizationEntity, CaseEntity, ConversationEntity]),
      ],
      providers: [AgentRunsService, { provide: ConversationsService, useValue: conversations }],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    close = () => app.close();

    service = moduleRef.get(AgentRunsService);
    runRepo = moduleRef.get(getRepositoryToken(AgentRunEntity));
    eventRepo = moduleRef.get(getRepositoryToken(AgentRunEventEntity));
    userRepo = moduleRef.get(getRepositoryToken(UserEntity));
    orgRepo = moduleRef.get(getRepositoryToken(OrganizationEntity));
    caseRepo = moduleRef.get(getRepositoryToken(CaseEntity));
    convRepo = moduleRef.get(getRepositoryToken(ConversationEntity));

    const stamp = Date.now();
    userId = (await userRepo.save(userRepo.create({ name: 'E2E Runs', email: `e2e-runs-${stamp}@test.invalid`, firebaseUid: null }))).id;
    orgId = (await orgRepo.save(orgRepo.create({ name: 'E2E Runs Org', slug: `e2e-runs-${stamp}`, deletedAt: null }))).id;
    caseId = (await caseRepo.save(caseRepo.create({ name: 'E2E Runs Case', userId, orgId }))).id;
  }, 30_000);

  afterAll(async () => {
    if (caseId) await caseRepo.delete({ id: caseId }); // cascades conversations -> runs -> events
    if (orgId) await orgRepo.delete({ id: orgId });
    if (userId) await userRepo.delete({ id: userId });
    if (close) await close();
  }, 15_000);

  beforeEach(() => jest.clearAllMocks());

  it('allows only one active run per conversation', async () => {
    const conv = await newConversation();
    const first = await queue(conv);
    const second = queue(conv);
    await expect(second).rejects.toBeInstanceOf(ConflictException);
    await expect(second).rejects.toMatchObject({ response: { activeRunId: first.id } });
  });

  it('claims a queued run exactly once, and never without a user message', async () => {
    const conv = await newConversation();
    const run = await queue(conv);
    expect(await service.claim(run.id)).toBeNull(); // no user message yet
    await service.attachUserMessage(run.id, '00000000-0000-0000-0000-000000000001');
    const claimed = await service.claim(run.id);
    expect(claimed?.status).toBe('running');
    expect(await service.claim(run.id)).toBeNull();
  });

  it('heartbeat reports ok, then cancel_requested, then lost after finish', async () => {
    const conv = await newConversation();
    const run = await queue(conv);
    await service.attachUserMessage(run.id, '00000000-0000-0000-0000-000000000001');
    await service.claim(run.id);
    expect(await service.heartbeat(run.id)).toBe('ok');
    await service.requestCancel(run);
    expect(await service.heartbeat(run.id)).toBe('cancel_requested');
    await service.finish(run.id, 'cancelled', null);
    expect(await service.heartbeat(run.id)).toBe('lost');
    expect((await runRepo.findOneByOrFail({ id: run.id })).status).toBe('cancelled');
  });

  it('cancelling a queued run closes it with a done event', async () => {
    const conv = await newConversation();
    const run = await queue(conv);
    await service.requestCancel(run);
    expect((await runRepo.findOneByOrFail({ id: run.id })).status).toBe('cancelled');
    expect((await events(run.id)).map((e) => [e.seq, e.type, (e.data as any).status])).toEqual([[1, 'done', 'cancelled']]);
  });

  it('sweeps a run with a stale heartbeat to interrupted and repairs the tail', async () => {
    const conv = await newConversation();
    const run = await queue(conv);
    await service.attachUserMessage(run.id, '00000000-0000-0000-0000-000000000001');
    await service.claim(run.id);
    await service.appendEvents(run.id, [{ seq: 1, type: 'text_delta', data: { content: 'hi' } }]);
    await runRepo.query(`UPDATE agent_runs SET heartbeat_at = now() - interval '5 minutes' WHERE id = $1`, [run.id]);

    await service.sweepStale(conv);

    const swept = await runRepo.findOneByOrFail({ id: run.id });
    expect(swept.status).toBe('interrupted');
    expect(swept.error?.message).toMatch(/interrupted/i);
    expect((await events(run.id)).map((e) => e.type)).toEqual(['text_delta', 'error', 'done']);
    expect(conversations.appendTerminatorIfToolResultTail).toHaveBeenCalledWith(conv);
    // The active slot is free again.
    await expect(queue(conv)).resolves.toBeDefined();
  });

  it('leaves healthy runs alone', async () => {
    const conv = await newConversation();
    const run = await queue(conv);
    await service.attachUserMessage(run.id, '00000000-0000-0000-0000-000000000001');
    await service.claim(run.id);
    await service.sweepStale(conv);
    expect((await runRepo.findOneByOrFail({ id: run.id })).status).toBe('running');
  });

  it('starting a new run deletes the events of earlier runs in the conversation', async () => {
    const conv = await newConversation();
    const old = await queue(conv);
    await service.requestCancel(old); // writes a done event, frees the slot
    expect(await events(old.id)).toHaveLength(1);
    await queue(conv);
    expect(await events(old.id)).toHaveLength(0);
  });

  it('lists events after a cursor in order', async () => {
    const conv = await newConversation();
    const run = await queue(conv);
    await service.appendEvents(run.id, [1, 2, 3].map((seq) => ({ seq, type: 't', data: { seq } })));
    expect((await service.listEventsAfter(run.id, 1)).map((e) => e.seq)).toEqual([2, 3]);
  });

  it('findLatest returns the newest run and getStatus reads its status', async () => {
    const conv = await newConversation();
    const a = await queue(conv);
    await service.requestCancel(a);
    const b = await queue(conv);
    expect((await service.findLatest(conv))?.id).toBe(b.id);
    expect(await service.getStatus(a.id)).toBe('cancelled');
    expect(await service.findForConversation(b.id, conv)).not.toBeNull();
    expect(await service.findForConversation(b.id, '00000000-0000-0000-0000-000000000009')).toBeNull();
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `cd backend && npx jest test/agent-runs.e2e-spec.ts`
Expected: FAIL, because `agent-runs.service` cannot be found.

**Step 3: Implement** `backend/src/modules/ai/runs/agent-runs.service.ts`

```ts
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, QueryFailedError, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  ACTIVE_RUN_INDEX,
  ACTIVE_RUN_STATUSES,
  AgentRunEntity,
  AgentRunStatus,
  RunError,
  TerminalRunStatus,
} from '../../../database/entities/agent-run.entity';
import { AgentRunEventEntity } from '../../../database/entities/agent-run-event.entity';
import { CaseRole } from '../../../database/entities/case-member.entity';
import { ConversationsService } from '../conversations.service';
import { RunEventRow } from './run-event-writer';

/** A running run whose heartbeat is older than this is considered dead. */
export const STALE_HEARTBEAT_SECONDS = 60;
/** A queued run Cloud Tasks never delivered within this window is abandoned. */
export const STALE_QUEUED_SECONDS = 300;

export const INTERRUPTED_MESSAGE =
  'This response was interrupted before it finished. Send another message to continue.';

export type HeartbeatState = 'ok' | 'cancel_requested' | 'lost';

export interface CreateRunInput {
  conversationId: string;
  userId: string;
  caseId: string | null;
  investigationId: string | null;
  model: string | null;
  viewerRole: CaseRole;
}

/**
 * Persistence and state transitions for agent runs. Every transition is a
 * conditional UPDATE on the current status, so concurrent actors (the
 * executor, a Cloud Tasks retry, the sweeper, a cancel) can't both win.
 */
@Injectable()
export class AgentRunsService {
  private readonly logger = new Logger(AgentRunsService.name);

  constructor(
    @InjectRepository(AgentRunEntity)
    private readonly runRepo: Repository<AgentRunEntity>,
    @InjectRepository(AgentRunEventEntity)
    private readonly eventRepo: Repository<AgentRunEventEntity>,
    private readonly conversationsService: ConversationsService,
  ) {}

  /**
   * Insert a queued run. Sweeps dead runs first so a crashed run never blocks
   * the conversation. Throws 409 (with the active run id) if a run is live.
   */
  async createQueued(input: CreateRunInput): Promise<AgentRunEntity> {
    await this.sweepStale(input.conversationId);
    let run: AgentRunEntity;
    try {
      run = await this.runRepo.save(this.runRepo.create({ ...input, status: 'queued' }));
    } catch (err) {
      if (!isActiveRunConflict(err)) throw err;
      const active = await this.findActive(input.conversationId);
      throw new ConflictException({
        message: 'A response is already in progress in this conversation.',
        activeRunId: active?.id ?? null,
      });
    }
    // Earlier runs' events are no longer needed: their messages are persisted.
    await this.eventRepo
      .createQueryBuilder()
      .delete()
      .where(
        'run_id IN (SELECT id FROM agent_runs WHERE conversation_id = :conversationId AND id <> :runId)',
        { conversationId: input.conversationId, runId: run.id },
      )
      .execute();
    return run;
  }

  async attachUserMessage(runId: string, userMessageId: string): Promise<void> {
    await this.runRepo.update({ id: runId }, { userMessageId });
  }

  /** Close a run that never started (launch rollback). */
  async failQueued(run: AgentRunEntity, error: RunError): Promise<void> {
    const res = await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ status: 'failed', error, finishedAt: () => 'now()' })
      .where('id = :id AND status = :status', { id: run.id, status: 'queued' })
      .execute();
    if (res.affected) await this.appendTerminalEvents(run, 'failed', error.message);
  }

  /** queued -> running. Returns null if another delivery already claimed it. */
  async claim(runId: string): Promise<AgentRunEntity | null> {
    const res = await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ status: 'running', startedAt: () => 'now()', heartbeatAt: () => 'now()' })
      .where('id = :id AND status = :status AND user_message_id IS NOT NULL', {
        id: runId,
        status: 'queued',
      })
      .execute();
    if (!res.affected) return null;
    return this.runRepo.findOneByOrFail({ id: runId });
  }

  /** Renew the lease. 'lost' means the run is no longer running (swept or finished). */
  async heartbeat(runId: string): Promise<HeartbeatState> {
    const res = await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ heartbeatAt: () => 'now()' })
      .where('id = :id AND status = :status', { id: runId, status: 'running' })
      .returning('cancel_requested_at')
      .execute();
    if (!res.affected) return 'lost';
    return res.raw?.[0]?.cancel_requested_at ? 'cancel_requested' : 'ok';
  }

  /**
   * A queued run is cancelled on the spot (its task becomes a no-op). A running
   * run gets a flag the executor picks up on its next heartbeat.
   */
  async requestCancel(run: AgentRunEntity): Promise<void> {
    const queued = await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ status: 'cancelled', finishedAt: () => 'now()' })
      .where('id = :id AND status = :status', { id: run.id, status: 'queued' })
      .execute();
    if (queued.affected) {
      await this.appendTerminalEvents(run, 'cancelled');
      return;
    }
    await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ cancelRequestedAt: () => 'now()' })
      .where('id = :id AND status = :status AND cancel_requested_at IS NULL', {
        id: run.id,
        status: 'running',
      })
      .execute();
  }

  async finish(runId: string, status: TerminalRunStatus, error: RunError | null): Promise<void> {
    await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ status, error, finishedAt: () => 'now()' })
      .where('id = :id AND status = :status', { id: runId, status: 'running' })
      .execute();
  }

  /**
   * Mark this conversation's dead runs as interrupted: running with a stale
   * heartbeat, or queued and never delivered. Closes each with error + done
   * events and repairs a dangling tool_result tail. Called lazily (on start,
   * on open, and while a subscriber waits) instead of from a cron.
   */
  async sweepStale(conversationId: string): Promise<void> {
    const errorId = randomUUID();
    const res = await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({
        status: 'interrupted',
        finishedAt: () => 'now()',
        error: { errorId, message: INTERRUPTED_MESSAGE },
      })
      .where(
        `conversation_id = :conversationId AND (
           (status = 'running' AND COALESCE(heartbeat_at, started_at) < now() - interval '${STALE_HEARTBEAT_SECONDS} seconds')
           OR (status = 'queued' AND created_at < now() - interval '${STALE_QUEUED_SECONDS} seconds')
         )`,
        { conversationId },
      )
      // Array form takes entity property paths; raw rows still come back snake_case.
      .returning(['id', 'conversationId'])
      .execute();
    const swept = (res.raw ?? []) as Array<{ id: string; conversation_id: string }>;
    if (swept.length === 0) return;

    for (const row of swept) {
      this.logger.warn(`run_interrupted runId=${row.id} conversationId=${row.conversation_id} errorId=${errorId}`);
      try {
        await this.appendTerminalEvents(
          { id: row.id, conversationId: row.conversation_id },
          'interrupted',
          INTERRUPTED_MESSAGE,
        );
      } catch (err) {
        // A zombie executor may have raced us for the next seq. The run is
        // already terminal; streamers fall back to a synthetic done.
        this.logger.warn(`run_interrupted_events_failed runId=${row.id}: ${String(err)}`);
      }
    }
    await this.conversationsService.appendTerminatorIfToolResultTail(conversationId);
  }

  findActive(conversationId: string): Promise<AgentRunEntity | null> {
    return this.runRepo.findOne({ where: { conversationId, status: In(ACTIVE_RUN_STATUSES) } });
  }

  findLatest(conversationId: string): Promise<AgentRunEntity | null> {
    return this.runRepo.findOne({ where: { conversationId }, order: { createdAt: 'DESC' } });
  }

  findForConversation(runId: string, conversationId: string): Promise<AgentRunEntity | null> {
    return this.runRepo.findOne({ where: { id: runId, conversationId } });
  }

  async getStatus(runId: string): Promise<AgentRunStatus | null> {
    const run = await this.runRepo.findOne({ where: { id: runId }, select: ['id', 'status'] });
    return run?.status ?? null;
  }

  async appendEvents(runId: string, rows: RunEventRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.eventRepo.insert(rows.map((r) => ({ runId, seq: r.seq, type: r.type, data: r.data as object })));
  }

  listEventsAfter(runId: string, after: number, limit = 500): Promise<AgentRunEventEntity[]> {
    return this.eventRepo.find({
      where: { runId, seq: MoreThan(after) },
      order: { seq: 'ASC' },
      take: limit,
    });
  }

  private async appendTerminalEvents(
    run: { id: string; conversationId: string },
    status: TerminalRunStatus,
    errorMessage?: string,
  ): Promise<void> {
    const raw = await this.eventRepo
      .createQueryBuilder('e')
      .select('COALESCE(MAX(e.seq), 0)', 'max')
      .where('e.run_id = :runId', { runId: run.id })
      .getRawOne<{ max: number | string }>();
    let seq = Number(raw?.max ?? 0);
    const rows: RunEventRow[] = [];
    if (errorMessage) rows.push({ seq: ++seq, type: 'error', data: { message: errorMessage } });
    rows.push({ seq: ++seq, type: 'done', data: { conversationId: run.conversationId, status } });
    await this.appendEvents(run.id, rows);
  }
}

function isActiveRunConflict(err: unknown): boolean {
  const driver = (err as { driverError?: { code?: string; constraint?: string } })?.driverError;
  return err instanceof QueryFailedError && driver?.code === '23505' && driver?.constraint === ACTIVE_RUN_INDEX;
}
```

This imports `RunEventRow` from `./run-event-writer`, which Task 7 creates. To let this task compile on its own, create `backend/src/modules/ai/runs/run-event-writer.ts` now with only:

```ts
export interface RunEventRow {
  seq: number;
  type: string;
  data: unknown;
}
```

Task 7 then fills in the rest of the file.

**Step 4: Run it and confirm it passes**

Run: `cd backend && npx jest test/agent-runs.e2e-spec.ts`
Expected: PASS, 9 tests.

**Step 5:** Run `git status`. Do not commit.

---

## Task 7: Ordered, coalescing event writer

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/ai/runs/run-event-writer.ts` (created as a stub in Task 6). Create `backend/src/modules/ai/runs/run-event-writer.spec.ts`.

**Step 1: Write the failing test** `run-event-writer.spec.ts`

```ts
import { RunEventRow, RunEventWriter } from './run-event-writer';

describe('RunEventWriter', () => {
  let written: RunEventRow[][];
  let writer: RunEventWriter;

  beforeEach(() => {
    jest.useFakeTimers();
    written = [];
    writer = new RunEventWriter(async (rows) => { written.push(rows); }, 250);
  });
  afterEach(() => jest.useRealTimers());

  it('coalesces consecutive text deltas into one row per window', async () => {
    await writer.push({ type: 'text_delta', data: { content: 'Hel' } });
    await writer.push({ type: 'text_delta', data: { content: 'lo' } });
    expect(written).toEqual([]);
    await jest.advanceTimersByTimeAsync(250);
    expect(written).toEqual([[{ seq: 1, type: 'text_delta', data: { content: 'Hello' } }]]);
  });

  it('flushes pending text before any other event, preserving order', async () => {
    await writer.push({ type: 'text_delta', data: { content: 'a' } });
    await writer.push({ type: 'tool_start', data: { name: 'x' } });
    expect(written).toEqual([[
      { seq: 1, type: 'text_delta', data: { content: 'a' } },
      { seq: 2, type: 'tool_start', data: { name: 'x' } },
    ]]);
  });

  it('flush() writes pending text', async () => {
    await writer.push({ type: 'text_delta', data: { content: 'tail' } });
    await writer.flush();
    expect(written.flat().map((r) => r.data)).toEqual([{ content: 'tail' }]);
  });

  it('surfaces an append failure on the next push', async () => {
    writer = new RunEventWriter(async () => { throw new Error('db down'); }, 250);
    await expect(writer.push({ type: 'tool_start', data: {} })).rejects.toThrow('db down');
    await expect(writer.push({ type: 'tool_done', data: {} })).rejects.toThrow('db down');
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `cd backend && npx jest src/modules/ai/runs/run-event-writer.spec.ts`
Expected: FAIL, because `RunEventWriter` is not exported.

**Step 3: Implement.** Replace `run-event-writer.ts` with:

```ts
import type { SseEvent } from '../ai.service';

export interface RunEventRow {
  seq: number;
  type: string;
  data: unknown;
}

/**
 * Assigns seq numbers and appends a run's events in order. text_delta events
 * are coalesced into one row per flush window so a long response doesn't cost
 * one insert per token. Any other event flushes pending text first, so the
 * log order matches what the model produced.
 */
export class RunEventWriter {
  private seq = 0;
  private pendingText = '';
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();
  private failure: unknown = null;

  constructor(
    private readonly append: (rows: RunEventRow[]) => Promise<void>,
    private readonly flushMs = 250,
  ) {}

  async push(event: SseEvent): Promise<void> {
    this.throwIfFailed();
    if (event.type === 'text_delta') {
      this.pendingText += (event.data as { content?: string })?.content ?? '';
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.write([]).catch(() => {
            // Recorded in this.failure; the next push/flush rethrows it.
          });
        }, this.flushMs);
      }
      return;
    }
    await this.write([{ type: event.type, data: event.data }]);
  }

  async flush(): Promise<void> {
    this.throwIfFailed();
    await this.write([]);
  }

  private write(events: Array<{ type: string; data: unknown }>): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch: Array<{ type: string; data: unknown }> = [];
    if (this.pendingText) {
      batch.push({ type: 'text_delta', data: { content: this.pendingText } });
      this.pendingText = '';
    }
    batch.push(...events);
    if (batch.length === 0) return this.chain;
    const rows = batch.map((e) => ({ seq: ++this.seq, type: e.type, data: e.data }));
    this.chain = this.chain
      .then(() => this.append(rows))
      .catch((err) => {
        this.failure = err;
        throw err;
      });
    return this.chain;
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure;
  }
}
```

**Step 4: Run it and confirm it passes**

Run: `cd backend && npx jest src/modules/ai/runs/run-event-writer.spec.ts`
Expected: PASS, 4 tests.

**Step 5:** Run `git status`. Do not commit.

---

## Task 8: Run executor

**Implementer:** opus. It handles lifecycle, abort routing, the terminal-status contract and error logging.
**Files:** Create `backend/src/modules/ai/runs/agent-run-executor.service.ts` and `backend/src/modules/ai/runs/agent-run-executor.service.spec.ts`.

**Step 1: Write the failing test** `agent-run-executor.service.spec.ts`

```ts
import { AgentRunExecutor, HEARTBEAT_MS, RUN_TIME_LIMIT_MS } from './agent-run-executor.service';

const RUN = {
  id: 'run-1', conversationId: 'conv-1', userId: 'user-1', userMessageId: 'msg-1',
  caseId: 'case-1', investigationId: null, model: null, viewerRole: 'editor',
};

describe('AgentRunExecutor', () => {
  let runs: any;
  let ai: any;
  let executor: AgentRunExecutor;
  let appended: any[];

  beforeEach(() => {
    jest.useFakeTimers();
    appended = [];
    runs = {
      claim: jest.fn().mockResolvedValue(RUN),
      heartbeat: jest.fn().mockResolvedValue('ok'),
      appendEvents: jest.fn(async (_id: string, rows: any[]) => { appended.push(...rows); }),
      finish: jest.fn().mockResolvedValue(undefined),
    };
    ai = { runTurn: jest.fn() };
    executor = new AgentRunExecutor(runs, ai);
  });
  afterEach(() => jest.useRealTimers());

  const types = () => appended.map((r) => r.type);
  const waitForAbort = (signal: AbortSignal) =>
    new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));

  it('does nothing when the run cannot be claimed', async () => {
    runs.claim.mockResolvedValue(null);
    await executor.execute('run-1');
    expect(ai.runTurn).not.toHaveBeenCalled();
    expect(runs.finish).not.toHaveBeenCalled();
  });

  it('writes events then done and finishes as succeeded', async () => {
    ai.runTurn.mockImplementation(async function* () {
      yield { type: 'tool_start', data: { name: 'x' } };
      yield { type: 'tool_done', data: { name: 'x' } };
    });
    await executor.execute('run-1');
    expect(types()).toEqual(['tool_start', 'tool_done', 'done']);
    expect(appended.at(-1).data).toEqual({ conversationId: 'conv-1', status: 'succeeded' });
    expect(runs.finish).toHaveBeenCalledWith('run-1', 'succeeded', null);
    expect(ai.runTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1', userId: 'user-1', userMessageId: 'msg-1', caseId: 'case-1',
      investigationId: undefined, model: undefined, viewerRole: 'editor',
    }));
  });

  it('records a failure with an errorId when the turn throws', async () => {
    ai.runTurn.mockImplementation(async function* () { throw new Error('boom'); });
    await executor.execute('run-1');
    expect(types()).toEqual(['error', 'done']);
    expect(appended[0].data.errorId).toEqual(expect.any(String));
    expect(runs.finish).toHaveBeenCalledWith('run-1', 'failed', expect.objectContaining({ errorId: appended[0].data.errorId }));
  });

  it('aborts with "cancelled" when the heartbeat sees a cancel request', async () => {
    runs.heartbeat.mockResolvedValue('cancel_requested');
    let reason: unknown;
    ai.runTurn.mockImplementation(async function* ({ signal }: any) {
      await waitForAbort(signal);
      reason = signal.reason;
    });
    const done = executor.execute('run-1');
    await jest.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await done;
    expect(reason).toBe('cancelled');
    expect(runs.finish).toHaveBeenCalledWith('run-1', 'cancelled', null);
    expect(appended.at(-1).data.status).toBe('cancelled');
  });

  it('stops quietly when the lease is lost: no done event, no finish', async () => {
    runs.heartbeat.mockResolvedValue('lost');
    ai.runTurn.mockImplementation(async function* ({ signal }: any) { await waitForAbort(signal); });
    const done = executor.execute('run-1');
    await jest.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await done;
    expect(types()).not.toContain('done');
    expect(runs.finish).not.toHaveBeenCalled();
  });

  it('times out with status timed_out', async () => {
    ai.runTurn.mockImplementation(async function* ({ signal }: any) { await waitForAbort(signal); });
    const done = executor.execute('run-1');
    await jest.advanceTimersByTimeAsync(RUN_TIME_LIMIT_MS);
    await done;
    expect(runs.finish).toHaveBeenCalledWith('run-1', 'timed_out', null);
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `cd backend && npx jest src/modules/ai/runs/agent-run-executor.service.spec.ts`
Expected: FAIL, because the module cannot be found.

**Step 3: Implement** `agent-run-executor.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RunError, TerminalRunStatus } from '../../../database/entities/agent-run.entity';
import { AiService } from '../ai.service';
import { AgentRunsService } from './agent-runs.service';
import { RunEventWriter } from './run-event-writer';
import { abortReasonOf, RunAbortReason } from './run-abort';

/** One run's wall-clock budget. Must stay below the Cloud Tasks dispatch deadline (30 min). */
export const RUN_TIME_LIMIT_MS = 25 * 60_000;
/** Lease renewal and cancel-poll interval. */
export const HEARTBEAT_MS = 3_000;

const FAILURE_MESSAGE = 'An error occurred and has been logged. Please try again.';

/**
 * Executes one claimed run to completion: drives AiService.runTurn, writes its
 * events, renews the lease, and routes cancel / time limit / lost lease into
 * the turn's AbortSignal. Always ends the run with a `done` event and a
 * terminal status, except when the lease was lost: then the sweeper owns it.
 */
@Injectable()
export class AgentRunExecutor {
  private readonly logger = new Logger(AgentRunExecutor.name);

  constructor(
    private readonly runs: AgentRunsService,
    private readonly ai: AiService,
  ) {}

  async execute(runId: string): Promise<void> {
    const run = await this.runs.claim(runId);
    if (!run) {
      this.logger.log(`run_skip runId=${runId} reason=not_queued`);
      return;
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const abort = (reason: RunAbortReason) => {
      if (!controller.signal.aborted) controller.abort(reason);
    };
    const writer = new RunEventWriter((rows) => this.runs.appendEvents(runId, rows));

    const timeLimit = setTimeout(() => abort('time_limit'), RUN_TIME_LIMIT_MS);
    let beating = false;
    const heartbeat = setInterval(() => {
      if (beating) return;
      beating = true;
      this.runs
        .heartbeat(runId)
        .then((state) => {
          if (state === 'lost') abort('lease_lost');
          else if (state === 'cancel_requested') abort('cancelled');
        })
        .catch((err) => this.logger.warn(`run_heartbeat_failed runId=${runId}: ${String(err)}`))
        .finally(() => {
          beating = false;
        });
    }, HEARTBEAT_MS);

    this.logger.log(
      `run_start runId=${runId} conversationId=${run.conversationId} model=${run.model ?? 'default'}`,
    );

    let status: TerminalRunStatus = 'succeeded';
    let error: RunError | null = null;
    try {
      for await (const event of this.ai.runTurn({
        conversationId: run.conversationId,
        userId: run.userId,
        userMessageId: run.userMessageId!, // claim() requires it
        caseId: run.caseId ?? undefined,
        investigationId: run.investigationId ?? undefined,
        model: run.model ?? undefined,
        viewerRole: run.viewerRole,
        signal: controller.signal,
      })) {
        await writer.push(event);
      }
      status = statusForAbort(controller.signal) ?? 'succeeded';
    } catch (err) {
      const aborted = statusForAbort(controller.signal);
      if (aborted) {
        status = aborted;
      } else {
        const errorId = randomUUID();
        this.logger.error(
          `run_failed runId=${runId} errorId=${errorId} conversationId=${run.conversationId} model=${run.model ?? 'default'}`,
          err instanceof Error ? err.stack : String(err),
        );
        // Upstream errors (e.g. Anthropic 400s) carry structured detail on the
        // error object; log it separately so the stack trace stays readable.
        if (err && typeof err === 'object') {
          const e = err as Record<string, unknown>;
          this.logger.error(
            `run_failed_detail [${errorId}]: ${JSON.stringify({
              name: e.name, status: e.status, code: e.code, type: e.type,
              request_id: e.request_id, error: e.error,
            })}`,
          );
        }
        error = { errorId, message: FAILURE_MESSAGE };
        status = 'failed';
      }
    } finally {
      clearTimeout(timeLimit);
      clearInterval(heartbeat);
    }

    if (abortReasonOf(controller.signal) === 'lease_lost') {
      this.logger.warn(`run_lease_lost runId=${runId} durationMs=${Date.now() - startedAt}`);
      return;
    }

    try {
      if (error) await writer.push({ type: 'error', data: { message: error.message, errorId: error.errorId } });
      await writer.push({ type: 'done', data: { conversationId: run.conversationId, status } });
      await writer.flush();
    } catch (err) {
      // Streamers synthesize done from the terminal status if this write failed.
      this.logger.error(`run_events_failed runId=${runId}`, err instanceof Error ? err.stack : String(err));
    } finally {
      await this.runs.finish(runId, status, error);
      this.logger.log(`run_end runId=${runId} status=${status} durationMs=${Date.now() - startedAt}`);
    }
  }
}

function statusForAbort(signal: AbortSignal): TerminalRunStatus | null {
  switch (abortReasonOf(signal)) {
    case 'cancelled':
      return 'cancelled';
    case 'time_limit':
      return 'timed_out';
    case 'lease_lost':
      return 'interrupted';
    default:
      return null;
  }
}
```

**Step 4: Run it and confirm it passes**

Run: `cd backend && npx jest src/modules/ai/runs/agent-run-executor.service.spec.ts`
Expected: PASS, 6 tests.

**Step 5:** Run `git status`. Do not commit.

---

## Task 9: Dispatchers and Cloud Tasks config

**Implementer:** sonnet
**Files:**
- Create `backend/src/modules/ai/runs/dispatch/agent-run-dispatcher.ts`, `in-process.dispatcher.ts`, `cloud-tasks.dispatcher.ts`, `dispatcher.factory.ts` and `dispatcher.factory.spec.ts`.
- Modify `backend/package.json`, `backend/src/config/env.validation.ts`, `backend/src/config/env.validation.spec.ts` and `backend/.env.example`.

**Step 1: Install the dependencies**

Run: `cd backend && npm install @google-cloud/tasks google-auth-library --legacy-peer-deps`
Expected: both appear in `backend/package.json` `dependencies`. (`--legacy-peer-deps` matches the Dockerfile's `npm ci`.)

**Step 2: Write the failing tests**

`dispatcher.factory.spec.ts`:

```ts
import { createAgentRunDispatcher } from './dispatcher.factory';
import { InProcessAgentRunDispatcher } from './in-process.dispatcher';
import { CloudTasksAgentRunDispatcher, DISPATCH_DEADLINE_SECONDS } from './cloud-tasks.dispatcher';

const config = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] }) as any;
const executor = { execute: jest.fn().mockResolvedValue(undefined) } as any;

describe('createAgentRunDispatcher', () => {
  it('uses in-process dispatch outside production when no queue is configured', () => {
    expect(createAgentRunDispatcher(config({ NODE_ENV: 'development' }), executor)).toBeInstanceOf(InProcessAgentRunDispatcher);
  });

  it('refuses to start in production without a queue', () => {
    expect(() => createAgentRunDispatcher(config({ NODE_ENV: 'production' }), executor)).toThrow(/AGENT_RUNS_QUEUE/);
  });

  it('uses Cloud Tasks when a queue is configured', () => {
    const d = createAgentRunDispatcher(config({
      NODE_ENV: 'production',
      AGENT_RUNS_QUEUE: 'projects/p/locations/us-central1/queues/agent-runs',
      AGENT_RUNS_WORKER_URL: 'https://svc.run.app',
      AGENT_RUNS_INVOKER_SA: 'invoker@p.iam.gserviceaccount.com',
    }), executor);
    expect(d).toBeInstanceOf(CloudTasksAgentRunDispatcher);
  });
});

describe('CloudTasksAgentRunDispatcher', () => {
  it('creates a named, OIDC-authenticated task for the run', async () => {
    const client = { createTask: jest.fn().mockResolvedValue([{}]) };
    const d = new CloudTasksAgentRunDispatcher('projects/p/locations/l/queues/q', 'https://svc.run.app', 'inv@p.iam.gserviceaccount.com', client as any);
    await d.dispatch('run-1');
    expect(client.createTask).toHaveBeenCalledWith({
      parent: 'projects/p/locations/l/queues/q',
      task: {
        name: 'projects/p/locations/l/queues/q/tasks/run-run-1',
        dispatchDeadline: { seconds: DISPATCH_DEADLINE_SECONDS },
        httpRequest: {
          httpMethod: 'POST',
          url: 'https://svc.run.app/internal/agent-runs/run-1/execute',
          oidcToken: { serviceAccountEmail: 'inv@p.iam.gserviceaccount.com', audience: 'https://svc.run.app' },
        },
      },
    });
  });
});

describe('InProcessAgentRunDispatcher', () => {
  it('executes the run asynchronously', async () => {
    const d = new InProcessAgentRunDispatcher(executor);
    await d.dispatch('run-2');
    await new Promise((r) => setImmediate(r));
    expect(executor.execute).toHaveBeenCalledWith('run-2');
  });
});
```

In `env.validation.spec.ts`, add `GCS_DATA_ROOM_BUCKET: 'my-bucket'` plus the three agent-run vars to every existing case that sets `NODE_ENV: 'production'` and expects **no** throw. Then add:

```ts
describe('validateEnv — agent runs', () => {
  const AGENT = {
    AGENT_RUNS_QUEUE: 'projects/p/locations/l/queues/q',
    AGENT_RUNS_WORKER_URL: 'https://svc.run.app',
    AGENT_RUNS_INVOKER_SA: 'inv@p.iam.gserviceaccount.com',
  };

  it('requires the Cloud Tasks vars in production', () => {
    const env = { ...BASE_ENV, NODE_ENV: 'production', GCS_DATA_ROOM_BUCKET: 'b' };
    expect(() => validateEnv(env)).toThrow(/AGENT_RUNS_QUEUE/);
  });

  it('accepts production with all Cloud Tasks vars', () => {
    expect(() => validateEnv({ ...BASE_ENV, NODE_ENV: 'production', GCS_DATA_ROOM_BUCKET: 'b', ...AGENT })).not.toThrow();
  });

  it('requires the companion vars whenever a queue is set', () => {
    const env = { ...BASE_ENV, NODE_ENV: 'development', AGENT_RUNS_QUEUE: AGENT.AGENT_RUNS_QUEUE };
    expect(() => validateEnv(env)).toThrow(/AGENT_RUNS_WORKER_URL/);
  });

  it('needs none of them in development', () => {
    expect(() => validateEnv({ ...BASE_ENV, NODE_ENV: 'development' })).not.toThrow();
  });
});
```

**Step 3: Run them and confirm they fail**

Run: `cd backend && npx jest src/modules/ai/runs/dispatch src/config/env.validation.spec.ts`
Expected: FAIL, from missing modules and missing validation.

**Step 4: Implement**

`agent-run-dispatcher.ts`:

```ts
export const AGENT_RUN_DISPATCHER = Symbol('AGENT_RUN_DISPATCHER');

/** Starts execution of a queued run somewhere other than the caller's request. */
export interface AgentRunDispatcher {
  dispatch(runId: string): Promise<void>;
}
```

`in-process.dispatcher.ts`:

```ts
import { Logger } from '@nestjs/common';
import { AgentRunDispatcher } from './agent-run-dispatcher';
import type { AgentRunExecutor } from '../agent-run-executor.service';

/**
 * Dev-only: runs execute in this process after the POST returns. On Cloud Run
 * that would be unprotected background work, so the factory refuses it in
 * production.
 */
export class InProcessAgentRunDispatcher implements AgentRunDispatcher {
  private readonly logger = new Logger(InProcessAgentRunDispatcher.name);

  constructor(private readonly executor: AgentRunExecutor) {}

  async dispatch(runId: string): Promise<void> {
    setImmediate(() => {
      this.executor.execute(runId).catch((err) =>
        this.logger.error(`in_process_run_failed runId=${runId}`, err instanceof Error ? err.stack : String(err)),
      );
    });
  }
}
```

`cloud-tasks.dispatcher.ts`:

```ts
import { CloudTasksClient } from '@google-cloud/tasks';
import { AgentRunDispatcher } from './agent-run-dispatcher';

/** Cloud Tasks' maximum for HTTP targets. The run itself stops at 25 min. */
export const DISPATCH_DEADLINE_SECONDS = 1800;

/**
 * Enqueues one task per run that POSTs to the internal execute endpoint. The
 * run executes inside that request, which Cloud Run keeps alive through
 * deploys and scale-in. Task names derive from the run id, so a duplicate
 * dispatch is rejected by Cloud Tasks instead of running twice.
 */
export class CloudTasksAgentRunDispatcher implements AgentRunDispatcher {
  constructor(
    private readonly queue: string,
    private readonly workerUrl: string,
    private readonly invokerEmail: string,
    private readonly client: Pick<CloudTasksClient, 'createTask'> = new CloudTasksClient(),
  ) {}

  async dispatch(runId: string): Promise<void> {
    await this.client.createTask({
      parent: this.queue,
      task: {
        name: `${this.queue}/tasks/run-${runId}`,
        dispatchDeadline: { seconds: DISPATCH_DEADLINE_SECONDS },
        httpRequest: {
          httpMethod: 'POST',
          url: `${this.workerUrl}/internal/agent-runs/${runId}/execute`,
          oidcToken: { serviceAccountEmail: this.invokerEmail, audience: this.workerUrl },
        },
      },
    });
  }
}
```

`dispatcher.factory.ts`:

```ts
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AGENT_RUN_DISPATCHER, AgentRunDispatcher } from './agent-run-dispatcher';
import { CloudTasksAgentRunDispatcher } from './cloud-tasks.dispatcher';
import { InProcessAgentRunDispatcher } from './in-process.dispatcher';
import { AgentRunExecutor } from '../agent-run-executor.service';

export function createAgentRunDispatcher(
  config: ConfigService,
  executor: AgentRunExecutor,
): AgentRunDispatcher {
  const queue = config.get<string>('AGENT_RUNS_QUEUE');
  if (queue) {
    return new CloudTasksAgentRunDispatcher(
      queue,
      config.get<string>('AGENT_RUNS_WORKER_URL')!,
      config.get<string>('AGENT_RUNS_INVOKER_SA')!,
    );
  }
  if (config.get<string>('NODE_ENV') !== 'production') return new InProcessAgentRunDispatcher(executor);
  throw new Error('AGENT_RUNS_QUEUE required in production');
}

export const agentRunDispatcherProvider: Provider = {
  provide: AGENT_RUN_DISPATCHER,
  useFactory: createAgentRunDispatcher,
  inject: [ConfigService, AgentRunExecutor],
};
```

In `env.validation.ts`, after the GCS bucket block:

```ts
  // Agent runs dispatch through Cloud Tasks in production. In-process dispatch
  // would run turns as unprotected background work on Cloud Run.
  const agentRunEnvVars = ['AGENT_RUNS_QUEUE', 'AGENT_RUNS_WORKER_URL', 'AGENT_RUNS_INVOKER_SA'];
  if (env.NODE_ENV === 'production' || env.AGENT_RUNS_QUEUE) {
    for (const key of agentRunEnvVars) {
      if (!env[key]) missing.push(key);
    }
  }
```

In `backend/.env.example`, after `GCS_DATA_ROOM_BUCKET=...`:

```
# Agent runs (required in production; leave unset in dev to run turns in-process)
# AGENT_RUNS_QUEUE=projects/<project>/locations/us-central1/queues/agent-runs
# AGENT_RUNS_WORKER_URL=https://<service>-<hash>.us-central1.run.app
# AGENT_RUNS_INVOKER_SA=agent-runs-invoker@<project>.iam.gserviceaccount.com
```

**Step 5: Run the tests and confirm they pass**

Run: `cd backend && npx jest src/modules/ai/runs/dispatch src/config/env.validation.spec.ts`
Expected: PASS.

**Step 6:** Run `git status`. Do not commit.

---

## Task 10: Internal execute endpoint, callable only by Cloud Tasks

**Implementer:** sonnet
**Files:** Create `backend/src/modules/ai/runs/cloud-tasks-oidc.guard.ts`, `backend/src/modules/ai/runs/cloud-tasks-oidc.guard.spec.ts` and `backend/src/modules/ai/runs/agent-runs-internal.controller.ts`.

**Step 1: Write the failing test** `cloud-tasks-oidc.guard.spec.ts`

```ts
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CloudTasksOidcGuard } from './cloud-tasks-oidc.guard';

const AUD = 'https://svc.run.app';
const SA = 'inv@p.iam.gserviceaccount.com';
const ctx = (authorization?: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }) }) as any;
const guardWith = (vars: Record<string, string>, payload?: any, throws = false) => {
  const guard = new CloudTasksOidcGuard({ get: (k: string) => vars[k] } as any);
  (guard as any).client = {
    verifyIdToken: jest.fn(async () => {
      if (throws) throw new Error('bad token');
      return { getPayload: () => payload };
    }),
  };
  return guard;
};
const CONFIGURED = { AGENT_RUNS_WORKER_URL: AUD, AGENT_RUNS_INVOKER_SA: SA };

describe('CloudTasksOidcGuard', () => {
  it('404s when Cloud Tasks is not configured (dev)', async () => {
    await expect(guardWith({}).canActivate(ctx('Bearer x'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a missing bearer token', async () => {
    await expect(guardWith(CONFIGURED).canActivate(ctx())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token that fails verification', async () => {
    await expect(guardWith(CONFIGURED, undefined, true).canActivate(ctx('Bearer x'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a valid token for a different service account', async () => {
    const g = guardWith(CONFIGURED, { email: 'other@p.iam.gserviceaccount.com', email_verified: true });
    await expect(g.canActivate(ctx('Bearer x'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a verified token from the invoker account and checks the audience', async () => {
    const g = guardWith(CONFIGURED, { email: SA, email_verified: true });
    await expect(g.canActivate(ctx('Bearer tok'))).resolves.toBe(true);
    expect((g as any).client.verifyIdToken).toHaveBeenCalledWith({ idToken: 'tok', audience: AUD });
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `cd backend && npx jest src/modules/ai/runs/cloud-tasks-oidc.guard.spec.ts`
Expected: FAIL, because the module cannot be found.

**Step 3: Implement**

`cloud-tasks-oidc.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

/**
 * Admits only Cloud Tasks deliveries: a Google-signed OIDC token whose
 * audience is our worker URL and whose subject is the dedicated invoker
 * service account. Without that config (dev), runs dispatch in-process and
 * this route does not exist.
 */
@Injectable()
export class CloudTasksOidcGuard implements CanActivate {
  private readonly client = new OAuth2Client();
  private readonly audience: string | undefined;
  private readonly invokerEmail: string | undefined;

  constructor(config: ConfigService) {
    this.audience = config.get<string>('AGENT_RUNS_WORKER_URL');
    this.invokerEmail = config.get<string>('AGENT_RUNS_INVOKER_SA');
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.audience || !this.invokerEmail) throw new NotFoundException();

    const header = ctx.switchToHttp().getRequest().headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing OIDC token');
    }

    let payload: { email?: string; email_verified?: boolean } | undefined;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: header.slice(7), audience: this.audience });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid OIDC token');
    }
    if (!payload?.email_verified || payload.email !== this.invokerEmail) {
      throw new UnauthorizedException('Unexpected token subject');
    }
    return true;
  }
}
```

`agent-runs-internal.controller.ts`:

```ts
import { Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import { CloudTasksOidcGuard } from './cloud-tasks-oidc.guard';
import { AgentRunExecutor } from './agent-run-executor.service';

/**
 * Cloud Tasks delivery target. The run executes inside this request, so the
 * response is sent only when the run ends. It always returns 2xx once the run
 * was claimed (failures are recorded on the run); only a pre-claim error
 * (e.g. DB unreachable) returns 5xx, so that Cloud Tasks retries the delivery.
 */
@Controller('internal/agent-runs')
export class AgentRunsInternalController {
  constructor(private readonly executor: AgentRunExecutor) {}

  @Public()
  @UseGuards(CloudTasksOidcGuard)
  @Post(':runId/execute')
  @HttpCode(200)
  async execute(@Param('runId', ParseUUIDPipe) runId: string): Promise<{ ok: true }> {
    await this.executor.execute(runId);
    return { ok: true };
  }
}
```

**Step 4: Run the test and confirm it passes**

Run: `cd backend && npx jest src/modules/ai/runs/cloud-tasks-oidc.guard.spec.ts`
Expected: PASS, 5 tests.

**Step 5:** Run `git status`. Do not commit.

---

## Task 11: Launcher (start a run safely)

**Implementer:** sonnet
**Files:** Create `backend/src/modules/ai/runs/resolve-viewer-role.ts`, `backend/src/modules/ai/runs/agent-run-launcher.service.ts` and `backend/src/modules/ai/runs/agent-run-launcher.service.spec.ts`.

**Step 1: Write the failing test** `agent-run-launcher.service.spec.ts`

```ts
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AgentRunLauncher } from './agent-run-launcher.service';

describe('AgentRunLauncher', () => {
  const run = { id: 'run-1', status: 'queued', conversationId: 'conv-1' };
  let runs: any;
  let ai: any;
  let conversations: any;
  let dispatcher: any;
  let launcher: AgentRunLauncher;
  const input = {
    conversationId: 'conv-1', userId: 'user-1', viewerRole: 'editor' as const,
    dto: { message: 'hi', caseId: 'case-1', model: 'claude-opus-5' },
  };

  beforeEach(() => {
    runs = {
      createQueued: jest.fn().mockResolvedValue(run),
      attachUserMessage: jest.fn().mockResolvedValue(undefined),
      failQueued: jest.fn().mockResolvedValue(undefined),
    };
    ai = { persistUserMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }) };
    conversations = { deleteMessage: jest.fn().mockResolvedValue(undefined) };
    dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };
    launcher = new AgentRunLauncher(runs, ai, conversations, dispatcher);
  });

  it('creates the run, persists the user message, links it, then dispatches', async () => {
    await expect(launcher.start(input)).resolves.toBe(run);
    expect(runs.createQueued).toHaveBeenCalledWith({
      conversationId: 'conv-1', userId: 'user-1', viewerRole: 'editor',
      caseId: 'case-1', investigationId: null, model: 'claude-opus-5',
    });
    expect(ai.persistUserMessage).toHaveBeenCalledWith('conv-1', 'hi', undefined);
    expect(runs.attachUserMessage).toHaveBeenCalledWith('run-1', 'msg-1');
    expect(dispatcher.dispatch).toHaveBeenCalledWith('run-1');
  });

  it('fails the run and rethrows the original error when the message cannot be saved', async () => {
    ai.persistUserMessage.mockRejectedValue(new BadRequestException('Unsupported file'));
    await expect(launcher.start(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(runs.failQueued).toHaveBeenCalledWith(run, expect.objectContaining({ errorId: expect.any(String) }));
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('rolls back the user message and fails the run when dispatch fails', async () => {
    dispatcher.dispatch.mockRejectedValue(new Error('tasks down'));
    await expect(launcher.start(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(conversations.deleteMessage).toHaveBeenCalledWith('conv-1', 'msg-1');
    expect(runs.failQueued).toHaveBeenCalledWith(run, expect.objectContaining({ errorId: expect.any(String) }));
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `cd backend && npx jest src/modules/ai/runs/agent-run-launcher.service.spec.ts`
Expected: FAIL, because the module cannot be found.

**Step 3: Implement**

`resolve-viewer-role.ts`:

```ts
import { CaseRole } from '../../../database/entities/case-member.entity';
import { getPrincipal } from '../../auth/access-principal';
import { CaseAccessService } from '../../auth/case-access.service';

/**
 * The caller's role on the case, which picks the agent's tool set. Defaults
 * to 'viewer' when no caseId is given, so the tool registry fails closed.
 * Callers must already have passed requireUserPrincipal: for user principals
 * assertRole returns the membership row (and throws for non-members).
 */
export async function resolveViewerRole(
  req: any,
  caseId: string | undefined,
  caseAccess: CaseAccessService,
): Promise<CaseRole> {
  if (!caseId) return 'viewer';
  const membership = await caseAccess.assertRole(getPrincipal(req), caseId, 'viewer');
  return membership!.role;
}
```

`agent-run-launcher.service.ts`:

```ts
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentRunEntity } from '../../../database/entities/agent-run.entity';
import { CaseRole } from '../../../database/entities/case-member.entity';
import { AiService } from '../ai.service';
import { ConversationsService } from '../conversations.service';
import { ChatMessageDto } from '../dto/chat-message.dto';
import { AgentRunsService } from './agent-runs.service';
import { AGENT_RUN_DISPATCHER, AgentRunDispatcher } from './dispatch/agent-run-dispatcher';

export interface StartRunInput {
  conversationId: string;
  userId: string;
  viewerRole: CaseRole;
  dto: ChatMessageDto;
}

/**
 * Starts a run: reserve the conversation's active slot, persist the user's
 * message, then hand off to the dispatcher. Each step is compensated if a
 * later one fails, so a failed start never leaves an orphan message or a
 * stuck queued run.
 */
@Injectable()
export class AgentRunLauncher {
  private readonly logger = new Logger(AgentRunLauncher.name);

  constructor(
    private readonly runs: AgentRunsService,
    private readonly ai: AiService,
    private readonly conversations: ConversationsService,
    @Inject(AGENT_RUN_DISPATCHER) private readonly dispatcher: AgentRunDispatcher,
  ) {}

  async start({ conversationId, userId, viewerRole, dto }: StartRunInput): Promise<AgentRunEntity> {
    const run = await this.runs.createQueued({
      conversationId,
      userId,
      viewerRole,
      caseId: dto.caseId ?? null,
      investigationId: dto.investigationId ?? null,
      model: dto.model ?? null,
    });

    let userMessageId: string;
    try {
      userMessageId = (await this.ai.persistUserMessage(conversationId, dto.message, dto.attachments)).id;
      await this.runs.attachUserMessage(run.id, userMessageId);
    } catch (err) {
      await this.runs.failQueued(run, {
        errorId: randomUUID(),
        message: 'Your message could not be saved. Please try again.',
      });
      throw err;
    }

    try {
      await this.dispatcher.dispatch(run.id);
    } catch (err) {
      const errorId = randomUUID();
      this.logger.error(
        `run_dispatch_failed runId=${run.id} conversationId=${conversationId} errorId=${errorId}`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.conversations.deleteMessage(conversationId, userMessageId);
      const message = 'Could not start the response. Please try again.';
      await this.runs.failQueued(run, { errorId, message });
      throw new ServiceUnavailableException({ message, errorId });
    }

    return run;
  }
}
```

**Step 4: Run the test and confirm it passes**

Run: `cd backend && npx jest src/modules/ai/runs/agent-run-launcher.service.spec.ts`
Expected: PASS, 3 tests.

**Step 5:** Run `git status`. Do not commit.

---

## Task 12: Resumable SSE streamer

**Implementer:** sonnet
**Files:** Create `backend/src/modules/ai/runs/agent-run-events.streamer.ts` and `backend/src/modules/ai/runs/agent-run-events.streamer.spec.ts`.

**Step 1: Write the failing test** `agent-run-events.streamer.spec.ts`

```ts
import { EventEmitter } from 'events';
import { AgentRunEventsStreamer, POLL_MS } from './agent-run-events.streamer';

const RUN = { id: 'run-1', conversationId: 'conv-1' };
const ev = (seq: number, type: string, data: unknown = {}) => ({ runId: 'run-1', seq, type, data });

function fakeRes() {
  const res: any = new EventEmitter();
  res.setHeader = jest.fn();
  res.flushHeaders = jest.fn();
  res.write = jest.fn();
  res.end = jest.fn();
  return res;
}

describe('AgentRunEventsStreamer', () => {
  let runs: any;
  let streamer: AgentRunEventsStreamer;

  beforeEach(() => {
    jest.useFakeTimers();
    runs = {
      listEventsAfter: jest.fn().mockResolvedValue([]),
      sweepStale: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockResolvedValue('running'),
    };
    streamer = new AgentRunEventsStreamer(runs);
  });
  afterEach(() => jest.useRealTimers());

  it('writes events with ids after the cursor and stops at done', async () => {
    runs.listEventsAfter.mockResolvedValueOnce([ev(4, 'text_delta', { content: 'a' }), ev(5, 'done', { status: 'succeeded' })]);
    const res = fakeRes();
    await streamer.stream(res, RUN, 3, 60_000);
    expect(runs.listEventsAfter).toHaveBeenCalledWith('run-1', 3);
    expect(res.write.mock.calls.map((c: any[]) => c[0])).toEqual([
      'id: 4\nevent: text_delta\ndata: {"content":"a"}\n\n',
      'id: 5\nevent: done\ndata: {"status":"succeeded"}\n\n',
    ]);
    expect(res.end).toHaveBeenCalled();
  });

  it('polls until new events arrive', async () => {
    runs.listEventsAfter.mockResolvedValueOnce([]).mockResolvedValueOnce([ev(1, 'done')]);
    const res = fakeRes();
    const p = streamer.stream(res, RUN, 0, 60_000);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    await p;
    expect(runs.listEventsAfter).toHaveBeenCalledTimes(2);
  });

  it('ends without done when the subscription window elapses', async () => {
    const res = fakeRes();
    const p = streamer.stream(res, RUN, 0, 1_000);
    await jest.advanceTimersByTimeAsync(1_500);
    await p;
    expect(res.write.mock.calls.some((c: any[]) => c[0].includes('event: done'))).toBe(false);
    expect(res.end).toHaveBeenCalled();
  });

  it('synthesizes done when the run is terminal but its done event is missing', async () => {
    runs.getStatus.mockResolvedValue('failed');
    const res = fakeRes();
    const p = streamer.stream(res, RUN, 0, 60_000);
    await jest.advanceTimersByTimeAsync(10_500);
    await p;
    expect(runs.sweepStale).toHaveBeenCalledWith('conv-1');
    expect(res.write).toHaveBeenCalledWith('event: done\ndata: {"conversationId":"conv-1","status":"failed"}\n\n');
  });

  it('stops polling when the client disconnects', async () => {
    const res = fakeRes();
    const p = streamer.stream(res, RUN, 0, 60_000);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    res.emit('close');
    await jest.advanceTimersByTimeAsync(POLL_MS * 3);
    await p;
    const calls = runs.listEventsAfter.mock.calls.length;
    await jest.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(runs.listEventsAfter.mock.calls.length).toBe(calls);
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `cd backend && npx jest src/modules/ai/runs/agent-run-events.streamer.spec.ts`
Expected: FAIL, because the module cannot be found.

**Step 3: Implement** `agent-run-events.streamer.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ACTIVE_RUN_STATUSES } from '../../../database/entities/agent-run.entity';
import { AgentRunsService } from './agent-runs.service';

export const POLL_MS = 300;
/** Server-side subscription window. Clients reconnect with their last id. */
export const SUBSCRIPTION_MAX_MS = 240_000;
const HEARTBEAT_MS = 15_000;
const STATUS_CHECK_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Relays a run's event log as SSE by polling Postgres. Ends at the run's
 * `done` event, when the client disconnects, or when `maxDurationMs` elapses.
 * Ending without `done` means "reconnect with ?after=<last id>".
 */
@Injectable()
export class AgentRunEventsStreamer {
  private readonly logger = new Logger(AgentRunEventsStreamer.name);

  constructor(private readonly runs: AgentRunsService) {}

  async stream(
    res: Response,
    run: { id: string; conversationId: string },
    after: number,
    maxDurationMs: number,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // res 'close' (not req 'close') fires when the client goes away.
    let closed = false;
    res.on('close', () => {
      closed = true;
    });

    const startedAt = Date.now();
    let cursor = after;
    let lastWriteAt = startedAt;
    let lastStatusCheckAt = startedAt;

    try {
      while (!closed) {
        const events = await this.runs.listEventsAfter(run.id, cursor);
        for (const e of events) {
          res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
          cursor = e.seq;
          lastWriteAt = Date.now();
          if (e.type === 'done') return;
        }
        if (events.length > 0) continue; // drain any backlog before sleeping

        const now = Date.now();
        if (now - startedAt >= maxDurationMs) return;

        if (now - lastStatusCheckAt >= STATUS_CHECK_MS) {
          lastStatusCheckAt = now;
          await this.runs.sweepStale(run.conversationId);
          const status = await this.runs.getStatus(run.id);
          if (status && !ACTIVE_RUN_STATUSES.includes(status)) {
            const tail = await this.runs.listEventsAfter(run.id, cursor);
            if (tail.length > 0) continue;
            // Terminal, but its done event was never written: close the turn.
            res.write(`event: done\ndata: ${JSON.stringify({ conversationId: run.conversationId, status })}\n\n`);
            return;
          }
        }

        if (now - lastWriteAt >= HEARTBEAT_MS) {
          res.write(': heartbeat\n\n');
          lastWriteAt = now;
        }
        await sleep(POLL_MS);
      }
    } catch (err) {
      this.logger.warn(`run_stream_failed runId=${run.id}: ${String(err)}`);
    } finally {
      res.end();
    }
  }
}
```

**Step 4: Run the test and confirm it passes**

Run: `cd backend && npx jest src/modules/ai/runs/agent-run-events.streamer.spec.ts`
Expected: PASS, 5 tests.

**Step 5:** Run `git status`. Do not commit.

---

## Task 13: Public run endpoints, legacy bridge, module wiring

**Implementer:** sonnet
**Files:**
- Create `backend/src/modules/ai/runs/agent-runs.controller.ts` and `backend/src/modules/ai/runs/agent-runs.controller.spec.ts`.
- Modify `backend/src/modules/ai/conversations.controller.ts` (`ConversationsController` lines 39-150) and `backend/src/modules/ai/ai.module.ts`.

**Step 1: Write the failing test** `agent-runs.controller.spec.ts`

```ts
import { NotFoundException } from '@nestjs/common';
import { AgentRunsController } from './agent-runs.controller';
import { SUBSCRIPTION_MAX_MS } from './agent-run-events.streamer';

describe('AgentRunsController', () => {
  const req = { principal: { kind: 'user', userId: 'user-1' } };
  const run = { id: 'run-1', conversationId: 'conv-1', status: 'running', userMessageId: 'msg-1', error: null, createdAt: new Date(0), finishedAt: null };
  let conversations: any, caseAccess: any, runs: any, launcher: any, streamer: any;
  let controller: AgentRunsController;

  beforeEach(() => {
    conversations = { findOne: jest.fn().mockResolvedValue({ id: 'conv-1' }) };
    caseAccess = { assertRole: jest.fn().mockResolvedValue({ role: 'editor' }) };
    runs = {
      sweepStale: jest.fn(), findLatest: jest.fn().mockResolvedValue(run),
      findForConversation: jest.fn().mockResolvedValue(run), requestCancel: jest.fn(),
    };
    launcher = { start: jest.fn().mockResolvedValue({ ...run, status: 'queued' }) };
    streamer = { stream: jest.fn().mockResolvedValue(undefined) };
    controller = new AgentRunsController(conversations, caseAccess, runs, launcher, streamer);
  });

  it('start checks access, resolves the role and launches', async () => {
    const body = { message: 'hi', caseId: 'case-1' } as any;
    await expect(controller.start('conv-1', body, req)).resolves.toEqual({ runId: 'run-1', status: 'queued' });
    expect(conversations.findOne).toHaveBeenCalledWith('conv-1', 'user-1');
    expect(launcher.start).toHaveBeenCalledWith({ conversationId: 'conv-1', userId: 'user-1', viewerRole: 'editor', dto: body });
  });

  it('latest sweeps before reading', async () => {
    const out = await controller.latest('conv-1', req);
    expect(runs.sweepStale).toHaveBeenCalledWith('conv-1');
    expect(out.run).toMatchObject({ id: 'run-1', status: 'running', userMessageId: 'msg-1' });
  });

  it('events streams from the parsed cursor', async () => {
    const res = {} as any;
    await controller.events('conv-1', 'run-1', '7', req, res);
    expect(streamer.stream).toHaveBeenCalledWith(res, run, 7, SUBSCRIPTION_MAX_MS);
  });

  it('events 404s for a run outside the conversation', async () => {
    runs.findForConversation.mockResolvedValue(null);
    await expect(controller.events('conv-1', 'run-x', undefined, req, {} as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancel requests cancellation', async () => {
    await expect(controller.cancel('conv-1', 'run-1', req)).resolves.toEqual({ runId: 'run-1' });
    expect(runs.requestCancel).toHaveBeenCalledWith(run);
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `cd backend && npx jest src/modules/ai/runs/agent-runs.controller.spec.ts`
Expected: FAIL, because the module cannot be found.

**Step 3: Implement** `agent-runs.controller.ts`

```ts
import {
  Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AgentRunEntity } from '../../../database/entities/agent-run.entity';
import { requireUserPrincipal } from '../../auth/access-principal';
import { CaseAccessService } from '../../auth/case-access.service';
import { ConversationsService } from '../conversations.service';
import { ChatMessageDto } from '../dto/chat-message.dto';
import { AgentRunsService } from './agent-runs.service';
import { AgentRunLauncher } from './agent-run-launcher.service';
import { AgentRunEventsStreamer, SUBSCRIPTION_MAX_MS } from './agent-run-events.streamer';
import { resolveViewerRole } from './resolve-viewer-role';

@Controller('conversations')
export class AgentRunsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly caseAccess: CaseAccessService,
    private readonly runs: AgentRunsService,
    private readonly launcher: AgentRunLauncher,
    private readonly streamer: AgentRunEventsStreamer,
  ) {}

  /** Start a turn. Returns at once; follow it via GET .../runs/:runId/events. */
  @Post(':id/runs')
  @HttpCode(202)
  async start(@Param('id') id: string, @Body() body: ChatMessageDto, @Req() req: any) {
    const userId = requireUserPrincipal(req);
    await this.conversationsService.findOne(id, userId);
    const viewerRole = await resolveViewerRole(req, body.caseId, this.caseAccess);
    const run = await this.launcher.start({ conversationId: id, userId, viewerRole, dto: body });
    return { runId: run.id, status: run.status };
  }

  /** The conversation's most recent run (or null), after sweeping dead ones. */
  @Get(':id/runs/latest')
  async latest(@Param('id') id: string, @Req() req: any) {
    const userId = requireUserPrincipal(req);
    await this.conversationsService.findOne(id, userId);
    await this.runs.sweepStale(id);
    const run = await this.runs.findLatest(id);
    return { run: run ? toRunView(run) : null };
  }

  /** SSE of the run's events after `after`. Ends at `done` or after ~4 min (reconnect). */
  @Get(':id/runs/:runId/events')
  async events(
    @Param('id') id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('after') after: string | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const run = await this.ownedRun(id, runId, req);
    const cursor = Math.max(0, Number.parseInt(after ?? '0', 10) || 0);
    await this.streamer.stream(res, run, cursor, SUBSCRIPTION_MAX_MS);
  }

  /** Ask the run to stop. It persists what it has and sends `done`. */
  @Post(':id/runs/:runId/cancel')
  @HttpCode(202)
  async cancel(@Param('id') id: string, @Param('runId', ParseUUIDPipe) runId: string, @Req() req: any) {
    const run = await this.ownedRun(id, runId, req);
    await this.runs.requestCancel(run);
    return { runId: run.id };
  }

  private async ownedRun(conversationId: string, runId: string, req: any): Promise<AgentRunEntity> {
    const userId = requireUserPrincipal(req);
    await this.conversationsService.findOne(conversationId, userId);
    const run = await this.runs.findForConversation(runId, conversationId);
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }
}

function toRunView(run: AgentRunEntity) {
  return {
    id: run.id,
    status: run.status,
    userMessageId: run.userMessageId,
    error: run.error,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  };
}
```

**Step 4: Turn the legacy `/chat` into a bridge.** In `conversations.controller.ts`:
- Replace the `ConversationsController` constructor deps `aiService: AiService` with `launcher: AgentRunLauncher` and `streamer: AgentRunEventsStreamer`. Keep `conversationsService` and `caseAccess`.
- Replace the body of `chat(...)` with:

```ts
  /**
   * Legacy endpoint for clients loaded before durable runs shipped. Starts a
   * run and relays its events on this response. The run itself is durable,
   * so a dropped connection no longer loses the turn. Remove once no client
   * calls it (see docs/agent-runs.md).
   */
  @Post(':id/chat')
  async chat(
    @Param('id') id: string,
    @Body() body: ChatMessageDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const userId = requireUserPrincipal(req);
    await this.conversationsService.findOne(id, userId);
    const viewerRole = await resolveViewerRole(req, body.caseId, this.caseAccess);
    const run = await this.launcher.start({ conversationId: id, userId, viewerRole, dto: body });
    await this.streamer.stream(res, run, 0, Number.POSITIVE_INFINITY);
  }
```

- Remove the now-unused imports and members: `randomUUID`, `Logger` and the `logger` field, `AiService`, `getPrincipal` and `CaseRole`. Add imports for `AgentRunLauncher`, `AgentRunEventsStreamer` and `resolveViewerRole`.

**Step 5: Wire the module.** In `ai.module.ts`:
- Add `AgentRunEntity` and `AgentRunEventEntity` to `TypeOrmModule.forFeature([...])`.
- Add `AgentRunsController` and `AgentRunsInternalController` to `controllers`.
- Add `AgentRunsService`, `AgentRunExecutor`, `AgentRunLauncher`, `AgentRunEventsStreamer` and `agentRunDispatcherProvider` to `providers`, with the matching imports from `./runs/...` and `../../database/entities/...`.

**Step 6: Run the full backend suite and type-check**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: tsc exits 0, and all suites pass, including the e2e suites (dev Postgres up).

**Step 7: Smoke-test in dev.** With `npm run db` and `npm run be` running, check that the app boots: there must be no Nest DI errors in the log, and `curl -s localhost:8081/health` returns OK. Stop the server.

**Step 8:** Run `git status`. Do not commit.

---

## Task 14: Contracts

**Implementer:** sonnet
**Files:** Modify `contracts/paths/ai.yaml`, `contracts/schemas/ai.yaml` and `contracts/openapi.yaml`. Regenerate `backend/src/generated/api-types.ts` and `frontend/src/generated/api-types.ts`.

**Step 1: Schemas.** In `contracts/schemas/ai.yaml`, replace `ChatRequest` with the version below (it now matches `ChatMessageDto`) and add the new schemas:

```yaml
ChatRequest:
  type: object
  properties:
    message:
      type: string
      minLength: 1
    caseId:
      type: string
      format: uuid
    investigationId:
      type: string
      format: uuid
    model:
      type: string
    attachments:
      type: array
      items:
        type: object
        required: [name, mediaType, data]
        properties:
          name:
            type: string
          mediaType:
            type: string
          data:
            type: string
            description: Base64-encoded file content

AgentRun:
  type: object
  required: [id, status, userMessageId, error, createdAt, finishedAt]
  properties:
    id:
      type: string
      format: uuid
    status:
      type: string
      enum: [queued, running, succeeded, failed, cancelled, timed_out, interrupted]
    userMessageId:
      type: string
      format: uuid
      nullable: true
    error:
      type: object
      nullable: true
      required: [errorId, message]
      properties:
        errorId:
          type: string
        message:
          type: string
    createdAt:
      type: string
      format: date-time
    finishedAt:
      type: string
      format: date-time
      nullable: true

AgentRunStarted:
  type: object
  required: [runId, status]
  properties:
    runId:
      type: string
      format: uuid
    status:
      type: string
      enum: [queued, running, succeeded, failed, cancelled, timed_out, interrupted]

LatestAgentRun:
  type: object
  required: [run]
  properties:
    run:
      allOf:
        - $ref: '../schemas/ai.yaml#/AgentRun'
      nullable: true
```

If openapi-typescript fails to resolve `'../schemas/ai.yaml#/AgentRun'` from inside the schemas file, change it to `'./ai.yaml#/AgentRun'`.

**Step 2: Paths.** Append to `contracts/paths/ai.yaml`:

```yaml
/conversations/{id}/runs:
  post:
    summary: Start an agent run for a new user message
    description: Returns immediately. Follow progress via /conversations/{id}/runs/{runId}/events.
    operationId: startAgentRun
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
      '202':
        description: Run queued
        content:
          application/json:
            schema:
              $ref: '../schemas/ai.yaml#/AgentRunStarted'
      '409':
        description: A run is already active in this conversation (body includes activeRunId)

/conversations/{id}/runs/latest:
  get:
    summary: The conversation's most recent run, or null
    operationId: getLatestAgentRun
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
        description: Latest run
        content:
          application/json:
            schema:
              $ref: '../schemas/ai.yaml#/LatestAgentRun'

/conversations/{id}/runs/{runId}/events:
  get:
    summary: Resumable SSE stream of a run's events
    description: >-
      Each event carries `id: <seq>`. The stream ends at the `done` event, or
      after a few minutes without it, in which case reconnect with
      `after=<last id>`. `done` data is `{ conversationId, status }`.
    operationId: streamAgentRunEvents
    tags: [AI]
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
      - name: runId
        in: path
        required: true
        schema:
          type: string
          format: uuid
      - name: after
        in: query
        required: false
        schema:
          type: integer
          minimum: 0
    responses:
      '200':
        description: SSE stream (text/event-stream)
        content:
          text/event-stream:
            schema:
              $ref: '../schemas/ai.yaml#/ChatSseEvent'

/conversations/{id}/runs/{runId}/cancel:
  post:
    summary: Ask a run to stop
    operationId: cancelAgentRun
    tags: [AI]
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: string
          format: uuid
      - name: runId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    responses:
      '202':
        description: Cancellation requested
        content:
          application/json:
            schema:
              type: object
              required: [runId]
              properties:
                runId:
                  type: string
                  format: uuid
```

In the same file, add `deprecated: true` under `/conversations/{id}/chat` → `post:`, and change its summary to `Legacy: start a run and relay its events on this response`.

**Step 3: Root refs.** In `contracts/openapi.yaml`, after the `/conversations/{id}/chat` entry, add:

```yaml
  /conversations/{id}/runs:
    $ref: './paths/ai.yaml#/~1conversations~1{id}~1runs'
  /conversations/{id}/runs/latest:
    $ref: './paths/ai.yaml#/~1conversations~1{id}~1runs~1latest'
  /conversations/{id}/runs/{runId}/events:
    $ref: './paths/ai.yaml#/~1conversations~1{id}~1runs~1{runId}~1events'
  /conversations/{id}/runs/{runId}/cancel:
    $ref: './paths/ai.yaml#/~1conversations~1{id}~1runs~1{runId}~1cancel'
```

**Step 4: Regenerate and verify**

Run from the repo root: `npm run gen`
Expected: both `api-types.ts` files regenerate. `grep -c startAgentRun backend/src/generated/api-types.ts frontend/src/generated/api-types.ts` shows at least 1 for each.

Run: `cd backend && npx tsc --noEmit -p tsconfig.json` and `cd frontend && npx tsc --noEmit`
Expected: both exit 0.

**Step 5:** Run `git status`. Do not commit.

---

## Task 15: Frontend SSE parser

**Implementer:** sonnet
**Files:** Create `frontend/src/lib/sse.ts` and `frontend/src/lib/sse.test.ts`.

**Step 1: Write the failing test** `sse.test.ts`

```ts
import { createSseParser } from './sse';

describe('createSseParser', () => {
  it('parses complete frames with id, event and data', () => {
    const p = createSseParser();
    expect(p.feed('id: 3\nevent: text_delta\ndata: {"content":"a"}\n\n')).toEqual([
      { id: '3', event: 'text_delta', data: '{"content":"a"}' },
    ]);
  });

  it('buffers frames split across chunks', () => {
    const p = createSseParser();
    expect(p.feed('id: 1\nevent: do')).toEqual([]);
    expect(p.feed('ne\ndata: {}\n')).toEqual([]);
    expect(p.feed('\n')).toEqual([{ id: '1', event: 'done', data: '{}' }]);
  });

  it('ignores comments and heartbeats, joins multi-line data, tolerates CRLF', () => {
    const p = createSseParser();
    expect(p.feed(': heartbeat\n\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n')).toEqual([
      { id: null, event: 'x', data: 'a\nb' },
    ]);
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `cd frontend && npx jest src/lib/sse.test.ts`
Expected: FAIL, because the module cannot be found.

**Step 3: Implement** `sse.ts`

```ts
export interface SseFrame {
  id: string | null;
  event: string;
  data: string;
}

/**
 * Incremental text/event-stream parser. Feed decoded chunks and get back the
 * frames each chunk completes. Comment lines (":") are skipped, data lines
 * join with "\n", and a blank line dispatches the frame.
 */
export function createSseParser() {
  let buf = '';
  let id: string | null = null;
  let event = '';
  let data: string[] = [];

  return {
    feed(chunk: string): SseFrame[] {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      const frames: SseFrame[] = [];
      for (const raw of lines) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (line === '') {
          if (data.length > 0) frames.push({ id, event: event || 'message', data: data.join('\n') });
          id = null;
          event = '';
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
        else if (field === 'id') id = value;
      }
      return frames;
    },
  };
}
```

**Step 4: Run the test and confirm it passes**

Run: `cd frontend && npx jest src/lib/sse.test.ts`
Expected: PASS, 3 tests.

**Step 5:** Run `git status`. Do not commit.

---

## Task 16: Frontend run client (start, follow, cancel, latest)

**Implementer:** sonnet
**Files:** Create `frontend/src/lib/run-events.ts` and `frontend/src/lib/run-events.test.ts`. Modify `frontend/src/lib/api-client.ts`.

**Step 1: Write the failing test** `run-events.test.ts`

```ts
import { subscribeRunEvents } from './run-events';

jest.mock('./firebase', () => ({ getFirebaseAuth: () => ({ currentUser: null }) }));

const sse = (...chunks: string[]) =>
  new Response(new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
      c.close();
    },
  }), { status: 200 });

describe('subscribeRunEvents', () => {
  const base = { conversationId: 'c1', runId: 'r1', retryDelayMs: () => 0 };

  it('delivers events and resolves done on the done event', async () => {
    const seen: string[] = [];
    const fetchImpl = jest.fn().mockResolvedValue(sse(
      'id: 1\nevent: text_delta\ndata: {"content":"a"}\n\n',
      'id: 2\nevent: done\ndata: {"status":"succeeded"}\n\n',
    ));
    const result = await subscribeRunEvents({ ...base, signal: new AbortController().signal, fetchImpl, onEvent: (t) => seen.push(t) });
    expect(result).toBe('done');
    expect(seen).toEqual(['text_delta', 'done']);
  });

  it('reconnects from the last id when the stream ends without done', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(sse('id: 5\nevent: tool_start\ndata: {}\n\n'))
      .mockResolvedValueOnce(sse('id: 6\nevent: done\ndata: {}\n\n'));
    const result = await subscribeRunEvents({ ...base, signal: new AbortController().signal, fetchImpl, onEvent: () => {} });
    expect(result).toBe('done');
    expect(fetchImpl.mock.calls[1][0]).toContain('/conversations/c1/runs/r1/events?after=5');
  });

  it('returns lost on a 4xx', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    expect(await subscribeRunEvents({ ...base, signal: new AbortController().signal, fetchImpl, onEvent: () => {} })).toBe('lost');
  });

  it('returns lost after repeated network failures', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await subscribeRunEvents({ ...base, signal: new AbortController().signal, fetchImpl, onEvent: () => {} })).toBe('lost');
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('returns aborted when the signal fires', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    expect(await subscribeRunEvents({ ...base, signal: controller.signal, fetchImpl, onEvent: () => {} })).toBe('aborted');
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `cd frontend && npx jest src/lib/run-events.test.ts`
Expected: FAIL, because the module cannot be found.

**Step 3: Implement** `run-events.ts`

```ts
import { getFirebaseAuth } from './firebase';
import { createSseParser } from './sse';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
const MAX_CONSECUTIVE_FAILURES = 6;
const RECONNECT_DELAY_MS = 250;

export type SubscriptionResult = 'done' | 'aborted' | 'lost';

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const currentUser = getFirebaseAuth().currentUser;
    if (currentUser) return { Authorization: `Bearer ${await currentUser.getIdToken()}` };
  } catch {
    // Firebase not initialized or token refresh failed — proceed without auth
  }
  return {};
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/**
 * Follow a run's events until its `done` event. The server ends each
 * subscription after a few minutes, and networks drop, so this reconnects from
 * the last seen event id until the run finishes. Returns 'lost' on a 4xx or
 * after repeated failures (the run keeps going server-side), and 'aborted' if
 * `signal` fires.
 */
export async function subscribeRunEvents(opts: {
  conversationId: string;
  runId: string;
  after?: number;
  signal: AbortSignal;
  onEvent: (type: string, data: any) => void;
  fetchImpl?: typeof fetch;
  retryDelayMs?: (attempt: number) => number;
}): Promise<SubscriptionResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const retryDelay = opts.retryDelayMs ?? ((n: number) => Math.min(1000 * 2 ** n, 10_000));
  let cursor = opts.after ?? 0;
  let failures = 0;

  while (!opts.signal.aborted) {
    try {
      const res = await fetchFn(
        `${API_BASE}/conversations/${opts.conversationId}/runs/${opts.runId}/events?after=${cursor}`,
        { headers: await authHeaders(), signal: opts.signal },
      );
      if (res.status >= 400 && res.status < 500) return 'lost';
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.feed(decoder.decode(value, { stream: true }))) {
          if (frame.id !== null) cursor = Number(frame.id);
          failures = 0;
          opts.onEvent(frame.event, frame.data ? JSON.parse(frame.data) : {});
          if (frame.event === 'done') return 'done';
        }
      }
      // Ended without done: the server rotated the subscription. Reconnect.
      failures = 0;
      await sleep(RECONNECT_DELAY_MS, opts.signal);
    } catch {
      if (opts.signal.aborted) return 'aborted';
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) return 'lost';
      await sleep(retryDelay(failures - 1), opts.signal);
    }
  }
  return 'aborted';
}
```

In `api-client.ts`, add the types next to `ChatMessage`:

```ts
export type AgentRunStatus =
  | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';

export interface AgentRun {
  id: string;
  status: AgentRunStatus;
  userMessageId: string | null;
  error: { errorId: string; message: string } | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface StartRunBody {
  model?: string;
  message?: string;
  caseId?: string;
  investigationId?: string;
  attachments?: Array<{ name: string; mediaType: string; data: string }>;
}
```

Then add these methods after `deleteConversation`:

```ts
  startRun: (conversationId: string, body: StartRunBody) =>
    request<{ runId: string; status: AgentRunStatus }>(`/conversations/${conversationId}/runs`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getLatestRun: (conversationId: string) =>
    request<{ run: AgentRun | null }>(`/conversations/${conversationId}/runs/latest`),
  cancelRun: (conversationId: string, runId: string) =>
    request<{ runId: string }>(`/conversations/${conversationId}/runs/${runId}/cancel`, {
      method: 'POST',
    }),
```

**Step 4: Run the tests and confirm they pass**

Run: `cd frontend && npx jest src/lib/run-events.test.ts`
Expected: PASS, 5 tests.

**Step 5:** Run `git status`. Do not commit.

---

## Task 17: Pure turn model

**Implementer:** sonnet
**Files:** Create `frontend/src/components/Workspace/chatTurn.ts` and `frontend/src/components/Workspace/chatTurn.test.ts`.

**Step 1: Write the failing test** `chatTurn.test.ts`

```ts
import { ChatTurn } from './chatTurn';

const make = (placeholder = true) => {
  let n = 0;
  return new ChatTurn({ newId: () => `id${++n}`, formatToolStatus: (t) => `Running ${t.name}` }, { placeholder });
};

describe('ChatTurn', () => {
  it('fills the placeholder with streamed text, replacing the bubble object', () => {
    const turn = make();
    const before = turn.bubbles()[0];
    turn.apply('text_delta', { content: 'Hel' });
    turn.apply('text_delta', { content: 'lo' });
    expect(turn.bubbles()).toEqual([{ id: 'id1', role: 'assistant', text: 'Hello', isStreaming: true }]);
    expect(turn.bubbles()[0]).not.toBe(before);
  });

  it('shows a tool status, then starts a fresh bubble for text after the tool', () => {
    const turn = make();
    turn.apply('text_delta', { content: 'Looking' });
    turn.apply('tool_start', { name: 'read_production' });
    expect(turn.bubbles().map((m) => [m.role, m.text, m.isStreaming])).toEqual([
      ['assistant', 'Looking', false],
      ['status', 'Running read_production', true],
    ]);
    turn.apply('tool_done', { name: 'read_production' });
    turn.apply('text_delta', { content: 'Done' });
    expect(turn.bubbles().map((m) => m.text)).toEqual(['Looking', 'Done']);
  });

  it('drops an empty placeholder when a tool starts', () => {
    const turn = make();
    turn.apply('tool_start', { name: 'x' });
    expect(turn.bubbles().map((m) => m.role)).toEqual(['status']);
  });

  it('returns side effects for graph and production updates', () => {
    const turn = make();
    expect(turn.apply('graph_updated', {})).toBe('graph');
    expect(turn.apply('production_updated', {})).toBe('production');
    expect(turn.apply('text_delta', { content: 'x' })).toBeNull();
  });

  it('keeps partial text and appends errors as their own bubble', () => {
    const turn = make();
    turn.apply('text_delta', { content: 'Partial' });
    turn.apply('error', { message: 'Boom', errorId: 'e1' });
    expect(turn.bubbles().map((m) => m.text)).toEqual(['Partial', 'Boom (ref: e1)']);
  });

  it('marks finished on done and settles: drops empties and status, appends failure', () => {
    const turn = make();
    turn.apply('done', { status: 'succeeded' });
    expect(turn.finished).toBe(true);
    const t2 = make();
    t2.apply('tool_start', { name: 'x' });
    // id1 = dropped placeholder, id2 = status (dropped by settle), id3 = failure bubble
    expect(t2.settle('Lost connection')).toEqual([{ id: 'id3', role: 'assistant', text: 'Lost connection' }]);
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `cd frontend && npx jest src/components/Workspace/chatTurn.test.ts`
Expected: FAIL, because the module cannot be found.

**Step 3: Implement** `chatTurn.ts`

```ts
export interface TurnMessage {
  id: string;
  role: 'assistant' | 'status';
  text: string;
  isStreaming?: boolean;
}

export type TurnSideEffect = 'graph' | 'production' | null;

interface TurnDeps {
  newId: () => string;
  formatToolStatus: (tool: { name: string; input?: Record<string, unknown> }) => string;
}

/**
 * The assistant side of one turn, built from run events. Pure state, with no
 * React: AIChat renders `[...base, ...turn.bubbles()]`, and the same model
 * serves live sends and re-attaching to a turn that is already running.
 * Bubbles are replaced, never mutated, so memoized rows re-render.
 */
export class ChatTurn {
  private items: TurnMessage[] = [];
  private curId = '';
  private statusId: string | null = null;
  finished = false;

  constructor(private readonly deps: TurnDeps, opts: { placeholder: boolean }) {
    if (opts.placeholder) {
      this.curId = deps.newId();
      this.items = [{ id: this.curId, role: 'assistant', text: '', isStreaming: true }];
    }
  }

  bubbles(): TurnMessage[] {
    return this.items;
  }

  apply(type: string, data: any): TurnSideEffect {
    switch (type) {
      case 'text_delta': {
        this.removeStatus();
        const content: string = data?.content ?? '';
        const cur = this.current();
        if (cur && cur.isStreaming) {
          this.replace({ ...cur, text: cur.text + content });
        } else {
          this.curId = this.deps.newId();
          this.items = [...this.items, { id: this.curId, role: 'assistant', text: content, isStreaming: true }];
        }
        return null;
      }
      case 'tool_start':
        this.finalizeOrDropCurrent();
        this.showStatus(this.deps.formatToolStatus({ name: data?.name, input: data?.input }));
        return null;
      case 'tool_done':
        this.removeStatus();
        this.finalizeOrDropCurrent();
        this.curId = '';
        return null;
      case 'graph_updated':
        return 'graph';
      case 'production_updated':
        return 'production';
      case 'done':
        this.finished = true;
        this.removeStatus();
        this.finalizeOrDropCurrent();
        return null;
      case 'error': {
        this.removeStatus();
        const text: string = data?.errorId
          ? `${data.message} (ref: ${data.errorId})`
          : data?.message ?? 'Something went wrong.';
        const cur = this.current();
        if (cur && !cur.text) {
          this.replace({ ...cur, text, isStreaming: false });
        } else {
          this.finalizeOrDropCurrent();
          this.curId = '';
          this.items = [...this.items, { id: this.deps.newId(), role: 'assistant', text, isStreaming: false }];
        }
        return null;
      }
      default:
        return null;
    }
  }

  /** Final bubbles once following stops: drop empty and status bubbles, append the failure if any. */
  settle(failure: string | null): TurnMessage[] {
    const settled = this.items.flatMap((m) => {
      if (!m.isStreaming) return [m];
      if (m.role === 'status' || !m.text) return [];
      return [{ ...m, isStreaming: false }];
    });
    this.items = failure
      ? [...settled, { id: this.deps.newId(), role: 'assistant', text: failure }]
      : settled;
    return this.items;
  }

  private current(): TurnMessage | undefined {
    return this.items.find((m) => m.id === this.curId);
  }

  private replace(next: TurnMessage) {
    this.items = this.items.map((m) => (m.id === next.id ? next : m));
  }

  private finalizeOrDropCurrent() {
    this.items = this.items.flatMap((m) => {
      if (m.id !== this.curId) return [m];
      return m.text ? [{ ...m, isStreaming: false }] : [];
    });
  }

  private showStatus(text: string) {
    this.removeStatus();
    this.statusId = this.deps.newId();
    this.items = [...this.items, { id: this.statusId, role: 'status', text, isStreaming: true }];
  }

  private removeStatus() {
    if (!this.statusId) return;
    const id = this.statusId;
    this.statusId = null;
    this.items = this.items.filter((m) => m.id !== id);
  }
}
```

**Step 4: Run the test and confirm it passes**

Run: `cd frontend && npx jest src/components/Workspace/chatTurn.test.ts`
Expected: PASS, 6 tests.

**Step 5:** Run `git status`. Do not commit.

---

## Task 18: AIChat on runs (send, reattach, Stop, notices)

**Implementer:** opus. This is the user-facing integration, with subtle races around conversation switching and newly created conversations.
**Files:** Modify `frontend/src/components/Workspace/AIChat.tsx`.

**Step 1: Imports and constants.**
- Replace `import { apiClient, type Conversation, type ChatMessage } from '@/lib/api-client';` with:
  ```ts
  import { apiClient, ApiError, type Conversation, type ChatMessage, type StartRunBody } from '@/lib/api-client';
  import { subscribeRunEvents } from '@/lib/run-events';
  import { ChatTurn } from './chatTurn';
  ```
- Delete `const API_BASE = ...` (line 11). It is no longer used.
- Replace the `STREAM_INTERRUPTED` constant with:
  ```ts
  const RUN_CONNECTION_LOST =
    'Lost the connection to this response. It keeps running on the server, so reopen the conversation to see the result.';
  const RUN_INTERRUPTED_NOTICE =
    'The previous response was interrupted before it finished. Send another message to continue.';
  ```

**Step 2: Add a mapping helper** below `extractText`:

```ts
function toLocalMessages(msgs: ChatMessage[]): LocalMessage[] {
  return msgs
    .filter((m) => extractText(m.content).length > 0)
    .map((m) => ({ id: m.id, role: m.role, text: extractText(m.content) }));
}
```

**Step 3: Refs.** Replace `const abortRef = useRef<AbortController | null>(null);` with:

```ts
  // Local subscription to the active run. Aborting it stops following, not the run.
  const subAbortRef = useRef<AbortController | null>(null);
  const runRef = useRef<{ convId: string; runId: string } | null>(null);
  // Conversation a send is starting a run in, while POST /runs is in flight.
  // Cleared if the user switches away, so the reply isn't drawn into the wrong chat.
  const pendingSendConvRef = useRef<string | null>(null);
  // Stop pressed before POST /runs returned a run id.
  const stopRequestedRef = useRef(false);
```

**Step 4: Add `consumeRun`** inside the component, above `handleSend`:

```ts
  // Follow a run's events into the transcript. `base` is everything before
  // this turn's assistant output (history plus the user's message).
  const consumeRun = async (convId: string, runId: string, base: LocalMessage[]) => {
    subAbortRef.current?.abort('switch');
    const sub = new AbortController();
    subAbortRef.current = sub;
    runRef.current = { convId, runId };
    setStreaming(true);

    const turn = new ChatTurn({ newId: () => crypto.randomUUID(), formatToolStatus }, { placeholder: true });
    setMessages([...base, ...turn.bubbles()]);

    let failure: string | null = null;
    try {
      const result = await subscribeRunEvents({
        conversationId: convId,
        runId,
        signal: sub.signal,
        onEvent: (type, data) => {
          const effect = turn.apply(type, data);
          if (effect === 'graph') onGraphUpdated?.();
          if (effect === 'production') onProductionUpdated?.();
          setMessages([...base, ...turn.bubbles()]);
        },
      });
      if (result === 'lost') failure = RUN_CONNECTION_LOST;
    } finally {
      if (subAbortRef.current === sub) {
        // 'switch' means another conversation took over the transcript; leave it alone.
        if (sub.signal.reason !== 'switch') setMessages([...base, ...turn.settle(failure)]);
        subAbortRef.current = null;
        runRef.current = null;
        setStreaming(false);
      }
    }
  };
```

**Step 5: Rewrite `handleSend` from `setStreaming(true);` to the end of the function.** Keep the guard, the conversation auto-create block, `userText`, `sentAttachments`, and the input/attachment/textarea resets exactly as they are. Replace everything from `setStreaming(true);` through the end of the function's `finally {...}` with:

```ts
    const userMsg: LocalMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: userText,
      attachments: sentAttachments.length > 0 ? sentAttachments : undefined,
    };
    const base = [...messages, userMsg];
    setStreaming(true);
    setMessages([...base, { id: crypto.randomUUID(), role: 'assistant', text: '', isStreaming: true }]);

    const body: StartRunBody = { model: selectedModel };
    if (userText) body.message = userText;
    if (activeCaseId) body.caseId = activeCaseId;
    if (activeInvestigationId) body.investigationId = activeInvestigationId;
    if (attachments.length > 0) {
      body.attachments = attachments.map(({ name, mediaType, data }) => ({ name, mediaType, data }));
    }

    stopRequestedRef.current = false;
    pendingSendConvRef.current = convId;
    let runId: string;
    try {
      ({ runId } = await apiClient.startRun(convId, body));
    } catch (err) {
      if (pendingSendConvRef.current === convId) {
        // Nothing was sent: drop the optimistic bubble, give the draft back, show why.
        const text = err instanceof ApiError ? err.message : 'The request failed. Please try again.';
        setMessages([...messages, { id: crypto.randomUUID(), role: 'assistant', text }]);
        setInput(userText);
        // Clearing attachments at send revoked their blob: previews (see the
        // revoke effect), so restore them with data: URLs built from the base64.
        setAttachments(attachments.map((a) => ({
          ...a,
          previewUrl: a.previewUrl.startsWith('blob:') ? `data:${a.mediaType};base64,${a.data}` : a.previewUrl,
        })));
      }
      pendingSendConvRef.current = null;
      // Another conversation may be following its own run by now; leave its state alone.
      if (!subAbortRef.current) setStreaming(false);
      return;
    }

    const stillHere = pendingSendConvRef.current === convId;
    pendingSendConvRef.current = null;
    if (!stillHere) {
      // The user switched conversations mid-start. The run continues on the
      // server, and reopening that conversation reattaches to it.
      if (!subAbortRef.current) setStreaming(false);
      return;
    }
    if (stopRequestedRef.current) {
      stopRequestedRef.current = false;
      void apiClient.cancelRun(convId, runId).catch(() => {});
    }
    await consumeRun(convId, runId, base);
  };
```

Note that `messages` and `attachments` are read here from the render closure, which is the state captured at send time. That matches the current code, which keeps reading `attachments` after calling `setAttachments([])`.

**Step 6: Stop cancels on the server.** Add above the `return (`:

```ts
  const handleStop = async () => {
    const run = runRef.current;
    if (!run) {
      // POST /runs hasn't returned yet; handleSend cancels as soon as it has the id.
      stopRequestedRef.current = true;
      return;
    }
    try {
      // The run persists what it has and sends `done`; the subscription then settles the turn.
      await apiClient.cancelRun(run.convId, run.runId);
    } catch {
      // Server unreachable: stop following locally. The run may still finish.
      subAbortRef.current?.abort('stop');
    }
  };
```

In the Stop button (~line 1017), change `onClick={() => abortRef.current?.abort()}` to `onClick={handleStop}`.

**Step 7: Reattach on open.** Replace the `activeConvId` effect (lines ~364-386) with:

```ts
  useEffect(() => {
    // Leaving a conversation stops following its run (the run itself continues),
    // and abandons a send that is still starting there.
    if (runRef.current && runRef.current.convId !== activeConvId) subAbortRef.current?.abort('switch');
    if (pendingSendConvRef.current && pendingSendConvRef.current !== activeConvId) {
      pendingSendConvRef.current = null;
      // Don't keep the new conversation's composer locked waiting on the old send.
      if (!subAbortRef.current) setStreaming(false);
    }

    // Skip the server load when we just created this conv locally. Without
    // this, the empty result would wipe the optimistic user+assistant rows
    // and the run being followed for them.
    if (activeConvId && skipNextLoadRef.current === activeConvId) {
      skipNextLoadRef.current = null;
      return;
    }
    if (!activeConvId) { setMessages([]); return; }

    let cancelled = false;
    const convId = activeConvId;
    Promise.all([
      apiClient.getConversationMessages(convId),
      apiClient.getLatestRun(convId).catch(() => ({ run: null })),
    ]).then(([msgs, { run }]) => {
      if (cancelled) return;
      const active = !!run && (run.status === 'queued' || run.status === 'running');
      if (active && run) {
        // Rows after the run's user message are its partial output; the event
        // replay rebuilds them, so cut them to avoid showing them twice.
        const cut = run.userMessageId ? msgs.findIndex((m) => m.id === run.userMessageId) : -1;
        void consumeRun(convId, run.id, toLocalMessages(cut >= 0 ? msgs.slice(0, cut + 1) : msgs));
        return;
      }
      const history = toLocalMessages(msgs);
      if (run && (run.status === 'failed' || run.status === 'interrupted')) {
        const text = run.error
          ? (run.status === 'failed' ? `${run.error.message} (ref: ${run.error.errorId})` : run.error.message)
          : RUN_INTERRUPTED_NOTICE;
        setMessages([...history, { id: `notice-${run.id}`, role: 'assistant', text }]);
        return;
      }
      setMessages(history);
    }).catch(() => {});

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]);

  // Stop following (not the run) when the chat unmounts.
  useEffect(() => () => subAbortRef.current?.abort('switch'), []);
```

**Step 8: Remove dead code.** The old inline stream loop (`reader`, `decoder`, `buf`, `eventType`, `updateMsg`, `removeStatus`, `showStatus`, `finalizeOrDropCurrent`, `finished`, `failure`) should already be gone after Step 5. Run `grep -n "abortRef\|STREAM_INTERRUPTED\|/chat\`" frontend/src/components/Workspace/AIChat.tsx`. It should print nothing.

**Step 9: Verify**

Run: `cd frontend && npx tsc --noEmit && npx jest && npm run build`
Expected: no type errors, all tests pass, and the build succeeds (exhaustive-deps warnings are OK).

**Step 10: Manual check in dev** (backend in-process dispatch). Run `npm run db`, `npm run be` and `npm run fe`, then:
1. Send a message. Text streams in and the composer stays disabled until done.
2. Send a message that triggers tools. Status lines appear and clear.
3. Mid-response, reload the page. The conversation reopens with the history and the running turn replays, then continues live.
4. Press Stop mid-response. The streaming stops within about 3 s, the partial text stays, and after a reload the partial text ends with "(Stopped by user.)".
5. Open the same conversation in two tabs and send from tab 2 while tab 1 is running. Tab 2 shows "A response is already in progress in this conversation.", and its draft text is restored to the composer.
6. While a response streams, click "New conversation". The new chat stays empty. Reopening the old conversation reattaches to the run.

Report the results. Use the `qa` skill if available.

**Step 11:** Run `git status`. Do not commit.

---

## Task 19: Runs doc

**Implementer:** sonnet
**Files:** Create `docs/agent-runs.md`.

**Step 1: Write the doc** with these sections, kept tight and in plain English:
- **Why.** Two sentences on the 2026-10-07 incident: Cloud Run's 300 s timeout, headless loops and duplicate runs.
- **Lifecycle.** `queued → running → succeeded | failed | cancelled | timed_out | interrupted`. Say who performs each transition: the launcher, `claim`, the executor's `finish`, `requestCancel` and `sweepStale`.
- **Flow.** Step by step: `POST /runs` → launcher → dispatcher (Cloud Tasks in prod, in-process in dev) → `POST /internal/agent-runs/:id/execute` (OIDC) → executor → `agent_run_events` → `GET /runs/:id/events?after=` (300 ms poll, 240 s rotation).
- **Guarantees and limits.** One active run per conversation (partial unique index). Single claim. 25-minute cap, with the 30-minute Cloud Tasks deadline. Heartbeat every 3 s and stale after 60 s. Lazy sweep. Event retention (cleared when the next run starts).
- **Config.** `AGENT_RUNS_QUEUE`, `AGENT_RUNS_WORKER_URL` and `AGENT_RUNS_INVOKER_SA`, plus the Cloud Run timeout of 1800 s.
- **Rollout and ops.** Copy the **Rollout runbook** from this plan, leaving out its "For agents" note, and include how to find a run's logs: `run_start`, `turn_model_call`, `run_end`, `run_failed` and `run_interrupted`, all keyed by `runId`.
- **Legacy endpoint.** `POST /conversations/:id/chat` is a bridge. Delete it, along with its contract entry, once request logs show no calls for 7 days.

**Step 2:** Run `git status`. Do not commit.

---

## Rollout runbook (operator, in order)

**For agents: do not run anything in this section.** The user runs it. Run these before pushing the backend change to `main`: Cloud Build auto-deploys, and production boot fails without the env vars. The project, service, runtime service account and URL below were read from `gcloud run services describe daubert-api` on 2026-10-07. Re-check them if the service has moved.

```bash
PROJECT=daubertai-prod
REGION=us-central1
RUNTIME_SA=1054935977337-compute@developer.gserviceaccount.com
INVOKER_SA=agent-runs-invoker@$PROJECT.iam.gserviceaccount.com

# 1. Cloud Tasks queue
gcloud services enable cloudtasks.googleapis.com --project=$PROJECT
gcloud tasks queues create agent-runs --location=$REGION --project=$PROJECT \
  --max-attempts=5 --min-backoff=2s --max-backoff=30s

# 2. Invoker identity: Cloud Tasks signs OIDC tokens as this account
gcloud iam service-accounts create agent-runs-invoker \
  --display-name="Cloud Tasks invoker for agent runs" --project=$PROJECT

# 3. The API (runtime SA) may enqueue and may mint tokens as the invoker
gcloud tasks queues add-iam-policy-binding agent-runs --location=$REGION --project=$PROJECT \
  --member=serviceAccount:$RUNTIME_SA --role=roles/cloudtasks.enqueuer
gcloud iam service-accounts add-iam-policy-binding $INVOKER_SA --project=$PROJECT \
  --member=serviceAccount:$RUNTIME_SA --role=roles/iam.serviceAccountUser

# 4. Service config: 30-min timeout for worker requests, plus the run env vars
gcloud run services update daubert-api --region=$REGION --project=$PROJECT --timeout=1800 \
  --update-env-vars=AGENT_RUNS_QUEUE=projects/$PROJECT/locations/$REGION/queues/agent-runs,AGENT_RUNS_WORKER_URL=https://daubert-api-1054935977337.us-central1.run.app,AGENT_RUNS_INVOKER_SA=$INVOKER_SA
```

5. Apply the migration: `./migrations.sh --prod --run`.
6. **Push 1: backend only.** You commit the backend, contracts and docs changes, push, and wait for Cloud Build to deploy. Then verify from the current (old) frontend: send a message. It goes through the legacy bridge and should work. Check the logs for `run_start` and `run_end`.
7. **Push 2: frontend.** You commit `frontend/` and push, and Vercel deploys. Verify:
   - A turn longer than 5 minutes completes with no 502.
   - Closing the tab mid-turn and reopening it reattaches.
   - Stop works.
8. If Cloud Run invoker IAM is ever enabled on the service, also grant `roles/run.invoker` to `$INVOKER_SA`.

**Follow-ups (separate plans):** delete the legacy `/chat` bridge once it has had no traffic for 7 days. Move the Cloud Run secrets from plain env vars to Secret Manager.
