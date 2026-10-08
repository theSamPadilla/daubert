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

  it('sweeps a queued run that was never delivered, and leaves a fresh one alone', async () => {
    const conv = await newConversation();
    const run = await queue(conv);
    await service.attachUserMessage(run.id, '00000000-0000-0000-0000-000000000001');
    await service.sweepStale(conv);
    expect((await runRepo.findOneByOrFail({ id: run.id })).status).toBe('queued');
    await runRepo.query(`UPDATE agent_runs SET created_at = created_at - interval '10 minutes' WHERE id = $1`, [run.id]);
    await service.sweepStale(conv);
    expect((await runRepo.findOneByOrFail({ id: run.id })).status).toBe('interrupted');
    expect((await events(run.id)).map((e) => e.type)).toEqual(['error', 'done']);
    expect(conversations.appendTerminatorIfToolResultTail).toHaveBeenCalledWith(conv);
    expect(await service.claim(run.id)).toBeNull();
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
