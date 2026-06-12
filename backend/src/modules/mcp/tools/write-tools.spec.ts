/**
 * WriteToolsService unit tests.
 *
 * Four mutation tools under test (Task 16 — BYOA MCP security criterion #4:
 * every agent mutation is audited with (session, user, org) attribution):
 *   - create_investigation   — creates an investigation under a case.
 *   - import_transactions    — adds parsed txs to a trace.
 *   - create_production      — creates a production under a case.
 *   - update_production      — updates a production (name/data/ops).
 *
 * Acceptance criteria exercised here:
 *   (a) viewer-only / cross-org failures throw → tool result `isError`,
 *       AND an audit row is written with `status='error'` and detail.message.
 *   (b) successful editor mutation calls the service AND writes
 *       `status='ok'` with detail describing the result.
 *   (c) audit rows MUST carry (auth.session.id, auth.principal.userId,
 *       auth.principal.organizationId) exactly.
 *
 * Harness mirrors navigate-tools.spec / read-tools.spec — build a real
 * McpServer, register handlers via WriteToolsService.registerAll(), then
 * pluck the handler out of `_registeredTools` and invoke it directly.
 */

import { ForbiddenException } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CaseAccessService } from '../../auth/case-access.service';
import { InvestigationsService } from '../../investigations/investigations.service';
import { TracesService } from '../../traces/traces.service';
import { ProductionsService } from '../../productions/productions.service';
import { AgentAuditService } from '../agent-audit.service';
import { AuthSuccess } from '../mcp-auth.helper';
import { WriteToolsService } from './write-tools';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const CASE_ID = '44444444-4444-4444-4444-444444444444';
const TRACE_ID = '55555555-5555-5555-5555-555555555555';
const PROD_ID = '66666666-6666-6666-6666-666666666666';

const USER = { id: USER_ID, email: 'u@example.com' } as any;
const SESSION = { id: SESSION_ID, ownerUserId: USER_ID, organizationId: ORG_ID } as any;

const AUTH: AuthSuccess = {
  kind: 'oauth',
  user: USER,
  session: SESSION,
  principal: {
    kind: 'mcp',
    userId: USER_ID,
    organizationId: ORG_ID,
    sessionId: SESSION_ID,
  },
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function buildService(overrides: {
  caseAccess?: any;
  investigations?: any;
  traces?: any;
  productions?: any;
  audit?: any;
} = {}) {
  const caseAccess = {
    assertRole: jest.fn().mockResolvedValue({ id: 'm-1', userId: USER_ID, caseId: CASE_ID, role: 'editor' }),
    ...overrides.caseAccess,
  } as unknown as CaseAccessService;

  const investigations = {
    create: jest.fn().mockResolvedValue({ id: 'inv-new', name: 'Inv A', caseId: CASE_ID }),
    ...overrides.investigations,
  } as unknown as InvestigationsService;

  const traces = {
    importTransactions: jest
      .fn()
      .mockResolvedValue({ added: { nodes: 2, edges: 3 } }),
    ...overrides.traces,
  } as unknown as TracesService;

  const productions = {
    create: jest.fn().mockResolvedValue({ id: PROD_ID, name: 'P', type: 'report', caseId: CASE_ID }),
    update: jest.fn().mockResolvedValue({ id: PROD_ID, name: 'P', type: 'report', caseId: CASE_ID }),
    ...overrides.productions,
  } as unknown as ProductionsService;

  const audit = {
    log: jest.fn().mockResolvedValue(undefined),
    ...overrides.audit,
  } as unknown as AgentAuditService;

  const service = new WriteToolsService(
    caseAccess,
    investigations,
    traces,
    productions,
    audit,
  );
  const server = new McpServer({ name: 'test-mcp', version: '0.0.1' });
  service.registerAll(server, AUTH);

  return { server, caseAccess, investigations, traces, productions, audit };
}

async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const tools = (server as any)._registeredTools as Record<
    string,
    { handler: (...handlerArgs: unknown[]) => Promise<unknown> }
  >;
  const tool = tools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  const extra = {} as unknown;
  const result =
    Object.keys(args).length > 0
      ? await tool.handler(args, extra)
      : await tool.handler(extra);
  return result as { content: { type: string; text: string }[]; isError?: boolean };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WriteToolsService', () => {
  // -------------------------------------------------------------------------
  // create_investigation
  // -------------------------------------------------------------------------

  describe('create_investigation', () => {
    it('asserts editor before creating; audits ok with attribution', async () => {
      const assertRole = jest.fn().mockResolvedValue({ role: 'editor' });
      const { server, investigations, audit } = buildService({
        caseAccess: { assertRole },
      });

      const result = await callTool(server, 'create_investigation', {
        caseId: CASE_ID,
        name: 'Inv A',
        notes: 'notes here',
      });

      expect(assertRole).toHaveBeenCalledWith(AUTH.principal, CASE_ID, 'editor');
      expect(investigations.create).toHaveBeenCalledWith(CASE_ID, {
        name: 'Inv A',
        notes: 'notes here',
      });
      expect(result.isError).toBeUndefined();

      // Audit row carries exact (session, user, org) attribution.
      expect(audit.log).toHaveBeenCalledTimes(1);
      const params = (audit.log as jest.Mock).mock.calls[0][0];
      expect(params).toMatchObject({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'create_investigation',
        targetRef: `case:${CASE_ID}`,
        status: 'ok',
      });
    });

    it('on a viewer-only case: tool result isError, audits status=error, service NOT called', async () => {
      const assertRole = jest
        .fn()
        .mockRejectedValue(new ForbiddenException(`Requires role 'editor' or higher`));
      const { server, investigations, audit } = buildService({
        caseAccess: { assertRole },
      });

      const result = await callTool(server, 'create_investigation', {
        caseId: CASE_ID,
        name: 'Inv A',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('editor');
      expect(investigations.create).not.toHaveBeenCalled();

      expect(audit.log).toHaveBeenCalledTimes(1);
      const params = (audit.log as jest.Mock).mock.calls[0][0];
      expect(params).toMatchObject({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'create_investigation',
        targetRef: `case:${CASE_ID}`,
        status: 'error',
      });
      // detail captures the error message so operators can grep audit rows.
      expect(params.detail).toBeDefined();
      expect(JSON.stringify(params.detail)).toContain('editor');
    });
  });

  // -------------------------------------------------------------------------
  // import_transactions
  // -------------------------------------------------------------------------

  describe('import_transactions', () => {
    it('calls tracesService.importTransactions with the mcp principal; audits ok with detail.added', async () => {
      const importFn = jest
        .fn()
        .mockResolvedValue({ added: { nodes: 1, edges: 4 } });
      const { server, traces, audit } = buildService({
        traces: { importTransactions: importFn },
      });

      const txs = [
        {
          from: '0xabc',
          to: '0xdef',
          txHash: '0xhash1',
          chain: 'ethereum',
          timestamp: '2026-01-01T00:00:00Z',
          amount: '1.5',
          token: 'USDT', // SYMBOL STRING, not an object
        },
      ];

      const result = await callTool(server, 'import_transactions', {
        traceId: TRACE_ID,
        transactions: txs,
      });

      expect(importFn).toHaveBeenCalledTimes(1);
      const [traceIdArg, dtoArg, principalArg] = importFn.mock.calls[0];
      expect(traceIdArg).toBe(TRACE_ID);
      expect(dtoArg).toEqual({ transactions: txs });
      // Defense-in-depth: the SAME mcp principal must flow into the service.
      expect(principalArg).toBe(AUTH.principal);

      expect(result.isError).toBeUndefined();

      expect(audit.log).toHaveBeenCalledTimes(1);
      const params = (audit.log as jest.Mock).mock.calls[0][0];
      expect(params).toMatchObject({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'import_transactions',
        targetRef: `trace:${TRACE_ID}`,
        status: 'ok',
      });
      // detail surfaces the service's count payload.
      expect(params.detail).toMatchObject({ added: { nodes: 1, edges: 4 } });
    });

    it('audits status=error when the service rejects (e.g. forbidden)', async () => {
      const importFn = jest
        .fn()
        .mockRejectedValue(new ForbiddenException('cross_org_access'));
      const { server, audit } = buildService({
        traces: { importTransactions: importFn },
      });

      const result = await callTool(server, 'import_transactions', {
        traceId: TRACE_ID,
        transactions: [
          {
            from: '0xa',
            to: '0xb',
            txHash: '0xh',
            chain: 'ethereum',
            timestamp: '2026-01-01T00:00:00Z',
            amount: '1',
            token: 'ETH',
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('cross_org_access');

      expect(audit.log).toHaveBeenCalledTimes(1);
      const params = (audit.log as jest.Mock).mock.calls[0][0];
      expect(params).toMatchObject({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'import_transactions',
        targetRef: `trace:${TRACE_ID}`,
        status: 'error',
      });
      expect(JSON.stringify(params.detail)).toContain('cross_org_access');
    });
  });

  // -------------------------------------------------------------------------
  // create_production
  // -------------------------------------------------------------------------

  describe('create_production', () => {
    it('calls productionsService.create and audits ok', async () => {
      const create = jest
        .fn()
        .mockResolvedValue({ id: PROD_ID, name: 'P', type: 'report' });
      const { server, productions, audit } = buildService({
        productions: { create },
      });

      const data = { foo: 'bar' };
      const result = await callTool(server, 'create_production', {
        caseId: CASE_ID,
        name: 'P',
        type: 'report',
        data,
      });

      expect(create).toHaveBeenCalledTimes(1);
      const [caseIdArg, dtoArg, principalArg] = create.mock.calls[0];
      expect(caseIdArg).toBe(CASE_ID);
      expect(dtoArg).toMatchObject({ name: 'P', type: 'report', data });
      expect(principalArg).toBe(AUTH.principal);

      expect(result.isError).toBeUndefined();

      expect(audit.log).toHaveBeenCalledTimes(1);
      const params = (audit.log as jest.Mock).mock.calls[0][0];
      expect(params).toMatchObject({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'create_production',
        targetRef: `case:${CASE_ID}`,
        status: 'ok',
      });
    });

    it('cross-org case: assertRole throws, audits status=error, service NOT called', async () => {
      const assertRole = jest
        .fn()
        .mockRejectedValue(new ForbiddenException('cross_org_access'));
      const { server, productions, audit } = buildService({
        caseAccess: { assertRole },
      });

      const result = await callTool(server, 'create_production', {
        caseId: CASE_ID,
        name: 'P',
        type: 'report',
        data: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('cross_org_access');
      expect(productions.create).not.toHaveBeenCalled();

      expect(audit.log).toHaveBeenCalledTimes(1);
      const params = (audit.log as jest.Mock).mock.calls[0][0];
      expect(params).toMatchObject({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'create_production',
        targetRef: `case:${CASE_ID}`,
        status: 'error',
      });
      expect(JSON.stringify(params.detail)).toContain('cross_org_access');
    });
  });

  // -------------------------------------------------------------------------
  // update_production
  // -------------------------------------------------------------------------

  describe('update_production', () => {
    it('calls productionsService.update and audits ok with attribution', async () => {
      const update = jest
        .fn()
        .mockResolvedValue({ id: PROD_ID, name: 'P2' });
      const { server, productions, audit } = buildService({
        productions: { update },
      });

      const ops = [{ op: 'chart_set_height', height: 400 }];
      const result = await callTool(server, 'update_production', {
        productionId: PROD_ID,
        name: 'P2',
        ops,
      });

      expect(update).toHaveBeenCalledTimes(1);
      const [prodIdArg, dtoArg, principalArg] = update.mock.calls[0];
      expect(prodIdArg).toBe(PROD_ID);
      expect(dtoArg).toMatchObject({ name: 'P2', ops });
      expect(principalArg).toBe(AUTH.principal);

      expect(result.isError).toBeUndefined();

      expect(audit.log).toHaveBeenCalledTimes(1);
      const params = (audit.log as jest.Mock).mock.calls[0][0];
      expect(params).toMatchObject({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'update_production',
        targetRef: `production:${PROD_ID}`,
        status: 'ok',
      });
    });

    it('audits status=error when the service rejects', async () => {
      const update = jest
        .fn()
        .mockRejectedValue(new ForbiddenException(`Requires role 'editor' or higher`));
      const { server, audit } = buildService({
        productions: { update },
      });

      const result = await callTool(server, 'update_production', {
        productionId: PROD_ID,
        name: 'P2',
      });

      expect(result.isError).toBe(true);

      expect(audit.log).toHaveBeenCalledTimes(1);
      const params = (audit.log as jest.Mock).mock.calls[0][0];
      expect(params).toMatchObject({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'update_production',
        targetRef: `production:${PROD_ID}`,
        status: 'error',
      });
    });
  });
});
