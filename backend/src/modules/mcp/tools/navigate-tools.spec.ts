/**
 * NavigateToolsService unit tests.
 *
 * Tool pattern under test (BYOA MCP, Task 12 — establishes the shape later
 * tool tasks copy):
 *   - Build a real McpServer and let NavigateToolsService.registerAll() register
 *     its tools on it. Extract registered handlers from the SDK's internal
 *     `_registeredTools` map and invoke them directly. This skips the protocol
 *     stack — we are unit-testing handler behavior, not the transport.
 *   - Mock CasesService, InvestigationsService, and CaseAccessService.
 *   - For case-scoped tools, `caseAccess.assertRole(auth.principal, caseId, 'viewer')`
 *     is the gate. We assert it is called with the EXACT principal and minRole.
 *   - Errors from services (ForbiddenException etc.) MUST be surfaced as MCP
 *     tool errors `{ isError: true, content: [{ type: 'text', text }] }` — they
 *     must not crash the handler / transport.
 */

import { ForbiddenException } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CasesService } from '../../cases/cases.service';
import { InvestigationsService } from '../../investigations/investigations.service';
import { CaseAccessService } from '../../auth/case-access.service';
import { AuthSuccess } from '../mcp-auth.helper';
import { NavigateToolsService } from './navigate-tools';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const ORG_ID = 'org-1';
const SESSION_ID = 'sess-1';
const CASE_ID = 'case-1';

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
// Harness: build a real NavigateToolsService with mocked deps and register
// on a real McpServer. Return the server + the mocks for assertion.
// ---------------------------------------------------------------------------

function buildService(
  overrides: Partial<{
    cases: Partial<CasesService>;
    investigations: Partial<InvestigationsService>;
    caseAccess: Partial<CaseAccessService>;
  }> = {},
) {
  const cases = {
    findAllForUserInOrg: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: CASE_ID, name: 'Case' }),
    ...overrides.cases,
  } as unknown as CasesService;

  const investigations = {
    findAllForCase: jest.fn().mockResolvedValue([]),
    ...overrides.investigations,
  } as unknown as InvestigationsService;

  const caseAccess = {
    assertRole: jest.fn().mockResolvedValue({ id: 'm-1', userId: USER_ID, caseId: CASE_ID, role: 'viewer' }),
    ...overrides.caseAccess,
  } as unknown as CaseAccessService;

  const service = new NavigateToolsService(cases, investigations, caseAccess);
  const server = new McpServer({ name: 'test-mcp', version: '0.0.1' });
  service.registerAll(server, AUTH);

  return { server, cases, investigations, caseAccess };
}

// ---------------------------------------------------------------------------
// callTool — invoke a registered handler by reaching into the SDK's internal
// `_registeredTools` map. This mirrors belong-mc's harness.
// ---------------------------------------------------------------------------

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
  // SDK 1.29 hands the handler (parsedArgs, extra) for input-schemaful tools
  // and (extra) for zero-arg tools. We pass a stub extra; handlers under test
  // do not read it.
  const extra = {} as unknown;
  const result =
    Object.keys(args).length > 0
      ? await tool.handler(args, extra)
      : await tool.handler(extra);
  return result as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NavigateToolsService', () => {
  // -------------------------------------------------------------------------
  // list_cases
  // -------------------------------------------------------------------------

  describe('list_cases', () => {
    it('calls CasesService.findAllForUserInOrg with the bound user and organizationId', async () => {
      const cases = [
        { id: 'c1', name: 'Case A', orgId: ORG_ID, role: 'owner' },
        { id: 'c2', name: 'Case B', orgId: ORG_ID, role: 'editor' },
      ];
      const { server, cases: casesMock } = buildService({
        cases: { findAllForUserInOrg: jest.fn().mockResolvedValue(cases) },
      });

      const result = await callTool(server, 'list_cases');

      expect((casesMock.findAllForUserInOrg as jest.Mock)).toHaveBeenCalledWith(USER, ORG_ID);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Array<{ id: string; name: string; role: string }>;
      expect(parsed).toEqual([
        { id: 'c1', name: 'Case A', role: 'owner' },
        { id: 'c2', name: 'Case B', role: 'editor' },
      ]);
    });

    it('returns only id/name/role projection (does not leak full case fields)', async () => {
      const cases = [
        {
          id: 'c1',
          name: 'Case A',
          orgId: ORG_ID,
          role: 'owner',
          summary: 'secret',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const { server } = buildService({
        cases: { findAllForUserInOrg: jest.fn().mockResolvedValue(cases) },
      });

      const result = await callTool(server, 'list_cases');
      const parsed = JSON.parse(result.content[0].text) as Array<Record<string, unknown>>;
      expect(parsed[0]).toEqual({ id: 'c1', name: 'Case A', role: 'owner' });
      expect(parsed[0]).not.toHaveProperty('summary');
      expect(parsed[0]).not.toHaveProperty('orgId');
    });

    it('surfaces service errors as isError tool results (does not throw)', async () => {
      const { server } = buildService({
        cases: { findAllForUserInOrg: jest.fn().mockRejectedValue(new Error('db down')) },
      });

      const result = await callTool(server, 'list_cases');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('db down');
    });
  });

  // -------------------------------------------------------------------------
  // get_case
  // -------------------------------------------------------------------------

  describe('get_case', () => {
    it('asserts viewer role on the case before calling findOne', async () => {
      const membership = { id: 'm-1', userId: USER_ID, caseId: CASE_ID, role: 'editor' };
      const assertRole = jest.fn().mockResolvedValue(membership);
      const findOne = jest.fn().mockResolvedValue({ id: CASE_ID, name: 'C', role: 'editor' });

      const { server } = buildService({
        caseAccess: { assertRole },
        cases: { findOne },
      });

      const result = await callTool(server, 'get_case', { caseId: CASE_ID });

      expect(assertRole).toHaveBeenCalledWith(AUTH.principal, CASE_ID, 'viewer');
      expect(findOne).toHaveBeenCalledWith(CASE_ID, 'editor');
      expect(result.isError).toBeUndefined();
    });

    it('surfaces cross_org_access as an MCP tool error (assertRole throws ForbiddenException)', async () => {
      const assertRole = jest.fn().mockRejectedValue(new ForbiddenException('cross_org_access'));
      const { server } = buildService({
        caseAccess: { assertRole },
      });

      const result = await callTool(server, 'get_case', { caseId: 'case-other-org' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('cross_org_access');
    });

    it('surfaces case_not_found as an MCP tool error (opaque per assertAccess)', async () => {
      const assertRole = jest.fn().mockRejectedValue(new ForbiddenException('case_not_found'));
      const { server } = buildService({
        caseAccess: { assertRole },
      });

      const result = await callTool(server, 'get_case', { caseId: 'missing' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('case_not_found');
    });
  });

  // -------------------------------------------------------------------------
  // list_investigations
  // -------------------------------------------------------------------------

  describe('list_investigations', () => {
    it('asserts viewer role on the case before listing investigations', async () => {
      const assertRole = jest.fn().mockResolvedValue({ role: 'viewer' });
      const findAllForCase = jest.fn().mockResolvedValue([
        { id: 'inv-1', name: 'Inv 1', caseId: CASE_ID },
      ]);

      const { server } = buildService({
        caseAccess: { assertRole },
        investigations: { findAllForCase },
      });

      const result = await callTool(server, 'list_investigations', { caseId: CASE_ID });

      expect(assertRole).toHaveBeenCalledWith(AUTH.principal, CASE_ID, 'viewer');
      expect(findAllForCase).toHaveBeenCalledWith(CASE_ID);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text) as Array<{ id: string }>;
      expect(parsed[0].id).toBe('inv-1');
    });

    it('surfaces ForbiddenException from assertRole as an MCP tool error', async () => {
      const assertRole = jest.fn().mockRejectedValue(new ForbiddenException('cross_org_access'));
      const { server, investigations } = buildService({
        caseAccess: { assertRole },
      });

      const result = await callTool(server, 'list_investigations', { caseId: 'case-other' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('cross_org_access');
      // Defense-in-depth: investigations.findAllForCase MUST NOT be called when
      // assertRole rejects — the role check is the gate.
      expect((investigations.findAllForCase as jest.Mock)).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Shared result-cap behavior (the helper later tool tasks reuse).
  // -------------------------------------------------------------------------

  describe('result truncation (~8 KB cap)', () => {
    it('truncates list_cases output when JSON exceeds the cap', async () => {
      // Build a list whose JSON projection exceeds 8 KB. Each row's projection
      // is { id, name, role }; pad names so we cross the threshold.
      const padding = 'x'.repeat(200);
      const big = Array.from({ length: 200 }, (_, i) => ({
        id: `c${i}`,
        name: `Case ${i} ${padding}`,
        orgId: ORG_ID,
        role: 'editor',
      }));
      const { server } = buildService({
        cases: { findAllForUserInOrg: jest.fn().mockResolvedValue(big) },
      });

      const result = await callTool(server, 'list_cases');

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toMatch(/truncated/);
      expect(result.content[0].text.length).toBeLessThan(JSON.stringify(big.map((c) => ({ id: c.id, name: c.name, role: c.role }))).length);
    });
  });
});
