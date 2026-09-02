/**
 * ReadToolsService unit tests.
 *
 * Nine tools under test:
 *   - get_case_data         — aggregates investigations, productions, data-room manifest.
 *   - read_production       — delegates to ProductionsService, with optional productionId/type.
 *   - get_investigation     — investigation graph data; summaries without investigationId,
 *                             full slimmed graph (stripTraceForAgent + filterTraceData) with it.
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
  addressClassifications?: any;
} = {}) {
  const caseAccess = {
    assertRole: jest.fn().mockResolvedValue({ id: 'm-1', userId: USER_ID, caseId: CASE_ID, role: 'viewer' }),
    ...overrides.caseAccess,
  } as unknown as CaseAccessService;

  const investigationRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
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

  const addressClassifications = {
    lookupMany: jest.fn().mockResolvedValue(new Map()),
    ...overrides.addressClassifications,
  };

  const service = new ReadToolsService(
    caseAccess,
    investigationRepo,
    productions,
    dataRoom,
    labeledEntities,
    declarantsService,
    declarationLibraryService,
    addressClassifications,
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
    addressClassifications,
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
  // get_investigation
  // -------------------------------------------------------------------------

  describe('get_investigation', () => {
    const INV_ID = 'inv-uuid-1';

    it('summaries mode: no investigationId returns per-investigation summaries with trace counts', async () => {
      const assertRole = jest.fn().mockResolvedValue({ role: 'viewer' });
      const rows = [
        {
          id: 'inv-1',
          name: 'Inv A',
          notes: 'notes A',
          traces: [
            { id: 't-1', name: 'Trace 1', data: { nodes: [1, 2, 3], edges: [1, 2] } },
          ],
        },
        {
          id: 'inv-2',
          name: 'Inv B',
          notes: null,
          traces: [
            { id: 't-2', name: 'Trace 2', data: { nodes: [1], edges: [] } },
          ],
        },
      ];
      const find = jest.fn().mockResolvedValue(rows);
      const { server, investigationRepo } = buildService({
        caseAccess: { assertRole },
        investigationRepo: { find },
      });

      const result = await callTool(server, 'get_investigation', { caseId: CASE_ID });

      expect(assertRole).toHaveBeenCalledWith(AUTH.principal, CASE_ID, 'viewer');
      expect(find).toHaveBeenCalledWith({
        where: { caseId: CASE_ID },
        relations: ['traces'],
        order: { createdAt: 'ASC' },
      });
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual([
        {
          id: 'inv-1',
          name: 'Inv A',
          notes: 'notes A',
          traces: [{ id: 't-1', name: 'Trace 1', nodeCount: 3, edgeCount: 2 }],
        },
        {
          id: 'inv-2',
          name: 'Inv B',
          notes: null,
          traces: [{ id: 't-2', name: 'Trace 2', nodeCount: 1, edgeCount: 0 }],
        },
      ]);
      expect(investigationRepo.findOne).not.toHaveBeenCalled();
    });

    it('full mode: with investigationId returns a slimmed, denormalized graph', async () => {
      const assertRole = jest.fn().mockResolvedValue({ role: 'viewer' });
      const rawData = {
        nodes: [
          { id: 'n-1', address: '0xAAA', chain: 'eth', label: 'Wallet A', tags: [], position: { x: 1, y: 2 }, color: '#fff' },
          { id: 'n-2', address: '0xBBB', chain: 'eth', label: 'Wallet B', tags: [], position: { x: 3, y: 4 }, color: '#000' },
        ],
        edges: [
          {
            id: 'e-1', from: 'n-1', to: 'n-2', txHash: '0xhash', chain: 'eth',
            timestamp: '2024-01-01T00:00:00Z', amount: '1.0', token: 'ETH',
          },
        ],
        groups: [],
        edgeBundles: [],
      };
      const findOne = jest.fn().mockResolvedValue({
        id: INV_ID,
        name: 'Inv Full',
        notes: 'full notes',
        traces: [{ id: 't-1', name: 'Trace 1', data: rawData }],
      });
      const { server, investigationRepo } = buildService({
        caseAccess: { assertRole },
        investigationRepo: { findOne },
      });

      const result = await callTool(server, 'get_investigation', {
        caseId: CASE_ID,
        investigationId: INV_ID,
      });

      expect(findOne).toHaveBeenCalledWith({
        where: { id: INV_ID, caseId: CASE_ID },
        relations: ['traces'],
      });
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toMatchObject({ id: INV_ID, name: 'Inv Full', notes: 'full notes' });
      expect(parsed.traces).toHaveLength(1);
      const trace = parsed.traces[0];
      expect(trace.id).toBe('t-1');
      expect(trace.name).toBe('Trace 1');

      // Nodes are slimmed — no visual metadata.
      expect(trace.nodes).toHaveLength(2);
      for (const n of trace.nodes) {
        expect(n).not.toHaveProperty('position');
        expect(n).not.toHaveProperty('color');
      }

      // Edges are denormalized with fromAddress/toAddress from the node ids.
      expect(trace.edges).toHaveLength(1);
      expect(trace.edges[0]).toMatchObject({
        id: 'e-1',
        from: 'n-1',
        to: 'n-2',
        fromAddress: '0xAAA',
        toAddress: '0xBBB',
      });

      expect(investigationRepo.find).not.toHaveBeenCalled();
    });

    it('filter mode: an address filter narrows to the matching node and its incident edges', async () => {
      const rawData = {
        nodes: [
          { id: 'n-1', address: '0xAAA', chain: 'eth', label: 'Wallet A', tags: [] },
          { id: 'n-2', address: '0xBBB', chain: 'eth', label: 'Wallet B', tags: [] },
          { id: 'n-3', address: '0xCCC', chain: 'eth', label: 'Wallet C', tags: [] },
        ],
        edges: [
          { id: 'e-1', from: 'n-1', to: 'n-2', txHash: '0xh1', chain: 'eth', timestamp: 't1', amount: '1', token: 'ETH' },
          { id: 'e-2', from: 'n-2', to: 'n-3', txHash: '0xh2', chain: 'eth', timestamp: 't2', amount: '2', token: 'ETH' },
        ],
        groups: [],
        edgeBundles: [],
      };
      const findOne = jest.fn().mockResolvedValue({
        id: INV_ID,
        name: 'Inv Filtered',
        notes: null,
        traces: [{ id: 't-1', name: 'Trace 1', data: rawData }],
      });
      const { server } = buildService({ investigationRepo: { findOne } });

      const result = await callTool(server, 'get_investigation', {
        caseId: CASE_ID,
        investigationId: INV_ID,
        address: '0xAAA',
      });

      const parsed = JSON.parse(result.content[0].text);
      const trace = parsed.traces[0];

      // Only n-1 (the address match) and its incident-edge neighbor n-2 survive.
      const nodeIds = trace.nodes.map((n: any) => n.id).sort();
      expect(nodeIds).toEqual(['n-1', 'n-2']);

      // Only the edge incident to n-1 survives.
      expect(trace.edges).toHaveLength(1);
      expect(trace.edges[0].id).toBe('e-1');
    });

    it('not found: returns { error } (not isError) when the investigation does not exist', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const { server } = buildService({ investigationRepo: { findOne } });

      const result = await callTool(server, 'get_investigation', {
        caseId: CASE_ID,
        investigationId: INV_ID,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ error: `Investigation ${INV_ID} not found` });
    });

    it('viewer gate: surfaces ForbiddenException from assertRole as isError', async () => {
      const assertRole = jest.fn().mockRejectedValue(new ForbiddenException('cross_org_access'));
      const { server, investigationRepo } = buildService({ caseAccess: { assertRole } });

      const result = await callTool(server, 'get_investigation', { caseId: CASE_ID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('cross_org_access');
      expect(investigationRepo.find).not.toHaveBeenCalled();
      expect(investigationRepo.findOne).not.toHaveBeenCalled();
    });

    it('cap-bypass: a large full-mode graph is NOT truncated to the 8 KB textResult cap', async () => {
      const nodes = Array.from({ length: 400 }, (_, i) => ({
        id: `n-${i}`,
        address: `0x${i.toString().padStart(40, '0')}`,
        chain: 'eth',
        label: `Wallet ${i}`,
        tags: [],
      }));
      const edges = Array.from({ length: 399 }, (_, i) => ({
        id: `e-${i}`,
        from: `n-${i}`,
        to: `n-${i + 1}`,
        txHash: `0xhash${i}`,
        chain: 'eth',
        timestamp: '2024-01-01T00:00:00Z',
        amount: '1.0',
        token: 'ETH',
      }));
      const findOne = jest.fn().mockResolvedValue({
        id: INV_ID,
        name: 'Big Inv',
        notes: null,
        traces: [{ id: 't-1', name: 'Trace 1', data: { nodes, edges, groups: [], edgeBundles: [] } }],
      });
      const { server } = buildService({ investigationRepo: { findOne } });

      const result = await callTool(server, 'get_investigation', {
        caseId: CASE_ID,
        investigationId: INV_ID,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text.length).toBeGreaterThan(8192);
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
