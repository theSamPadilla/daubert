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
import { DataRoomConnectionEntity } from '../../database/entities/data-room-connection.entity';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AGENT_TOOLS, READ_ONLY_AGENT_TOOLS } from './tools';
import { CaseRole } from '../../database/entities/case-member.entity';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockConversationsService = { findOne: jest.fn() };
const mockScriptExecutionService = { execute: jest.fn(), listRuns: jest.fn() };
const mockLabeledEntitiesService = { lookupByAddress: jest.fn(), findAll: jest.fn() };
const mockProductionsService = { create: jest.fn(), findOne: jest.fn(), findAllForCase: jest.fn(), update: jest.fn() };
const mockTracesService = { findOne: jest.fn(), update: jest.fn() };
const mockAnthropicProvider = {};
const mockMessageRepo = { find: jest.fn() };
const mockInvestigationRepo = { find: jest.fn(), findOneBy: jest.fn() };
const mockTraceRepo = { findOneBy: jest.fn(), save: jest.fn() };
const mockDataRoomRepo = { find: jest.fn() };

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
        { provide: getRepositoryToken(MessageEntity), useValue: mockMessageRepo },
        { provide: getRepositoryToken(InvestigationEntity), useValue: mockInvestigationRepo },
        { provide: getRepositoryToken(TraceEntity), useValue: mockTraceRepo },
        { provide: getRepositoryToken(DataRoomConnectionEntity), useValue: mockDataRoomRepo },
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
        { provide: ScriptExecutionService, useValue: { execute: jest.fn(), listRuns: jest.fn() } },
        { provide: LabeledEntitiesService, useValue: { lookupByAddress: jest.fn(), findAll: jest.fn() } },
        { provide: ProductionsService, useValue: { create: jest.fn(), findOne: jest.fn(), findAllForCase: jest.fn(), update: jest.fn() } },
        { provide: TracesService, useValue: { findOne: jest.fn(), update: jest.fn() } },
        { provide: AnthropicProvider, useValue: {} },
        { provide: getRepositoryToken(MessageEntity), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(InvestigationEntity), useValue: { find: jest.fn(), findOneBy: jest.fn() } },
        { provide: getRepositoryToken(TraceEntity), useValue: { findOneBy: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(DataRoomConnectionEntity), useValue: { find: jest.fn() } },
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
