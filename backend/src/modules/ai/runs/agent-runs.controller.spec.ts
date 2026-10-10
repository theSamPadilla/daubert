import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgentRunsController } from './agent-runs.controller';
import { SUBSCRIPTION_MAX_MS } from './agent-run-events.streamer';

describe('AgentRunsController', () => {
  const req = { principal: { kind: 'user', userId: 'user-1' } };
  const run = { id: 'run-1', conversationId: 'conv-1', status: 'running', userMessageId: 'msg-1', error: null, createdAt: new Date(0), finishedAt: null };
  let conversations: any, caseAccess: any, runs: any, launcher: any, streamer: any;
  let controller: AgentRunsController;

  beforeEach(() => {
    conversations = { findOne: jest.fn().mockResolvedValue({ id: 'conv-1', caseId: 'case-1' }) };
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

  it('start rejects a caseId that does not match the conversation', async () => {
    const body = { message: 'hi', caseId: 'case-2' } as any;
    await expect(controller.start('conv-1', body, req)).rejects.toBeInstanceOf(BadRequestException);
    expect(launcher.start).not.toHaveBeenCalled();
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
