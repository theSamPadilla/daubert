import { ForbiddenException } from '@nestjs/common';
import { McpActivityRecorder, MCP_CASE_TOOLS, MCP_UNSCOPED_TOOLS } from './case-activity-recorder';

const auth = {
  kind: 'oauth',
  user: { id: 'user-1' },
  session: { id: 'sess-1', surfaceLabel: 'Claude Desktop' },
  principal: { kind: 'mcp', userId: 'user-1', organizationId: 'org-1', sessionId: 'sess-1' },
} as any;

function setup() {
  const activity = { record: jest.fn().mockResolvedValue(undefined) };
  const caseAccess = { assertAccess: jest.fn().mockResolvedValue(null) };
  const traceRepo = { findOne: jest.fn() };
  const productionRepo = { findOne: jest.fn() };
  const recorder = new McpActivityRecorder(activity as any, caseAccess as any, traceRepo as any, productionRepo as any);
  const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>();
  const server = { registerTool: jest.fn((name: string, _c: unknown, h: any) => handlers.set(name, h)) } as any;
  const wrapped = recorder.wrap(server, auth);
  return { activity, caseAccess, traceRepo, productionRepo, wrapped, handlers, server };
}

const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

it('records a case-scoped tool with the session label and id', async () => {
  const { activity, wrapped, handlers } = setup();
  wrapped.registerTool('get_case_data', {}, async () => ok({ investigations: [1, 2] }));
  const result = await handlers.get('get_case_data')!({ caseId: 'case-1' }, {});
  expect(result).toEqual(ok({ investigations: [1, 2] }));
  expect(activity.record).toHaveBeenCalledWith({
    caseId: 'case-1', userId: 'user-1', source: 'mcp', agent: 'Claude Desktop', mcpSessionId: 'sess-1',
    action: 'get_case_data', input: { caseId: 'case-1' }, status: 'ok', summary: { investigationsCount: 2 },
  });
});

it('resolves the case from a trace for import_transactions', async () => {
  const { activity, traceRepo, wrapped, handlers } = setup();
  traceRepo.findOne.mockResolvedValue({ id: 't1', investigation: { caseId: 'case-9' } });
  wrapped.registerTool('import_transactions', {}, async () => ok({ imported: 3 }));
  await handlers.get('import_transactions')!({ traceId: 't1', transactions: [] }, {});
  expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'case-9', action: 'import_transactions' }));
});

it('resolves the case from a production for update_production', async () => {
  const { activity, productionRepo, wrapped, handlers } = setup();
  productionRepo.findOne.mockResolvedValue({ id: 'p1', caseId: 'case-7' });
  wrapped.registerTool('update_production', {}, async () => ok({ id: 'p1' }));
  await handlers.get('update_production')!({ productionId: 'p1' }, {});
  expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'case-7' }));
});

it('registers unscoped tools untouched and never records them', async () => {
  const { activity, wrapped, server } = setup();
  const handler = async () => ok([]);
  wrapped.registerTool('list_cases', {}, handler);
  expect(server.registerTool).toHaveBeenCalledWith('list_cases', {}, handler);
  expect(activity.record).not.toHaveBeenCalled();
});

it('does not record into a case the caller cannot access', async () => {
  const { activity, caseAccess, wrapped, handlers } = setup();
  caseAccess.assertAccess.mockRejectedValue(new ForbiddenException());
  wrapped.registerTool('get_case', {}, async () => ({ isError: true, content: [{ type: 'text', text: 'Forbidden' }] }));
  await handlers.get('get_case')!({ caseId: 'someone-elses' }, {});
  expect(activity.record).not.toHaveBeenCalled();
});

it('records error envelopes as failures', async () => {
  const { activity, wrapped, handlers } = setup();
  wrapped.registerTool('create_production', {}, async () => ({ isError: true, content: [{ type: 'text', text: 'Invalid data' }] }));
  await handlers.get('create_production')!({ caseId: 'case-1', name: 'R' }, {});
  expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', summary: { error: 'Invalid data' } }));
});

it('records a thrown handler as a failure and rethrows', async () => {
  const { activity, wrapped, handlers } = setup();
  wrapped.registerTool('get_case', {}, async () => { throw new Error('boom'); });
  await expect(handlers.get('get_case')!({ caseId: 'case-1' }, {})).rejects.toThrow('boom');
  expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', summary: { error: 'boom' } }));
});

it('classifies every tool exactly once', () => {
  for (const name of MCP_UNSCOPED_TOOLS) expect(MCP_CASE_TOOLS[name]).toBeUndefined();
});
