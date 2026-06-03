import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { TokenUsageService, RecordParams } from './token-usage.service';
import { TokenUsageEntity } from '../../../database/entities/token-usage.entity';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID_1 = 'org-uuid-1111';
const ORG_ID_2 = 'org-uuid-2222';
const USER_ID = 'user-uuid-5678';
const CASE_ID = 'case-uuid-9abc';
const CONV_ID = 'conv-uuid-def0';

function makeParams(overrides: Partial<RecordParams> = {}): RecordParams {
  return {
    orgId: ORG_ID_1,
    userId: USER_ID,
    caseId: CASE_ID,
    conversationId: CONV_ID,
    messageId: 'msg-uuid-1234',
    surface: 'chat',
    model: 'claude-sonnet-4-6',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadInputTokens: 20,
    cacheCreation5mInputTokens: 10,
    cacheCreation1hInputTokens: 0,
    ...overrides,
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

let tokenUsageRepo: { create: jest.Mock; save: jest.Mock };
let dataSource: { query: jest.Mock };

// ── Module factory ─────────────────────────────────────────────────────────────

async function buildModule(): Promise<TestingModule> {
  tokenUsageRepo = {
    create: jest.fn((p) => p),
    save: jest.fn().mockResolvedValue({}),
  };
  dataSource = { query: jest.fn().mockResolvedValue([]) };

  return Test.createTestingModule({
    providers: [
      TokenUsageService,
      { provide: getRepositoryToken(TokenUsageEntity), useValue: tokenUsageRepo },
      { provide: DataSource, useValue: dataSource },
    ],
  }).compile();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TokenUsageService', () => {
  let service: TokenUsageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    service = module.get(TokenUsageService);
  });

  // ── Write path ────────────────────────────────────────────────────────────────

  describe('record()', () => {
    it('calls tokenUsageRepo.save with the exact fields provided', async () => {
      const params = makeParams();
      await service.record(params);

      expect(tokenUsageRepo.create).toHaveBeenCalledWith(params);
      expect(tokenUsageRepo.save).toHaveBeenCalledTimes(1);
      expect(tokenUsageRepo.save).toHaveBeenCalledWith(params);
    });

    it('calls dataSource.query with correct SQL and params for the monthly upsert', async () => {
      const params = makeParams();
      await service.record(params);

      expect(dataSource.query).toHaveBeenCalledTimes(1);

      const [sql, sqlParams] = dataSource.query.mock.calls[0] as [string, unknown[]];

      expect(sql).toContain('INSERT INTO monthly_usage');
      expect(sql).toContain('ON CONFLICT (org_id, user_id, period, model)');
      expect(sql).toContain('DO UPDATE');
      expect(sql).toContain('uuid_generate_v4()');

      const period = new Date().toISOString().slice(0, 7);

      expect(sqlParams).toEqual([
        params.orgId,
        params.userId,
        period,
        params.model,
        params.inputTokens,
        params.outputTokens,
        params.cacheReadInputTokens,
        params.cacheCreation5mInputTokens,
        params.cacheCreation1hInputTokens,
      ]);
    });

    it('skips the monthly upsert when orgId is null', async () => {
      await service.record(makeParams({ orgId: null }));
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(tokenUsageRepo.save).toHaveBeenCalledTimes(1);
    });

    it('skips the monthly upsert when userId is null', async () => {
      await service.record(makeParams({ userId: null }));
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(tokenUsageRepo.save).toHaveBeenCalledTimes(1);
    });

    it('does not throw for surface=title-generation with null messageId and caseId', async () => {
      const params = makeParams({
        surface: 'title-generation',
        messageId: null,
        caseId: null,
      });
      await expect(service.record(params)).resolves.toBeUndefined();
      expect(tokenUsageRepo.save).toHaveBeenCalledTimes(1);
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it('swallows DB errors and calls logger.error — never throws', async () => {
      tokenUsageRepo.save.mockRejectedValue(new Error('DB connection lost'));

      const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      await expect(service.record(makeParams())).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain('Failed to record token usage');

      logSpy.mockRestore();
    });
  });

  // ── overview() ────────────────────────────────────────────────────────────────

  describe('overview()', () => {
    it('computes totalCost, totalTokens, totalCalls, and cacheHitRate from per-model rows', async () => {
      // Two models, two orgs worth of data — overview sums across all
      dataSource.query.mockResolvedValueOnce([
        {
          model: 'claude-sonnet-4-6',
          calls: '5',
          input_tokens: '1000',
          output_tokens: '500',
          cache_read_input_tokens: '200',
          cache_creation_5m_input_tokens: '100',
          cache_creation_1h_input_tokens: '0',
        },
        {
          model: 'claude-haiku-4-5',
          calls: '3',
          input_tokens: '2000',
          output_tokens: '400',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
      ]);

      const result = await service.overview(30);

      // Sonnet cost: (1000*3 + 500*15 + 200*0.30 + 100*3.75) / 1_000_000
      //   = (3000 + 7500 + 60 + 375) / 1_000_000 = 10935 / 1_000_000 = 0.010935
      // Haiku cost: (2000*1 + 400*5) / 1_000_000
      //   = (2000 + 2000) / 1_000_000 = 4000 / 1_000_000 = 0.004
      // Total: 0.010935 + 0.004 = 0.014935
      expect(result.totalCost).toBeCloseTo(0.014935, 8);

      expect(result.totalCalls).toBe(8); // 5 + 3
      // totalTokens: (1000+500+200+100+0) + (2000+400+0+0+0)
      expect(result.totalTokens).toBe(4200);

      // cacheHitRate = cacheRead / (uncachedInput + cacheRead + cache5m + cache1h)
      //   = 200 / (1000 + 200 + 100 + 0 + 2000 + 0 + 0 + 0)
      //   = 200 / 3300
      expect(result.cacheHitRate).toBeCloseTo(200 / 3300, 8);

      expect(result.days).toBe(30);
    });

    it('returns cacheHitRate = 0 when denominator is zero (no divide-by-zero)', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          model: 'claude-sonnet-4-6',
          calls: '1',
          input_tokens: '0',
          output_tokens: '100',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
      ]);

      const result = await service.overview(7);
      expect(result.cacheHitRate).toBe(0);
    });

    it('returns totalCost = 0 when no rows in window', async () => {
      dataSource.query.mockResolvedValueOnce([]);

      const result = await service.overview(90);
      expect(result.totalCost).toBe(0);
      expect(result.totalCalls).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.cacheHitRate).toBe(0);
    });

    it('returns totalCost = null when any model is unknown', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          model: 'claude-sonnet-4-6',
          calls: '2',
          input_tokens: '500',
          output_tokens: '100',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
        {
          model: 'claude-future-model-9000',
          calls: '1',
          input_tokens: '200',
          output_tokens: '50',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
      ]);

      const result = await service.overview(30);
      expect(result.totalCost).toBeNull();
      // tokens and calls still computed
      expect(result.totalCalls).toBe(3);
    });
  });

  // ── byOrg() ──────────────────────────────────────────────────────────────────

  describe('byOrg()', () => {
    it('returns one row per org with cost summed from per-model breakdowns', async () => {
      // Org 1 has two models; Org 2 has one model
      dataSource.query.mockResolvedValueOnce([
        {
          org_id: ORG_ID_1,
          org_name: 'Acme Corp',
          model: 'claude-sonnet-4-6',
          calls: '3',
          input_tokens: '1000',
          output_tokens: '500',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
        {
          org_id: ORG_ID_1,
          org_name: 'Acme Corp',
          model: 'claude-haiku-4-5',
          calls: '2',
          input_tokens: '2000',
          output_tokens: '300',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
        {
          org_id: ORG_ID_2,
          org_name: 'Beta Ltd',
          model: 'claude-sonnet-4-6',
          calls: '1',
          input_tokens: '500',
          output_tokens: '100',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
      ]);

      const result = await service.byOrg(30, 10);

      expect(result).toHaveLength(2);

      const acme = result.find((r) => r.orgId === ORG_ID_1);
      const beta = result.find((r) => r.orgId === ORG_ID_2);

      expect(acme).toBeDefined();
      expect(acme!.orgName).toBe('Acme Corp');
      expect(acme!.calls).toBe(5);
      expect(acme!.totalTokens).toBe(1000 + 500 + 2000 + 300);

      // Sonnet: (1000*3 + 500*15)/1e6 = 10500/1e6 = 0.0105
      // Haiku: (2000*1 + 300*5)/1e6 = 3500/1e6 = 0.0035
      expect(acme!.cost).toBeCloseTo(0.0105 + 0.0035, 8);

      expect(beta).toBeDefined();
      // Sonnet: (500*3 + 100*15)/1e6 = 3000/1e6 = 0.003
      expect(beta!.cost).toBeCloseTo(0.003, 8);
    });

    it('returns cost = null for an org when any model in its breakdown is unknown', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          org_id: ORG_ID_1,
          org_name: 'Acme Corp',
          model: 'claude-sonnet-4-6',
          calls: '1',
          input_tokens: '1000',
          output_tokens: '200',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
        {
          org_id: ORG_ID_1,
          org_name: 'Acme Corp',
          model: 'claude-future-9000', // unknown
          calls: '1',
          input_tokens: '500',
          output_tokens: '50',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
      ]);

      const result = await service.byOrg(30, 10);
      expect(result).toHaveLength(1);
      expect(result[0].cost).toBeNull();
    });

    it('respects the limit parameter', async () => {
      // Build 5 org rows (each with a different org_id)
      const rawRows = Array.from({ length: 5 }, (_, i) => ({
        org_id: `org-${i}`,
        org_name: `Org ${i}`,
        model: 'claude-sonnet-4-6',
        calls: '1',
        input_tokens: `${(5 - i) * 100}`, // descending so cost sorts correctly
        output_tokens: '0',
        cache_read_input_tokens: '0',
        cache_creation_5m_input_tokens: '0',
        cache_creation_1h_input_tokens: '0',
      }));

      dataSource.query.mockResolvedValueOnce(rawRows);

      const result = await service.byOrg(30, 3);
      expect(result).toHaveLength(3);
    });
  });

  // ── byConversation() ──────────────────────────────────────────────────────────

  describe('byConversation()', () => {
    it('returns rows with title, caseName, userEmail resolved from joins', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          conversation_id: CONV_ID,
          title: 'My investigation',
          case_name: 'Case Alpha',
          user_email: 'alice@example.com',
          model: 'claude-sonnet-4-6',
          calls: '4',
          input_tokens: '1000',
          output_tokens: '200',
          cache_read_input_tokens: '100',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
      ]);

      const result = await service.byConversation(30, 20);

      expect(result).toHaveLength(1);
      expect(result[0].conversationId).toBe(CONV_ID);
      expect(result[0].title).toBe('My investigation');
      expect(result[0].caseName).toBe('Case Alpha');
      expect(result[0].userEmail).toBe('alice@example.com');
      expect(result[0].calls).toBe(4);
      // Sonnet: (1000*3 + 200*15 + 100*0.30)/1e6
      expect(result[0].cost).toBeCloseTo((3000 + 3000 + 30) / 1_000_000, 8);
    });

    it('returns cost = null when model is unknown', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          conversation_id: CONV_ID,
          title: null,
          case_name: null,
          user_email: null,
          model: 'claude-future-9000',
          calls: '1',
          input_tokens: '100',
          output_tokens: '50',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
      ]);

      const result = await service.byConversation(30, 20);
      expect(result[0].cost).toBeNull();
    });

    it('SQL excludes rows where conversation_id is NULL (WHERE clause check)', async () => {
      // The WHERE conversation_id IS NOT NULL is in the SQL itself — we verify
      // the SQL string sent to the DB contains that clause.
      dataSource.query.mockResolvedValueOnce([]);
      await service.byConversation(30, 20);

      const [sql] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('tu.conversation_id IS NOT NULL');
    });
  });

  // ── orgModelMatrix() ──────────────────────────────────────────────────────────

  describe('orgModelMatrix()', () => {
    it('returns one row per (org, model) pair with cost computed for that model', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          org_id: ORG_ID_1,
          org_name: 'Acme Corp',
          model: 'claude-sonnet-4-6',
          calls: '5',
          input_tokens: '1000',
          output_tokens: '200',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
        {
          org_id: ORG_ID_1,
          org_name: 'Acme Corp',
          model: 'claude-haiku-4-5',
          calls: '3',
          input_tokens: '500',
          output_tokens: '50',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
        {
          org_id: ORG_ID_2,
          org_name: 'Beta Ltd',
          model: 'claude-sonnet-4-6',
          calls: '2',
          input_tokens: '200',
          output_tokens: '100',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
      ]);

      const result = await service.orgModelMatrix(30);

      expect(result).toHaveLength(3);

      const acmeSonnet = result.find((r) => r.orgId === ORG_ID_1 && r.model === 'claude-sonnet-4-6');
      const acmeHaiku = result.find((r) => r.orgId === ORG_ID_1 && r.model === 'claude-haiku-4-5');
      const betaSonnet = result.find((r) => r.orgId === ORG_ID_2);

      expect(acmeSonnet).toBeDefined();
      // Sonnet: (1000*3 + 200*15)/1e6 = 6000/1e6 = 0.006
      expect(acmeSonnet!.cost).toBeCloseTo(0.006, 8);
      expect(acmeSonnet!.calls).toBe(5);

      expect(acmeHaiku).toBeDefined();
      // Haiku: (500*1 + 50*5)/1e6 = 750/1e6
      expect(acmeHaiku!.cost).toBeCloseTo(750 / 1_000_000, 8);

      expect(betaSonnet).toBeDefined();
      // Sonnet: (200*3 + 100*15)/1e6 = 2100/1e6
      expect(betaSonnet!.cost).toBeCloseTo(2100 / 1_000_000, 8);
    });

    it('returns cost = null for (org, model) pair with unknown model', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          org_id: ORG_ID_1,
          org_name: 'Acme Corp',
          model: 'claude-future-9000',
          calls: '1',
          input_tokens: '100',
          output_tokens: '50',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
      ]);

      const result = await service.orgModelMatrix(30);
      expect(result[0].cost).toBeNull();
    });
  });

  // ── cacheEffectiveness() ──────────────────────────────────────────────────────

  describe('cacheEffectiveness()', () => {
    it('returns correct hit rate and breakdown', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          input_tokens: '1000',
          output_tokens: '300',
          cache_read_input_tokens: '500',
          cache_creation_5m_input_tokens: '200',
          cache_creation_1h_input_tokens: '50',
        },
      ]);

      const result = await service.cacheEffectiveness(30);

      // denom = 1000 (uncached) + 500 (cacheRead) + 200 (cache5m) + 50 (cache1h) = 1750
      // hitRate = 500 / 1750
      expect(result.cacheHitRate).toBeCloseTo(500 / 1750, 8);
      expect(result.days).toBe(30);
      expect(result.breakdown.uncachedInputTokens).toBe(1000);
      expect(result.breakdown.outputTokens).toBe(300);
      expect(result.breakdown.cacheReadTokens).toBe(500);
      expect(result.breakdown.cacheCreation5mTokens).toBe(200);
      expect(result.breakdown.cacheCreation1hTokens).toBe(50);
    });

    it('returns cacheHitRate = 0 when all token counts are zero', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          input_tokens: '0',
          output_tokens: '0',
          cache_read_input_tokens: '0',
          cache_creation_5m_input_tokens: '0',
          cache_creation_1h_input_tokens: '0',
        },
      ]);

      const result = await service.cacheEffectiveness(7);
      expect(result.cacheHitRate).toBe(0);
    });

    it('handles empty result set gracefully (no rows in window)', async () => {
      dataSource.query.mockResolvedValueOnce([{}]);

      const result = await service.cacheEffectiveness(90);
      expect(result.cacheHitRate).toBe(0);
      expect(result.breakdown.uncachedInputTokens).toBe(0);
      expect(result.breakdown.outputTokens).toBe(0);
    });
  });
});
