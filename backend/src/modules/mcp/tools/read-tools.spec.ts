/**
 * ReadToolsService unit tests.
 *
 * Four tools under test:
 *   - get_case_data         — aggregates investigations, productions, data-room manifest.
 *   - read_production       — delegates to ProductionsService, with optional productionId/type.
 *   - query_labeled_entities — dispatches to LabeledEntitiesService (no case scope).
 *   - get_skill             — reads a skill file from the registry by name.
 *
 * Same harness pattern as navigate-tools.spec:
 *   - Build a real McpServer and register handlers via ReadToolsService.registerAll().
 *   - Extract handlers from `_registeredTools` and invoke directly.
 *   - Services are mocked; DI container never runs.
 */

import { ForbiddenException } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CaseAccessService } from '../../auth/case-access.service';
import { AuthSuccess } from '../mcp-auth.helper';
import { ReadToolsService } from './read-tools';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const ORG_ID = 'org-1';
const SESSION_ID = 'sess-1';
const CASE_ID = 'case-uuid-1';
const PROD_ID = 'prod-uuid-1';

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
  investigationRepo?: any;
  productions?: any;
  dataRoom?: any;
  labeledEntities?: any;
} = {}) {
  const caseAccess = {
    assertRole: jest.fn().mockResolvedValue({ id: 'm-1', userId: USER_ID, caseId: CASE_ID, role: 'viewer' }),
    ...overrides.caseAccess,
  } as unknown as CaseAccessService;

  const investigationRepo = {
    find: jest.fn().mockResolvedValue([]),
    ...overrides.investigationRepo,
  };

  const productions = {
    findOne: jest.fn().mockResolvedValue({ id: PROD_ID, name: 'P', type: 'report', caseId: CASE_ID, data: {} }),
    findAllForCase: jest.fn().mockResolvedValue([]),
    ...overrides.productions,
  };

  const dataRoom = {
    getManifest: jest.fn().mockResolvedValue({ files: [], total: 0, truncated: false }),
    ...overrides.dataRoom,
  };

  const labeledEntities = {
    lookupByAddress: jest.fn().mockResolvedValue([]),
    findAll: jest.fn().mockResolvedValue([]),
    ...overrides.labeledEntities,
  };

  const service = new ReadToolsService(
    caseAccess,
    investigationRepo,
    productions,
    dataRoom,
    labeledEntities,
  );
  const server = new McpServer({ name: 'test-mcp', version: '0.0.1' });
  service.registerAll(server, AUTH);

  return { server, caseAccess, investigationRepo, productions, dataRoom, labeledEntities };
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

describe('ReadToolsService', () => {
  // -------------------------------------------------------------------------
  // get_case_data
  // -------------------------------------------------------------------------

  describe('get_case_data', () => {
    it('asserts viewer role before aggregating data', async () => {
      const assertRole = jest.fn().mockResolvedValue({ role: 'viewer' });
      const { server, investigationRepo, productions, dataRoom } = buildService({
        caseAccess: { assertRole },
        investigationRepo: {
          find: jest.fn().mockResolvedValue([
            {
              id: 'inv-1',
              name: 'Inv A',
              traces: [{ data: { nodes: [1, 2], edges: [1] } }],
            },
          ]),
        },
        productions: {
          findAllForCase: jest.fn().mockResolvedValue([
            { id: PROD_ID, name: 'Prod A', type: 'report', data: { big: 'payload' } },
          ]),
        },
        dataRoom: {
          getManifest: jest.fn().mockResolvedValue({
            files: [{ name: 'doc.pdf', driveFileId: 'x' }],
            total: 1,
            truncated: false,
          }),
        },
      });

      const result = await callTool(server, 'get_case_data', { caseId: CASE_ID });

      // assertRole MUST be called first
      expect(assertRole).toHaveBeenCalledWith(AUTH.principal, CASE_ID, 'viewer');
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      // investigations summary
      expect(parsed.investigations).toHaveLength(1);
      expect(parsed.investigations[0]).toMatchObject({
        id: 'inv-1',
        name: 'Inv A',
        traceCount: 1,
        totalNodes: 2,
        totalEdges: 1,
      });
      // productions summary strips `data` field
      expect(parsed.productions).toHaveLength(1);
      expect(parsed.productions[0]).toMatchObject({ id: PROD_ID, name: 'Prod A', type: 'report' });
      expect(parsed.productions[0]).not.toHaveProperty('data');
      // data room
      expect(parsed.dataRoom).toMatchObject({ available: true, fileCount: 1, truncated: false });
    });

    it('surfaces ForbiddenException as isError and does NOT query any service', async () => {
      const assertRole = jest.fn().mockRejectedValue(new ForbiddenException('cross_org_access'));
      const { server, investigationRepo, productions, dataRoom } = buildService({
        caseAccess: { assertRole },
      });

      const result = await callTool(server, 'get_case_data', { caseId: 'other-case' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('cross_org_access');
      expect(investigationRepo.find).not.toHaveBeenCalled();
      expect(productions.findAllForCase).not.toHaveBeenCalled();
      expect(dataRoom.getManifest).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // read_production
  // -------------------------------------------------------------------------

  describe('read_production', () => {
    it('surfaces ForbiddenException from assertRole; productionsService NOT called', async () => {
      const assertRole = jest.fn().mockRejectedValue(new ForbiddenException('cross_org_access'));
      const { server, productions } = buildService({ caseAccess: { assertRole } });

      const result = await callTool(server, 'read_production', { caseId: CASE_ID, productionId: PROD_ID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('cross_org_access');
      expect(productions.findOne).not.toHaveBeenCalled();
      expect(productions.findAllForCase).not.toHaveBeenCalled();
    });

    it('calls findOne when productionId is given', async () => {
      const production = { id: PROD_ID, name: 'P', type: 'report', caseId: CASE_ID, data: { x: 1 } };
      const { server, productions } = buildService({
        productions: { findOne: jest.fn().mockResolvedValue(production) },
      });

      const result = await callTool(server, 'read_production', { caseId: CASE_ID, productionId: PROD_ID });

      expect(productions.findOne).toHaveBeenCalled();
      expect(productions.findAllForCase).not.toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
    });

    it('calls findAllForCase when no productionId is given', async () => {
      const { server, productions } = buildService();

      await callTool(server, 'read_production', { caseId: CASE_ID });

      expect(productions.findAllForCase).toHaveBeenCalled();
      expect(productions.findOne).not.toHaveBeenCalled();
    });

    it('passes type to findAllForCase when type is provided', async () => {
      const { server, productions } = buildService();

      await callTool(server, 'read_production', { caseId: CASE_ID, type: 'report' });

      // findAllForCase receives the type arg (3rd positional param per signature)
      const call = (productions.findAllForCase as jest.Mock).mock.calls[0];
      expect(call[0]).toBe(CASE_ID);   // caseId
      expect(call[2]).toBe('report');  // type
    });
  });

  // -------------------------------------------------------------------------
  // query_labeled_entities
  // -------------------------------------------------------------------------

  describe('query_labeled_entities', () => {
    it('calls lookupByAddress when address is provided', async () => {
      const matches = [{ id: 'le-1', name: 'Acme', wallets: ['0xabc'] }];
      const { server, labeledEntities } = buildService({
        labeledEntities: { lookupByAddress: jest.fn().mockResolvedValue(matches) },
      });

      const result = await callTool(server, 'query_labeled_entities', { address: '0xabc' });

      expect(labeledEntities.lookupByAddress).toHaveBeenCalledWith('0xabc');
      expect(labeledEntities.findAll).not.toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed[0].name).toBe('Acme');
    });

    it('calls findAll when no address is provided', async () => {
      const { server, labeledEntities } = buildService();

      await callTool(server, 'query_labeled_entities', { search: 'exchange' });

      expect(labeledEntities.findAll).toHaveBeenCalled();
      expect(labeledEntities.lookupByAddress).not.toHaveBeenCalled();
    });

    it('does NOT require caseId (no assertRole called)', async () => {
      const assertRole = jest.fn();
      const { server } = buildService({ caseAccess: { assertRole } });

      await callTool(server, 'query_labeled_entities', { address: '0x123' });

      expect(assertRole).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // get_skill
  // -------------------------------------------------------------------------

  describe('get_skill', () => {
    it('returns content for a known skill name', async () => {
      const { server } = buildService();

      const result = await callTool(server, 'get_skill', { name: 'graph-mutations' });

      expect(result.isError).toBeUndefined();
      // The skill file is large — textResult may truncate the JSON-stringified
      // string at 8 KB and append a truncation suffix. Check the raw text starts
      // with a JSON string delimiter and contains non-trivial content.
      expect(result.content[0].text).toMatch(/^"/);
      expect(result.content[0].text.length).toBeGreaterThan(100);
    });

    it('returns { error } for an unknown skill name (not a crash)', async () => {
      const { server } = buildService();

      const result = await callTool(server, 'get_skill', { name: 'does-not-exist' });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('error');
    });
  });
});
