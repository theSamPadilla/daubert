import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { AiService } from './ai.service';
import { ConversationsService } from './conversations.service';
import { ScriptExecutionService } from './services/script-execution.service';
import { LabeledEntitiesService } from '../labeled-entities/labeled-entities.service';
import { ProductionsService } from '../productions/productions.service';
import { TracesService } from '../traces/traces.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { MessageEntity } from '../../database/entities/message.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { TraceEntity } from '../../database/entities/trace.entity';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { TokenUsageService } from '../superadmin/token-usage/token-usage.service';
import { DataRoomService } from '../data-room/data-room.service';
import { DeclarationLibraryService } from '../declaration-library/declaration-library.service';
import { DeclarantsService } from '../declarants/declarants.service';
import { AddressClassificationsService } from '../address-classifications/address-classifications.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AGENT_TOOLS, READ_ONLY_AGENT_TOOLS } from './tools';
import { CaseRole } from '../../database/entities/case-member.entity';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockConversationsService = { findOne: jest.fn(), getMessages: jest.fn(), updateTitle: jest.fn() };
const mockScriptExecutionService = { execute: jest.fn(), listRunsForCase: jest.fn() };
const mockLabeledEntitiesService = { lookupByAddress: jest.fn(), findAll: jest.fn() };
const mockProductionsService = { create: jest.fn(), findOne: jest.fn(), findAllForCase: jest.fn(), update: jest.fn() };
const mockTracesService = { findOne: jest.fn(), update: jest.fn() };
const mockAnthropicProvider = { streamChat: jest.fn(), generateText: jest.fn(), uploadFile: jest.fn() };
const mockMessageRepo = { find: jest.fn(), save: jest.fn((e: any) => Promise.resolve({ id: 'msg-saved-id', ...e })), create: jest.fn((e: any) => e) };
const mockInvestigationRepo = { find: jest.fn(), findOneBy: jest.fn() };
const mockTraceRepo = { findOneBy: jest.fn(), save: jest.fn() };
const mockDataRoomService = { getManifest: jest.fn(), getFileForAgentRead: jest.fn(), setAnthropicFileId: jest.fn() };
const mockConversationRepo = { findOne: jest.fn() };
const mockCaseRepo = { findOne: jest.fn() };
const mockDeclarationLibraryService = { listForOrg: jest.fn() };
const mockDeclarantsService = { listForOrg: jest.fn() };
const mockTokenUsageService = { record: jest.fn() };
const mockAddressClassificationsService = { lookupMany: jest.fn().mockResolvedValue(new Map()) };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = 'case-abc';
const TRACE_ID = 'trace-123';
const OTHER_CASE_ID = 'case-other';
const OTHER_TRACE_ID = 'trace-other';

function makeTrace(overrides: Partial<TraceEntity> = {}): TraceEntity {
  return {
    id: TRACE_ID,
    investigationId: 'inv-1',
    name: 'Test Trace',
    color: null,
    visible: true,
    collapsed: false,
    data: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as TraceEntity;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('AiService — executeTool label cases', () => {
  let aiService: AiService;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConversationsService, useValue: mockConversationsService },
        { provide: ScriptExecutionService, useValue: mockScriptExecutionService },
        { provide: LabeledEntitiesService, useValue: mockLabeledEntitiesService },
        { provide: ProductionsService, useValue: mockProductionsService },
        { provide: TracesService, useValue: mockTracesService },
        { provide: AnthropicProvider, useValue: mockAnthropicProvider },
        { provide: TokenUsageService, useValue: mockTokenUsageService },
        { provide: AddressClassificationsService, useValue: mockAddressClassificationsService },
        { provide: getRepositoryToken(MessageEntity), useValue: mockMessageRepo },
        { provide: getRepositoryToken(InvestigationEntity), useValue: mockInvestigationRepo },
        { provide: getRepositoryToken(TraceEntity), useValue: mockTraceRepo },
        { provide: DataRoomService, useValue: mockDataRoomService },
        { provide: DeclarationLibraryService, useValue: mockDeclarationLibraryService },
        { provide: DeclarantsService, useValue: mockDeclarantsService },
        { provide: getRepositoryToken(ConversationEntity), useValue: mockConversationRepo },
        { provide: getRepositoryToken(CaseEntity), useValue: mockCaseRepo },
      ],
    }).compile();

    aiService = module.get<AiService>(AiService);
  });

  // Helper: build the input fixture the way Anthropic delivers it.
  function toolUse(name: string, input: Record<string, unknown>): Anthropic.ToolUseBlock {
    return { type: 'tool_use', id: 'tu_test', name, input } as Anthropic.ToolUseBlock;
  }

  // ── add_label ──────────────────────────────────────────────────────────────

  describe('add_label', () => {
    it('returns { id } and writes label to trace.data.labels', async () => {
      const trace = makeTrace({ data: {} });
      let savedData: any = null;

      mockTracesService.findOne.mockResolvedValue(trace);
      mockTracesService.update.mockImplementation(async (_id: string, dto: any, _principal: any) => {
        savedData = dto.data;
        return { ...trace, data: dto.data };
      });

      const result = await (aiService as any).executeTool(
        toolUse('add_label', { traceId: TRACE_ID, text: 'OFAC SDN', anchor: { type: 'free', x: 100, y: 50 } }),
        CASE_ID,
        undefined,
        'editor',
      );

      expect(result).toHaveProperty('id');
      expect(typeof (result as any).id).toBe('string');
      expect(savedData.labels).toHaveLength(1);
      expect(savedData.labels[0].text).toBe('OFAC SDN');
    });

    it('without caseId: returns { error } containing "case context" (no throw)', async () => {
      const result = await (aiService as any).executeTool(
        toolUse('add_label', { traceId: 'irrelevant', text: 'x', anchor: { type: 'free', x: 0, y: 0 } }),
        undefined,
        undefined,
        'editor',
      );
      expect(result).toEqual({ error: expect.stringMatching(/case context/i) });
    });

    it('with traceId in a different case: returns { error } (access enforced by TracesService)', async () => {
      mockTracesService.findOne.mockRejectedValue(new ForbiddenException('Access denied'));

      const result = await (aiService as any).executeTool(
        toolUse('add_label', { traceId: OTHER_TRACE_ID, text: 'x', anchor: { type: 'free', x: 0, y: 0 } }),
        CASE_ID,
        undefined,
        'editor',
      );
      expect(result).toMatchObject({ error: expect.any(String) });
    });
  });

  // ── update_label ───────────────────────────────────────────────────────────

  describe('update_label', () => {
    it('rewrites text in place', async () => {
      const trace = makeTrace({ data: { labels: [{ id: 'l1', text: 'old', anchor: { type: 'free', x: 0, y: 0 } }] } });
      let savedData: any = null;

      mockTracesService.findOne.mockResolvedValue(trace);
      mockTracesService.update.mockImplementation(async (_id: string, dto: any, _principal: any) => {
        savedData = dto.data;
        return { ...trace, data: dto.data };
      });

      await (aiService as any).executeTool(
        toolUse('update_label', { traceId: TRACE_ID, labelId: 'l1', text: 'new' }),
        CASE_ID,
        undefined,
        'editor',
      );

      expect(savedData.labels[0].text).toBe('new');
    });

    it('with unknown labelId: returns { error } matching /not found/i', async () => {
      const trace = makeTrace({ data: { labels: [] } });
      mockTracesService.findOne.mockResolvedValue(trace);

      const result = await (aiService as any).executeTool(
        toolUse('update_label', { traceId: TRACE_ID, labelId: 'nope', text: 'x' }),
        CASE_ID,
        undefined,
        'editor',
      );
      expect(result).toMatchObject({ error: expect.stringMatching(/not found/i) });
    });
  });

  // ── delete_label ───────────────────────────────────────────────────────────

  describe('delete_label', () => {
    it('removes the label by id', async () => {
      const trace = makeTrace({ data: { labels: [{ id: 'l1', text: 'hi', anchor: { type: 'free', x: 0, y: 0 } }] } });
      let savedData: any = null;

      mockTracesService.findOne.mockResolvedValue(trace);
      mockTracesService.update.mockImplementation(async (_id: string, dto: any, _principal: any) => {
        savedData = dto.data;
        return { ...trace, data: dto.data };
      });

      await (aiService as any).executeTool(
        toolUse('delete_label', { traceId: TRACE_ID, labelId: 'l1' }),
        CASE_ID,
        undefined,
        'editor',
      );

      expect(savedData.labels).toEqual([]);
    });
  });

  // ── move_label ─────────────────────────────────────────────────────────────

  describe('move_label', () => {
    it('updates x,y for a free anchor', async () => {
      const trace = makeTrace({ data: { labels: [{ id: 'l1', text: 'hi', anchor: { type: 'free', x: 0, y: 0 } }] } });
      let savedData: any = null;

      mockTracesService.findOne.mockResolvedValue(trace);
      mockTracesService.update.mockImplementation(async (_id: string, dto: any, _principal: any) => {
        savedData = dto.data;
        return { ...trace, data: dto.data };
      });

      await (aiService as any).executeTool(
        toolUse('move_label', { traceId: TRACE_ID, labelId: 'l1', position: { x: 100, y: 200 } }),
        CASE_ID,
        undefined,
        'editor',
      );

      expect(savedData.labels[0].anchor).toEqual({ type: 'free', x: 100, y: 200 });
    });

    it('with incompatible position fields for free anchor: returns { error } matching /free anchor/i', async () => {
      const trace = makeTrace({ data: { labels: [{ id: 'l1', text: 'hi', anchor: { type: 'free', x: 0, y: 0 } }] } });
      mockTracesService.findOne.mockResolvedValue(trace);

      const result = await (aiService as any).executeTool(
        toolUse('move_label', { traceId: TRACE_ID, labelId: 'l1', position: { t: 0.5, perpOffset: 0 } }),
        CASE_ID,
        undefined,
        'editor',
      );

      expect(result).toMatchObject({ error: expect.stringMatching(/free anchor/i) });
    });
  });

  // ── tether_label ───────────────────────────────────────────────────────────

  describe('tether_label', () => {
    it('converts free → node anchor', async () => {
      const trace = makeTrace({ data: { labels: [{ id: 'l1', text: 'hi', anchor: { type: 'free', x: 0, y: 0 } }] } });
      let savedData: any = null;

      mockTracesService.findOne.mockResolvedValue(trace);
      mockTracesService.update.mockImplementation(async (_id: string, dto: any, _principal: any) => {
        savedData = dto.data;
        return { ...trace, data: dto.data };
      });

      await (aiService as any).executeTool(
        toolUse('tether_label', { traceId: TRACE_ID, labelId: 'l1', anchor: { type: 'node', anchorId: 'n1', dx: 10, dy: 0 } }),
        CASE_ID,
        undefined,
        'editor',
      );

      expect(savedData.labels[0].anchor).toMatchObject({ type: 'node', anchorId: 'n1' });
    });
  });

  // ── get_case_data ──────────────────────────────────────────────────────────

  describe('get_case_data', () => {
    it('includes the data-room manifest in get_case_data', async () => {
      mockInvestigationRepo.find.mockResolvedValue([]);
      mockProductionsService.findAllForCase.mockResolvedValue([]);

      const dataRoomService = module.get(DataRoomService);
      (dataRoomService.getManifest as jest.Mock).mockResolvedValue({
        files: [{ id: 'a', name: 'x.pdf', mimeType: 'application/pdf', size: 10, folder: '/' }],
        total: 1,
        truncated: false,
      });
      const result: any = await (aiService as any).executeTool(
        toolUse('get_case_data', {}), 'case1', undefined, 'viewer',
      );
      expect(result.dataRoom).toMatchObject({ available: true, fileCount: 1, truncated: false });
      expect(result.dataRoom.files).toHaveLength(1);
    });
  });

  // ── data-room tools ──────────────────────────────────────────────────────────

  describe('data-room tools', () => {
    it('list_data_room_files returns the manifest', async () => {
      const dataRoomService = module.get(DataRoomService);
      (dataRoomService.getManifest as jest.Mock).mockResolvedValue({ files: [{ id: 'a', name: 'x', mimeType: 'text/csv', size: 1, folder: '/' }], total: 1, truncated: false });
      const res: any = await (aiService as any).executeTool(toolUse('list_data_room_files', {}), 'case1', undefined, 'viewer');
      expect(res.files).toHaveLength(1);
      expect(dataRoomService.getManifest).toHaveBeenCalledWith('case1'); // no limit = full list
    });

    it('read_data_room_file returns a sentinel with content blocks for a supported file', async () => {
      const dataRoomService = module.get(DataRoomService);
      const { Readable } = require('stream');
      (dataRoomService.getFileForAgentRead as jest.Mock).mockResolvedValue({
        tooLarge: false, name: 'data.csv', mimeType: 'text/csv', size: 3, stream: Readable.from([Buffer.from('a,b')]), anthropicFileId: null,
      });
      const res: any = await (aiService as any).executeTool(toolUse('read_data_room_file', { fileId: 'a' }), 'case1', undefined, 'viewer', 'u1');
      expect(res.__agentReadBlocks).toBeDefined();
      expect(Array.isArray(res.__agentReadBlocks)).toBe(true);
      expect(res.__agentReadBlocks.length).toBeGreaterThan(0);
      expect(res.summary).toMatchObject({ name: 'data.csv', mimeType: 'text/csv' });
      expect(dataRoomService.getFileForAgentRead).toHaveBeenCalledWith('case1', 'u1', 'a', 5 * 1024 * 1024);
    });

    it('read_data_room_file returns a too-large note without content blocks', async () => {
      const dataRoomService = module.get(DataRoomService);
      (dataRoomService.getFileForAgentRead as jest.Mock).mockResolvedValue({ tooLarge: true, name: 'big.pdf', mimeType: 'application/pdf', size: 99 * 1024 * 1024, anthropicFileId: null });
      const res: any = await (aiService as any).executeTool(toolUse('read_data_room_file', { fileId: 'a' }), 'case1', undefined, 'viewer');
      expect(res.__agentReadBlocks).toBeUndefined();
      expect(res.error || res.note).toBeTruthy();
    });

    it('read_data_room_file uploads an oversized PDF and returns a file-source document block', async () => {
      const dataRoomService = module.get(DataRoomService);
      const llm = module.get(AnthropicProvider);
      const { Readable } = require('stream');
      // PDF bytes whose base64 length exceeds PDF_B64_LIMIT (~6.2M chars) but
      // whose raw size is well within the 32 MB Files API ceiling.
      const bigPdfBytes = Buffer.alloc(5 * 1024 * 1024, 0x41); // ~5 MB raw → ~6.6M b64 chars
      (dataRoomService.getFileForAgentRead as jest.Mock).mockResolvedValue({
        tooLarge: false, name: 'big.pdf', mimeType: 'application/pdf', size: bigPdfBytes.length,
        stream: Readable.from([bigPdfBytes]), anthropicFileId: null,
      });
      (llm.uploadFile as jest.Mock).mockResolvedValue('file_xyz789');

      const res: any = await (aiService as any).executeTool(toolUse('read_data_room_file', { fileId: 'a' }), 'case1', undefined, 'viewer', 'u1');

      expect(res.__agentReadBlocks).toBeDefined();
      const docBlock = res.__agentReadBlocks.find((b: any) => b.type === 'document');
      expect(docBlock).toBeDefined();
      expect(docBlock.source).toMatchObject({ type: 'file', file_id: 'file_xyz789' });
      expect(llm.uploadFile).toHaveBeenCalledTimes(1);
      expect(dataRoomService.setAnthropicFileId).toHaveBeenCalledWith('case1', 'a', 'file_xyz789');
    });

    it('read_data_room_file returns an unsupported note when the extractor yields no blocks', async () => {
      const dataRoomService = module.get(DataRoomService);
      const { Readable } = require('stream');
      (dataRoomService.getFileForAgentRead as jest.Mock).mockResolvedValue({
        tooLarge: false, name: 'sheet.gdoc', mimeType: 'application/vnd.google-apps.document', size: 5, stream: Readable.from([Buffer.from('x')]), anthropicFileId: null,
      });
      const res: any = await (aiService as any).executeTool(toolUse('read_data_room_file', { fileId: 'a' }), 'case1', undefined, 'viewer');
      expect(res.__agentReadBlocks).toBeUndefined();
      expect(res.error || res.note).toBeTruthy();
    });
  });

  // ── execute_script / list_script_runs ─────────────────────────────────────

  describe('execute_script', () => {
    it('succeeds with caseId and no investigationId — does not return error', async () => {
      mockScriptExecutionService.execute.mockResolvedValue({
        status: 'success',
        output: 'done',
        durationMs: 10,
        savedRun: { id: 'run-1' },
      });

      const result = await (aiService as any).executeTool(
        toolUse('execute_script', { name: 'test', code: 'console.log(1)' }),
        CASE_ID,
        undefined, // no investigation
        'editor',
      );

      expect(result).not.toHaveProperty('error');
      expect(mockScriptExecutionService.execute).toHaveBeenCalledWith(
        CASE_ID,
        undefined,
        'test',
        'console.log(1)',
        'editor',
      );
    });

    it('without caseId returns error containing "case context"', async () => {
      const result = await (aiService as any).executeTool(
        toolUse('execute_script', { name: 'test', code: 'console.log(1)' }),
        undefined, // no case
        undefined,
        'editor',
      );
      expect(result).toEqual({ error: expect.stringMatching(/case context/i) });
    });
  });

  describe('list_script_runs', () => {
    it('calls listRunsForCase with caseId', async () => {
      mockScriptExecutionService.listRunsForCase.mockResolvedValue([]);

      const result = await (aiService as any).executeTool(
        toolUse('list_script_runs', {}),
        CASE_ID,
        undefined,
        'viewer',
      );

      expect(mockScriptExecutionService.listRunsForCase).toHaveBeenCalledWith(CASE_ID);
      expect(Array.isArray(result)).toBe(true);
    });

    it('without caseId returns error containing "case context"', async () => {
      const result = await (aiService as any).executeTool(
        toolUse('list_script_runs', {}),
        undefined,
        undefined,
        'viewer',
      );
      expect(result).toEqual({ error: expect.stringMatching(/case context/i) });
    });
  });
});

// ── Role-based tool registry ───────────────────────────────────────────────

describe('AiService — pickToolsForRole', () => {
  let aiService: AiService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConversationsService, useValue: { findOne: jest.fn() } },
        { provide: ScriptExecutionService, useValue: { execute: jest.fn(), listRunsForCase: jest.fn() } },
        { provide: LabeledEntitiesService, useValue: { lookupByAddress: jest.fn(), findAll: jest.fn() } },
        { provide: ProductionsService, useValue: { create: jest.fn(), findOne: jest.fn(), findAllForCase: jest.fn(), update: jest.fn() } },
        { provide: TracesService, useValue: { findOne: jest.fn(), update: jest.fn() } },
        { provide: AnthropicProvider, useValue: {} },
        { provide: TokenUsageService, useValue: mockTokenUsageService },
        { provide: AddressClassificationsService, useValue: mockAddressClassificationsService },
        { provide: getRepositoryToken(MessageEntity), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(InvestigationEntity), useValue: { find: jest.fn(), findOneBy: jest.fn() } },
        { provide: getRepositoryToken(TraceEntity), useValue: { findOneBy: jest.fn(), save: jest.fn() } },
        { provide: DataRoomService, useValue: { getManifest: jest.fn(), getFileForAgentRead: jest.fn() } },
        { provide: DeclarationLibraryService, useValue: { listForOrg: jest.fn() } },
        { provide: DeclarantsService, useValue: { listForOrg: jest.fn() } },
        { provide: getRepositoryToken(ConversationEntity), useValue: mockConversationRepo },
        { provide: getRepositoryToken(CaseEntity), useValue: { findOne: jest.fn() } },
      ],
    }).compile();

    aiService = module.get<AiService>(AiService);
  });

  it.each<[CaseRole, typeof AGENT_TOOLS]>([
    ['viewer', READ_ONLY_AGENT_TOOLS],
    ['editor', AGENT_TOOLS],
    ['owner', AGENT_TOOLS],
  ])('role=%s → %s tool set', (role, expected) => {
    const result = aiService.pickToolsForRole(role);
    expect(result).toBe(expected);
  });

  it('viewer gets fewer tools than editor', () => {
    const viewerTools = aiService.pickToolsForRole('viewer');
    const editorTools = aiService.pickToolsForRole('editor');
    expect(viewerTools.length).toBeLessThan(editorTools.length);
  });

  it('editor and owner get the same (full) tool set', () => {
    expect(aiService.pickToolsForRole('editor')).toBe(aiService.pickToolsForRole('owner'));
  });

  it('viewer tool set includes execute_script (read-only scripts allowed)', () => {
    const viewerTools = aiService.pickToolsForRole('viewer');
    const names = viewerTools.map((t: any) => t.name);
    expect(names).toContain('execute_script');
  });

  it('editor tool set includes execute_script', () => {
    const editorTools = aiService.pickToolsForRole('editor');
    const names = editorTools.map((t: any) => t.name);
    expect(names).toContain('execute_script');
  });

  it('viewer tool set does not include mutating tools', () => {
    const viewerTools = aiService.pickToolsForRole('viewer');
    const names = viewerTools.map((t: any) => t.name);
    for (const mutateName of ['create_production', 'update_production', 'add_label', 'update_label', 'delete_label']) {
      expect(names).not.toContain(mutateName);
    }
  });
});

// ── Token usage metering ──────────────────────────────────────────────────────

describe('AiService — token usage metering', () => {
  let aiService: AiService;

  const ORG_ID = 'org-uuid-1';
  const CONV_ID = 'conv-uuid-1';
  const USER_ID = 'user-uuid-1';
  const CHAT_CASE_ID = 'case-uuid-1';
  const SAVED_MSG_ID = 'msg-saved-id';

  /** Minimal BetaMessage fixture for end_turn */
  function makeBetaMessage(overrides: Partial<Anthropic.Beta.BetaMessage> = {}): Anthropic.Beta.BetaMessage {
    return {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      model: 'claude-opus-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_creation: null,
        inference_geo: null,
        iterations: null,
      } as Anthropic.Beta.BetaUsage,
      container: null,
      ...overrides,
    } as unknown as Anthropic.Beta.BetaMessage;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: ConversationsService, useValue: mockConversationsService },
        { provide: ScriptExecutionService, useValue: mockScriptExecutionService },
        { provide: LabeledEntitiesService, useValue: mockLabeledEntitiesService },
        { provide: ProductionsService, useValue: mockProductionsService },
        { provide: TracesService, useValue: mockTracesService },
        { provide: AnthropicProvider, useValue: mockAnthropicProvider },
        { provide: TokenUsageService, useValue: mockTokenUsageService },
        { provide: AddressClassificationsService, useValue: mockAddressClassificationsService },
        { provide: getRepositoryToken(MessageEntity), useValue: mockMessageRepo },
        { provide: getRepositoryToken(InvestigationEntity), useValue: mockInvestigationRepo },
        { provide: getRepositoryToken(TraceEntity), useValue: mockTraceRepo },
        { provide: DataRoomService, useValue: mockDataRoomService },
        { provide: DeclarationLibraryService, useValue: mockDeclarationLibraryService },
        { provide: DeclarantsService, useValue: mockDeclarantsService },
        { provide: getRepositoryToken(ConversationEntity), useValue: mockConversationRepo },
        { provide: getRepositoryToken(CaseEntity), useValue: mockCaseRepo },
      ],
    }).compile();

    aiService = module.get<AiService>(AiService);
  });

  it('streamChat: calls tokenUsageService.record with surface=chat and correct fields after end_turn', async () => {
    const betaMessage = makeBetaMessage();

    // conversationRepo.findOne resolves orgId + caseId
    mockConversationRepo.findOne.mockResolvedValue({
      id: CONV_ID,
      caseId: CHAT_CASE_ID,
      case: { orgId: ORG_ID },
    });

    // ConversationsService.findOne (access check) + getMessages (history)
    mockConversationsService.findOne.mockResolvedValue({ id: CONV_ID, caseId: CHAT_CASE_ID, userId: USER_ID });
    mockConversationsService.getMessages.mockResolvedValue([]);

    // messageRepo.save returns entity with id; create is identity
    mockMessageRepo.create.mockImplementation((e: any) => e);
    mockMessageRepo.save.mockResolvedValue({ id: SAVED_MSG_ID });

    // Provider yields text_delta then end_turn
    mockAnthropicProvider.streamChat.mockReturnValue(
      (async function* () {
        yield { type: 'text', content: 'Hello' };
        yield { type: 'end_turn', response: betaMessage };
      })(),
    );

    mockTokenUsageService.record.mockResolvedValue(undefined);

    const events: any[] = [];
    for await (const ev of aiService.streamChat(
      CONV_ID,
      USER_ID,
      'Hello AI',
      CHAT_CASE_ID,
      undefined,
      undefined,
      undefined,
      'editor',
    )) {
      events.push(ev);
    }

    // Should have finished
    expect(events.some((e) => e.type === 'done')).toBe(true);

    // tokenUsageService.record should be called exactly once with chat surface
    expect(mockTokenUsageService.record).toHaveBeenCalledTimes(1);
    expect(mockTokenUsageService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'chat',
        orgId: ORG_ID,
        userId: USER_ID,
        caseId: CHAT_CASE_ID,
        conversationId: CONV_ID,
        messageId: SAVED_MSG_ID,
        model: 'claude-opus-4-6',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 20,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
      }),
    );
  });

  it('generateTitle: calls tokenUsageService.record with surface=title-generation and messageId=null', async () => {
    mockConversationRepo.findOne.mockResolvedValue({
      id: CONV_ID,
      caseId: CHAT_CASE_ID,
      case: { orgId: ORG_ID },
    });
    mockConversationsService.findOne.mockResolvedValue({ id: CONV_ID, caseId: CHAT_CASE_ID, userId: USER_ID });
    mockConversationsService.updateTitle.mockResolvedValue(undefined);

    mockAnthropicProvider.generateText.mockResolvedValue({
      text: 'Wallet Analysis',
      usage: {
        input_tokens: 200,
        output_tokens: 10,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      model: 'claude-haiku-4-5',
    });

    mockTokenUsageService.record.mockResolvedValue(undefined);

    // Call the private method directly
    await (aiService as any).generateTitle(CONV_ID, USER_ID, 'Analyze this wallet');

    expect(mockTokenUsageService.record).toHaveBeenCalledTimes(1);
    expect(mockTokenUsageService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'title-generation',
        orgId: ORG_ID,
        userId: USER_ID,
        caseId: CHAT_CASE_ID,
        conversationId: CONV_ID,
        messageId: null,
        model: 'claude-haiku-4-5',
        inputTokens: 200,
        outputTokens: 10,
        cacheReadInputTokens: 0,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
      }),
    );
  });
});
