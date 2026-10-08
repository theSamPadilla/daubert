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

  it('rolls back the saved message when linking it to the run fails', async () => {
    const boom = new Error('db down');
    runs.attachUserMessage.mockRejectedValue(boom);
    await expect(launcher.start(input)).rejects.toBe(boom);
    expect(runs.failQueued).toHaveBeenCalled();
    expect(conversations.deleteMessage).toHaveBeenCalledWith('conv-1', 'msg-1');
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('rolls back the user message and fails the run when dispatch fails', async () => {
    dispatcher.dispatch.mockRejectedValue(new Error('tasks down'));
    await expect(launcher.start(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(conversations.deleteMessage).toHaveBeenCalledWith('conv-1', 'msg-1');
    expect(runs.failQueued).toHaveBeenCalledWith(run, expect.objectContaining({ errorId: expect.any(String) }));
  });
});
