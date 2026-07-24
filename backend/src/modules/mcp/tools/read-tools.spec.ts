/**
 * ReadToolsService unit tests.
 *
 * Eight tools under test:
 *   - get_case_data         — aggregates investigations, productions, data-room manifest.
 *   - read_production       — delegates to ProductionsService, with optional productionId/type.
 *   - query_labeled_entities — dispatches to LabeledEntitiesService (no case scope).
 *   - get_skill             — reads a skill file from the registry by name.
 *   - get_declarants        — dispatches to DeclarantsService (no case scope).
 *   - get_declaration_library — dispatches to DeclarationLibraryService (no case scope).
 *   - list_data_room_files  — dispatches to DataRoomService.getManifest.
 *   - read_data_room_file   — dispatches to DataRoomService.getFileBufferForAgent +
 *                             extractFileForMcp; bypasses textResult's 8 KB cap.
 *
 * Same harness pattern as navigate-tools.spec:
 *   - Build a real McpServer and register handlers via ReadToolsService.registerAll().
 *   - Extract handlers from `_registeredTools` and invoke directly.
 *   - Services are mocked; DI container never runs.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CaseAccessService } from '../../auth/case-access.service';
import { AuthSuccess } from '../mcp-auth.helper';
import { ReadToolsService } from './read-tools';
import { extractFileForMcp } from '../../data-room/file-text';

jest.mock('../../data-room/file-text', () => ({
  extractFileForMcp: jest.fn(),
}));

const mockExtractFileForMcp = extractFileForMcp as jest.Mock;

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
  declarantsService?: any;
  declarationLibraryService?: any;
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
    getFileBufferForAgent: jest.fn().mockResolvedValue({
      tooLarge: false,
      name: 'f',
      mimeType: 'text/plain',
      size: 0,
      buffer: Buffer.from(''),
    }),
    ...overrides.dataRoom,
  };

  const labeledEntities = {
    lookupByAddress: jest.fn().mockResolvedValue([]),
    findAll: jest.fn().mockResolvedValue([]),
    ...overrides.labeledEntities,
  };

  const declarantsService = {
    listForOrg: jest.fn().mockResolvedValue([]),
    ...overrides.declarantsService,
  };

  const declarationLibraryService = {
    listForOrg: jest.fn().mockResolvedValue([]),
    ...overrides.declarationLibraryService,
  };

  const service = new ReadToolsService(
    caseAccess,
    investigationRepo,
    productions,
    dataRoom,
    labeledEntities,
    declarantsService,
    declarationLibraryService,
  );
  const server = new McpServer({ name: 'test-mcp', version: '0.0.1' });
  service.registerAll(server, AUTH);

  return {
    server,
    caseAccess,
    investigationRepo,
    productions,
    dataRoom,
    labeledEntities,
    declarantsService,
    declarationLibraryService,
  };
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

  // -------------------------------------------------------------------------
  // get_declarants
  // -------------------------------------------------------------------------

  describe('get_declarants', () => {
    it('lists declarants for the session org, projected like the built-in agent', async () => {
      const listForOrg = jest.fn().mockResolvedValue([
        {
          id: 'd1', displayName: 'Dr. Jane Smith', title: 'Forensic Accountant',
          firm: 'Smith LLC', qualifications: [{ id: 'q1', text: 'Qualified.', subItems: [], exhibitIds: [], footnotes: [] }],
          cvExhibit: null, priorTestimony: [], hourlyRate: '$500/hour',
          nonContingencyDisclosure: null, dateOfBirth: null, address: null,
          userId: null, organizationId: ORG_ID, createdAt: new Date(), updatedAt: new Date(),
        },
      ]);
      const { server } = buildService({ declarantsService: { listForOrg } });
      const result = await callTool(server, 'get_declarants', {});
      expect(listForOrg).toHaveBeenCalledWith(ORG_ID);
      const payload = JSON.parse(result.content[0].text);
      expect(payload.declarants).toHaveLength(1);
      expect(payload.declarants[0]).toMatchObject({ id: 'd1', displayName: 'Dr. Jane Smith' });
      expect(payload.declarants[0].organizationId).toBeUndefined(); // dropped from projection
    });

    it('does NOT require a case (no assertRole called)', async () => {
      const assertRole = jest.fn();
      const { server } = buildService({ caseAccess: { assertRole } });
      await callTool(server, 'get_declarants', {});
      expect(assertRole).not.toHaveBeenCalled();
    });

    it('returns errorResult on service failure', async () => {
      const listForOrg = jest.fn().mockRejectedValue(new Error('db down'));
      const { server } = buildService({ declarantsService: { listForOrg } });
      const result = await callTool(server, 'get_declarants', {});
      expect(result.isError).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // get_declaration_library
  // -------------------------------------------------------------------------

  describe('get_declaration_library', () => {
    it('lists boilerplate blocks for the session org', async () => {
      const listForOrg = jest.fn().mockResolvedValue([
        { id: 'b1', kind: 'boilerplate', name: 'Chain primer', category: 'primer',
          content: { paragraphs: [] }, organizationId: ORG_ID, createdAt: new Date(), updatedAt: new Date() },
      ]);
      const { server } = buildService({ declarationLibraryService: { listForOrg } });
      const result = await callTool(server, 'get_declaration_library', {});
      expect(listForOrg).toHaveBeenCalledWith(ORG_ID, undefined);
      const payload = JSON.parse(result.content[0].text);
      expect(payload.blocks[0]).toMatchObject({ id: 'b1', kind: 'boilerplate', name: 'Chain primer' });
      expect(payload.blocks[0].organizationId).toBeUndefined();
    });

    it('passes the kind filter through', async () => {
      const listForOrg = jest.fn().mockResolvedValue([]);
      const { server } = buildService({ declarationLibraryService: { listForOrg } });
      await callTool(server, 'get_declaration_library', { kind: 'boilerplate' });
      expect(listForOrg).toHaveBeenCalledWith(ORG_ID, 'boilerplate');
    });

    it('does NOT require a case (no assertRole called)', async () => {
      const assertRole = jest.fn();
      const { server } = buildService({ caseAccess: { assertRole } });
      await callTool(server, 'get_declaration_library', {});
      expect(assertRole).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // list_data_room_files
  // -------------------------------------------------------------------------

  describe('list_data_room_files', () => {
    it('asserts viewer role, calls getManifest with the 500 cap, and returns the manifest verbatim', async () => {
      const assertRole = jest.fn().mockResolvedValue({ role: 'viewer' });
      const manifest = {
        files: [{ id: 'f1', name: 'draft.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1234, folderPath: '/' }],
        total: 1,
        truncated: false,
      };
      const getManifest = jest.fn().mockResolvedValue(manifest);
      const { server } = buildService({
        caseAccess: { assertRole },
        dataRoom: { getManifest },
      });

      const result = await callTool(server, 'list_data_room_files', { caseId: CASE_ID });

      expect(assertRole).toHaveBeenCalledWith(AUTH.principal, CASE_ID, 'viewer');
      expect(getManifest).toHaveBeenCalledWith(CASE_ID, 500);
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual(manifest);
    });

    it('surfaces ForbiddenException from assertRole; getManifest NOT called', async () => {
      const assertRole = jest.fn().mockRejectedValue(new ForbiddenException('cross_org_access'));
      const { server, dataRoom } = buildService({ caseAccess: { assertRole } });

      const result = await callTool(server, 'list_data_room_files', { caseId: CASE_ID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('cross_org_access');
      expect(dataRoom.getManifest).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // read_data_room_file
  // -------------------------------------------------------------------------

  describe('read_data_room_file', () => {
    beforeEach(() => {
      mockExtractFileForMcp.mockClear();
    });

    it('asserts viewer role and returns extracted content blocks directly (happy path)', async () => {
      const assertRole = jest.fn().mockResolvedValue({ role: 'viewer' });
      const getFileBufferForAgent = jest.fn().mockResolvedValue({
        tooLarge: false,
        name: 'draft.docx',
        mimeType: 'text/plain',
        size: 11,
        buffer: Buffer.from('hello world'),
      });
      mockExtractFileForMcp.mockResolvedValue([{ type: 'text', text: 'hello world' }]);
      const { server } = buildService({
        caseAccess: { assertRole },
        dataRoom: { getFileBufferForAgent },
      });

      const result = await callTool(server, 'read_data_room_file', { caseId: CASE_ID, fileId: 'f1' });

      expect(assertRole).toHaveBeenCalledWith(AUTH.principal, CASE_ID, 'viewer');
      expect(result).toEqual({ content: [{ type: 'text', text: 'hello world' }] });
    });

    it('cap-bypass regression: a large extracted text block is NOT truncated to the 8 KB textResult cap', async () => {
      const bigText = 'x'.repeat(20000);
      const getFileBufferForAgent = jest.fn().mockResolvedValue({
        tooLarge: false,
        name: 'draft.docx',
        mimeType: 'text/plain',
        size: 20000,
        buffer: Buffer.from(bigText),
      });
      mockExtractFileForMcp.mockResolvedValue([{ type: 'text', text: bigText }]);
      const { server } = buildService({
        dataRoom: { getFileBufferForAgent },
      });

      const result = await callTool(server, 'read_data_room_file', { caseId: CASE_ID, fileId: 'f1' });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text.length).toBe(20000);
    });

    it('returns a text note (not isError) when the file is too large to read inline', async () => {
      const getFileBufferForAgent = jest.fn().mockResolvedValue({
        tooLarge: true,
        name: 'big.pdf',
        mimeType: 'application/pdf',
        size: 40 * 1024 * 1024,
      });
      const { server } = buildService({
        dataRoom: { getFileBufferForAgent },
      });

      const result = await callTool(server, 'read_data_room_file', { caseId: CASE_ID, fileId: 'f1' });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('big.pdf');
      expect(mockExtractFileForMcp).not.toHaveBeenCalled();
    });

    it('surfaces NotFoundException from getFileBufferForAgent as isError', async () => {
      const getFileBufferForAgent = jest.fn().mockRejectedValue(new NotFoundException('file_not_found'));
      const { server } = buildService({
        dataRoom: { getFileBufferForAgent },
      });

      const result = await callTool(server, 'read_data_room_file', { caseId: CASE_ID, fileId: 'nope' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('file_not_found');
    });

    it('surfaces ForbiddenException from assertRole; getFileBufferForAgent NOT called', async () => {
      const assertRole = jest.fn().mockRejectedValue(new ForbiddenException('cross_org_access'));
      const { server, dataRoom } = buildService({ caseAccess: { assertRole } });

      const result = await callTool(server, 'read_data_room_file', { caseId: CASE_ID, fileId: 'f1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('cross_org_access');
      expect(dataRoom.getFileBufferForAgent).not.toHaveBeenCalled();
    });
  });
});
