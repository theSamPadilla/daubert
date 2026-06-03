import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TokenUsageEntity, TokenUsageSurface } from '../../../database/entities/token-usage.entity';
import { calculateCost } from './pricing';

// ── Write-path DTO ─────────────────────────────────────────────────────────────

export interface RecordParams {
  orgId: string | null;
  userId: string | null;
  caseId: string | null;
  conversationId: string | null;
  messageId: string | null;
  surface: TokenUsageSurface;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreation5mInputTokens: number;
  cacheCreation1hInputTokens: number;
}

// ── Read-aggregate DTOs ────────────────────────────────────────────────────────

export interface TokenUsageOverview {
  days: number;
  totalCost: number | null;
  totalTokens: number;
  totalCalls: number;
  cacheHitRate: number; // 0..1
}

export interface TokenUsageByOrgRow {
  orgId: string;
  orgName: string;
  calls: number;
  totalTokens: number;
  cost: number | null;
}

export interface TokenUsageByUserRow {
  userId: string;
  email: string;
  orgName: string | null;
  calls: number;
  totalTokens: number;
  cost: number | null;
}

export interface TokenUsageByCaseRow {
  caseId: string;
  caseName: string;
  orgName: string | null;
  calls: number;
  totalTokens: number;
  cost: number | null;
}

export interface TokenUsageByConversationRow {
  conversationId: string;
  title: string | null;
  caseName: string | null;
  userEmail: string | null;
  calls: number;
  totalTokens: number;
  cost: number | null;
}

export interface TokenUsageOrgModelMatrixRow {
  orgId: string;
  orgName: string;
  model: string;
  calls: number;
  totalTokens: number;
  cost: number | null;
}

export interface TokenUsageCacheEffectiveness {
  days: number;
  cacheHitRate: number;
  breakdown: {
    cacheReadTokens: number;
    cacheCreation5mTokens: number;
    cacheCreation1hTokens: number;
    uncachedInputTokens: number;
    outputTokens: number;
  };
}

// ── Internal raw-row shapes ────────────────────────────────────────────────────

interface RawOrgModelRow {
  org_id: string;
  org_name: string;
  model: string;
  calls: string;
  input_tokens: string;
  output_tokens: string;
  cache_read_input_tokens: string;
  cache_creation_5m_input_tokens: string;
  cache_creation_1h_input_tokens: string;
}

interface RawUserModelRow {
  user_id: string;
  email: string;
  org_name: string | null;
  model: string;
  calls: string;
  input_tokens: string;
  output_tokens: string;
  cache_read_input_tokens: string;
  cache_creation_5m_input_tokens: string;
  cache_creation_1h_input_tokens: string;
}

interface RawCaseModelRow {
  case_id: string;
  case_name: string;
  org_name: string | null;
  model: string;
  calls: string;
  input_tokens: string;
  output_tokens: string;
  cache_read_input_tokens: string;
  cache_creation_5m_input_tokens: string;
  cache_creation_1h_input_tokens: string;
}

interface RawConversationModelRow {
  conversation_id: string;
  title: string | null;
  case_name: string | null;
  user_email: string | null;
  model: string;
  calls: string;
  input_tokens: string;
  output_tokens: string;
  cache_read_input_tokens: string;
  cache_creation_5m_input_tokens: string;
  cache_creation_1h_input_tokens: string;
}

interface RawOverviewRow {
  calls: string;
  input_tokens: string;
  output_tokens: string;
  cache_read_input_tokens: string;
  cache_creation_5m_input_tokens: string;
  cache_creation_1h_input_tokens: string;
  model: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Accumulate cost for one model's token counts into a running total.
 * Once any model returns null (unknown pricing), the total becomes null.
 */
function accumulateCost(
  running: number | null,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens: number,
  cacheCreation5mInputTokens: number,
  cacheCreation1hInputTokens: number,
): number | null {
  if (running === null) return null; // already poisoned
  const c = calculateCost(model, {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreation5mInputTokens,
    cacheCreation1hInputTokens,
  });
  if (c === null) return null;
  return running + c;
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class TokenUsageService {
  private readonly logger = new Logger(TokenUsageService.name);

  constructor(
    @InjectRepository(TokenUsageEntity)
    private readonly tokenUsageRepo: Repository<TokenUsageEntity>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Write path ───────────────────────────────────────────────────────────────

  async record(params: RecordParams): Promise<void> {
    try {
      await this.tokenUsageRepo.save(this.tokenUsageRepo.create(params));
      // Rollup requires both orgId and userId — title-generation has them too
      // (generateTitle already has userId, and orgId is resolved via conversation).
      if (params.orgId && params.userId) {
        await this.upsertMonthly(params);
      }
    } catch (err) {
      // Metering failure must never break the user's request.
      this.logger.error(
        `Failed to record token usage [conversationId=${params.conversationId} model=${params.model}]: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async upsertMonthly(p: RecordParams): Promise<void> {
    const period = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    await this.dataSource.query(
      `INSERT INTO monthly_usage
         (id, created_at, updated_at, org_id, user_id, period, model,
          call_count, input_tokens, output_tokens, cache_read_input_tokens,
          cache_creation_5m_input_tokens, cache_creation_1h_input_tokens)
       VALUES (uuid_generate_v4(), NOW(), NOW(), $1, $2, $3, $4,
               1, $5, $6, $7, $8, $9)
       ON CONFLICT (org_id, user_id, period, model)
       DO UPDATE SET
         call_count                       = monthly_usage.call_count + 1,
         input_tokens                     = monthly_usage.input_tokens + EXCLUDED.input_tokens,
         output_tokens                    = monthly_usage.output_tokens + EXCLUDED.output_tokens,
         cache_read_input_tokens          = monthly_usage.cache_read_input_tokens + EXCLUDED.cache_read_input_tokens,
         cache_creation_5m_input_tokens   = monthly_usage.cache_creation_5m_input_tokens + EXCLUDED.cache_creation_5m_input_tokens,
         cache_creation_1h_input_tokens   = monthly_usage.cache_creation_1h_input_tokens + EXCLUDED.cache_creation_1h_input_tokens,
         updated_at                       = NOW()`,
      [
        p.orgId,
        p.userId,
        period,
        p.model,
        p.inputTokens,
        p.outputTokens,
        p.cacheReadInputTokens,
        p.cacheCreation5mInputTokens,
        p.cacheCreation1hInputTokens,
      ],
    );
  }

  // ── Read aggregates ───────────────────────────────────────────────────────────

  /**
   * overview — total cost/tokens/calls/cache-hit-rate across all rows in window.
   * Strategy: raw SQL GROUP BY model, then JS aggregation (cost is per-model).
   */
  async overview(days: number): Promise<TokenUsageOverview> {
    const rows: RawOverviewRow[] = await this.dataSource.query(
      `SELECT
         model,
         COUNT(*)::text                             AS calls,
         SUM(input_tokens)::text                    AS input_tokens,
         SUM(output_tokens)::text                   AS output_tokens,
         SUM(cache_read_input_tokens)::text         AS cache_read_input_tokens,
         SUM(cache_creation_5m_input_tokens)::text  AS cache_creation_5m_input_tokens,
         SUM(cache_creation_1h_input_tokens)::text  AS cache_creation_1h_input_tokens
       FROM token_usage
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY model`,
      [days],
    );

    let totalCost: number | null = 0;
    let totalTokens = 0;
    let totalCalls = 0;
    let sumCacheRead = 0;
    let sumCacheCreation5m = 0;
    let sumCacheCreation1h = 0;
    let sumUncachedInput = 0;

    for (const r of rows) {
      const input = Number(r.input_tokens);
      const output = Number(r.output_tokens);
      const cacheRead = Number(r.cache_read_input_tokens);
      const cache5m = Number(r.cache_creation_5m_input_tokens);
      const cache1h = Number(r.cache_creation_1h_input_tokens);
      const calls = Number(r.calls);

      totalCalls += calls;
      totalTokens += input + output + cacheRead + cache5m + cache1h;
      sumCacheRead += cacheRead;
      sumCacheCreation5m += cache5m;
      sumCacheCreation1h += cache1h;
      sumUncachedInput += input;

      totalCost = accumulateCost(totalCost, r.model, input, output, cacheRead, cache5m, cache1h);
    }

    const cacheDenom = sumUncachedInput + sumCacheRead + sumCacheCreation5m + sumCacheCreation1h;
    const cacheHitRate = cacheDenom > 0 ? sumCacheRead / cacheDenom : 0;

    return { days, totalCost, totalTokens, totalCalls, cacheHitRate };
  }

  /**
   * byOrg — one row per org, cost summed from per-(org, model) in JS.
   * Strategy: raw SQL GROUP BY (org_id, model), JS grouping by org_id.
   */
  async byOrg(days: number, limit: number): Promise<TokenUsageByOrgRow[]> {
    const rows: RawOrgModelRow[] = await this.dataSource.query(
      `SELECT
         tu.org_id,
         o.name                                      AS org_name,
         tu.model,
         COUNT(*)::text                              AS calls,
         SUM(tu.input_tokens)::text                  AS input_tokens,
         SUM(tu.output_tokens)::text                 AS output_tokens,
         SUM(tu.cache_read_input_tokens)::text       AS cache_read_input_tokens,
         SUM(tu.cache_creation_5m_input_tokens)::text AS cache_creation_5m_input_tokens,
         SUM(tu.cache_creation_1h_input_tokens)::text AS cache_creation_1h_input_tokens
       FROM token_usage tu
       JOIN organizations o ON o.id = tu.org_id
       WHERE tu.org_id IS NOT NULL
         AND tu.created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY tu.org_id, o.name, tu.model
       ORDER BY tu.org_id`,
      [days],
    );

    // Group by org_id in JS, accumulating cost per (org, model)
    const orgMap = new Map<
      string,
      { orgId: string; orgName: string; calls: number; totalTokens: number; cost: number | null }
    >();

    for (const r of rows) {
      const input = Number(r.input_tokens);
      const output = Number(r.output_tokens);
      const cacheRead = Number(r.cache_read_input_tokens);
      const cache5m = Number(r.cache_creation_5m_input_tokens);
      const cache1h = Number(r.cache_creation_1h_input_tokens);
      const calls = Number(r.calls);

      const existing = orgMap.get(r.org_id);
      if (existing) {
        existing.calls += calls;
        existing.totalTokens += input + output + cacheRead + cache5m + cache1h;
        existing.cost = accumulateCost(existing.cost, r.model, input, output, cacheRead, cache5m, cache1h);
      } else {
        orgMap.set(r.org_id, {
          orgId: r.org_id,
          orgName: r.org_name,
          calls,
          totalTokens: input + output + cacheRead + cache5m + cache1h,
          cost: accumulateCost(0, r.model, input, output, cacheRead, cache5m, cache1h),
        });
      }
    }

    // Sort by cost desc (null last), then slice to limit
    const result = Array.from(orgMap.values()).sort((a, b) => {
      if (a.cost === null && b.cost === null) return 0;
      if (a.cost === null) return 1;
      if (b.cost === null) return -1;
      return b.cost - a.cost;
    });

    return result.slice(0, limit);
  }

  /**
   * byUser — one row per user, cost summed from per-(user, model) in JS.
   * Strategy: raw SQL GROUP BY (user_id, model), JS grouping by user_id.
   */
  async byUser(days: number, limit: number): Promise<TokenUsageByUserRow[]> {
    const rows: RawUserModelRow[] = await this.dataSource.query(
      `SELECT
         tu.user_id,
         u.email,
         o.name                                      AS org_name,
         tu.model,
         COUNT(*)::text                              AS calls,
         SUM(tu.input_tokens)::text                  AS input_tokens,
         SUM(tu.output_tokens)::text                 AS output_tokens,
         SUM(tu.cache_read_input_tokens)::text       AS cache_read_input_tokens,
         SUM(tu.cache_creation_5m_input_tokens)::text AS cache_creation_5m_input_tokens,
         SUM(tu.cache_creation_1h_input_tokens)::text AS cache_creation_1h_input_tokens
       FROM token_usage tu
       JOIN users u ON u.id = tu.user_id
       LEFT JOIN organizations o ON o.id = tu.org_id
       WHERE tu.user_id IS NOT NULL
         AND tu.created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY tu.user_id, u.email, o.name, tu.model
       ORDER BY tu.user_id`,
      [days],
    );

    const userMap = new Map<
      string,
      { userId: string; email: string; orgName: string | null; calls: number; totalTokens: number; cost: number | null }
    >();

    for (const r of rows) {
      const input = Number(r.input_tokens);
      const output = Number(r.output_tokens);
      const cacheRead = Number(r.cache_read_input_tokens);
      const cache5m = Number(r.cache_creation_5m_input_tokens);
      const cache1h = Number(r.cache_creation_1h_input_tokens);
      const calls = Number(r.calls);

      const existing = userMap.get(r.user_id);
      if (existing) {
        existing.calls += calls;
        existing.totalTokens += input + output + cacheRead + cache5m + cache1h;
        existing.cost = accumulateCost(existing.cost, r.model, input, output, cacheRead, cache5m, cache1h);
      } else {
        userMap.set(r.user_id, {
          userId: r.user_id,
          email: r.email,
          orgName: r.org_name ?? null,
          calls,
          totalTokens: input + output + cacheRead + cache5m + cache1h,
          cost: accumulateCost(0, r.model, input, output, cacheRead, cache5m, cache1h),
        });
      }
    }

    const result = Array.from(userMap.values()).sort((a, b) => {
      if (a.cost === null && b.cost === null) return 0;
      if (a.cost === null) return 1;
      if (b.cost === null) return -1;
      return b.cost - a.cost;
    });

    return result.slice(0, limit);
  }

  /**
   * byCase — one row per case, cost summed from per-(case, model) in JS.
   * Strategy: raw SQL GROUP BY (case_id, model), JS grouping by case_id.
   */
  async byCase(days: number, limit: number): Promise<TokenUsageByCaseRow[]> {
    const rows: RawCaseModelRow[] = await this.dataSource.query(
      `SELECT
         tu.case_id,
         c.name                                       AS case_name,
         o.name                                       AS org_name,
         tu.model,
         COUNT(*)::text                               AS calls,
         SUM(tu.input_tokens)::text                   AS input_tokens,
         SUM(tu.output_tokens)::text                  AS output_tokens,
         SUM(tu.cache_read_input_tokens)::text        AS cache_read_input_tokens,
         SUM(tu.cache_creation_5m_input_tokens)::text AS cache_creation_5m_input_tokens,
         SUM(tu.cache_creation_1h_input_tokens)::text AS cache_creation_1h_input_tokens
       FROM token_usage tu
       JOIN cases c ON c.id = tu.case_id
       LEFT JOIN organizations o ON o.id = tu.org_id
       WHERE tu.case_id IS NOT NULL
         AND tu.created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY tu.case_id, c.name, o.name, tu.model
       ORDER BY tu.case_id`,
      [days],
    );

    const caseMap = new Map<
      string,
      { caseId: string; caseName: string; orgName: string | null; calls: number; totalTokens: number; cost: number | null }
    >();

    for (const r of rows) {
      const input = Number(r.input_tokens);
      const output = Number(r.output_tokens);
      const cacheRead = Number(r.cache_read_input_tokens);
      const cache5m = Number(r.cache_creation_5m_input_tokens);
      const cache1h = Number(r.cache_creation_1h_input_tokens);
      const calls = Number(r.calls);

      const existing = caseMap.get(r.case_id);
      if (existing) {
        existing.calls += calls;
        existing.totalTokens += input + output + cacheRead + cache5m + cache1h;
        existing.cost = accumulateCost(existing.cost, r.model, input, output, cacheRead, cache5m, cache1h);
      } else {
        caseMap.set(r.case_id, {
          caseId: r.case_id,
          caseName: r.case_name,
          orgName: r.org_name ?? null,
          calls,
          totalTokens: input + output + cacheRead + cache5m + cache1h,
          cost: accumulateCost(0, r.model, input, output, cacheRead, cache5m, cache1h),
        });
      }
    }

    const result = Array.from(caseMap.values()).sort((a, b) => {
      if (a.cost === null && b.cost === null) return 0;
      if (a.cost === null) return 1;
      if (b.cost === null) return -1;
      return b.cost - a.cost;
    });

    return result.slice(0, limit);
  }

  /**
   * byConversation — one row per conversation, cost summed from per-(conv, model) in JS.
   * Strategy: raw SQL GROUP BY (conversation_id, model), JS grouping by conversation_id.
   * Rows with conversation_id = null are excluded (WHERE conversation_id IS NOT NULL).
   */
  async byConversation(days: number, limit: number): Promise<TokenUsageByConversationRow[]> {
    const rows: RawConversationModelRow[] = await this.dataSource.query(
      `SELECT
         tu.conversation_id,
         conv.title,
         c.name                                       AS case_name,
         u.email                                      AS user_email,
         tu.model,
         COUNT(*)::text                               AS calls,
         SUM(tu.input_tokens)::text                   AS input_tokens,
         SUM(tu.output_tokens)::text                  AS output_tokens,
         SUM(tu.cache_read_input_tokens)::text        AS cache_read_input_tokens,
         SUM(tu.cache_creation_5m_input_tokens)::text AS cache_creation_5m_input_tokens,
         SUM(tu.cache_creation_1h_input_tokens)::text AS cache_creation_1h_input_tokens
       FROM token_usage tu
       JOIN conversations conv ON conv.id = tu.conversation_id
       LEFT JOIN cases c ON c.id = tu.case_id
       LEFT JOIN users u ON u.id = tu.user_id
       WHERE tu.conversation_id IS NOT NULL
         AND tu.created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY tu.conversation_id, conv.title, c.name, u.email, tu.model
       ORDER BY tu.conversation_id`,
      [days],
    );

    const convMap = new Map<
      string,
      {
        conversationId: string;
        title: string | null;
        caseName: string | null;
        userEmail: string | null;
        calls: number;
        totalTokens: number;
        cost: number | null;
      }
    >();

    for (const r of rows) {
      const input = Number(r.input_tokens);
      const output = Number(r.output_tokens);
      const cacheRead = Number(r.cache_read_input_tokens);
      const cache5m = Number(r.cache_creation_5m_input_tokens);
      const cache1h = Number(r.cache_creation_1h_input_tokens);
      const calls = Number(r.calls);

      const existing = convMap.get(r.conversation_id);
      if (existing) {
        existing.calls += calls;
        existing.totalTokens += input + output + cacheRead + cache5m + cache1h;
        existing.cost = accumulateCost(existing.cost, r.model, input, output, cacheRead, cache5m, cache1h);
      } else {
        convMap.set(r.conversation_id, {
          conversationId: r.conversation_id,
          title: r.title ?? null,
          caseName: r.case_name ?? null,
          userEmail: r.user_email ?? null,
          calls,
          totalTokens: input + output + cacheRead + cache5m + cache1h,
          cost: accumulateCost(0, r.model, input, output, cacheRead, cache5m, cache1h),
        });
      }
    }

    const result = Array.from(convMap.values()).sort((a, b) => {
      if (a.cost === null && b.cost === null) return 0;
      if (a.cost === null) return 1;
      if (b.cost === null) return -1;
      return b.cost - a.cost;
    });

    return result.slice(0, limit);
  }

  /**
   * orgModelMatrix — one row per (org, model) pair in window.
   * Strategy: raw SQL GROUP BY (org_id, model); cost computed per row (single model → no JS grouping needed).
   */
  async orgModelMatrix(days: number): Promise<TokenUsageOrgModelMatrixRow[]> {
    const rows: RawOrgModelRow[] = await this.dataSource.query(
      `SELECT
         tu.org_id,
         o.name                                       AS org_name,
         tu.model,
         COUNT(*)::text                               AS calls,
         SUM(tu.input_tokens)::text                   AS input_tokens,
         SUM(tu.output_tokens)::text                  AS output_tokens,
         SUM(tu.cache_read_input_tokens)::text        AS cache_read_input_tokens,
         SUM(tu.cache_creation_5m_input_tokens)::text AS cache_creation_5m_input_tokens,
         SUM(tu.cache_creation_1h_input_tokens)::text AS cache_creation_1h_input_tokens
       FROM token_usage tu
       JOIN organizations o ON o.id = tu.org_id
       WHERE tu.org_id IS NOT NULL
         AND tu.created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY tu.org_id, o.name, tu.model
       ORDER BY o.name, tu.model`,
      [days],
    );

    return rows.map((r) => {
      const input = Number(r.input_tokens);
      const output = Number(r.output_tokens);
      const cacheRead = Number(r.cache_read_input_tokens);
      const cache5m = Number(r.cache_creation_5m_input_tokens);
      const cache1h = Number(r.cache_creation_1h_input_tokens);

      return {
        orgId: r.org_id,
        orgName: r.org_name,
        model: r.model,
        calls: Number(r.calls),
        totalTokens: input + output + cacheRead + cache5m + cache1h,
        cost: calculateCost(r.model, {
          inputTokens: input,
          outputTokens: output,
          cacheReadInputTokens: cacheRead,
          cacheCreation5mInputTokens: cache5m,
          cacheCreation1hInputTokens: cache1h,
        }),
      };
    });
  }

  /**
   * cacheEffectiveness — single aggregation across all rows in window.
   * Strategy: raw SQL single-row aggregate (no GROUP BY), breakdown in JS.
   */
  async cacheEffectiveness(days: number): Promise<TokenUsageCacheEffectiveness> {
    const rows: Array<{
      input_tokens: string;
      output_tokens: string;
      cache_read_input_tokens: string;
      cache_creation_5m_input_tokens: string;
      cache_creation_1h_input_tokens: string;
    }> = await this.dataSource.query(
      `SELECT
         SUM(input_tokens)::text                    AS input_tokens,
         SUM(output_tokens)::text                   AS output_tokens,
         SUM(cache_read_input_tokens)::text         AS cache_read_input_tokens,
         SUM(cache_creation_5m_input_tokens)::text  AS cache_creation_5m_input_tokens,
         SUM(cache_creation_1h_input_tokens)::text  AS cache_creation_1h_input_tokens
       FROM token_usage
       WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL`,
      [days],
    );

    const r = rows[0];
    const uncachedInput = Number(r?.input_tokens ?? 0);
    const outputTokens = Number(r?.output_tokens ?? 0);
    const cacheRead = Number(r?.cache_read_input_tokens ?? 0);
    const cache5m = Number(r?.cache_creation_5m_input_tokens ?? 0);
    const cache1h = Number(r?.cache_creation_1h_input_tokens ?? 0);

    const denom = uncachedInput + cacheRead + cache5m + cache1h;
    const cacheHitRate = denom > 0 ? cacheRead / denom : 0;

    return {
      days,
      cacheHitRate,
      breakdown: {
        cacheReadTokens: cacheRead,
        cacheCreation5mTokens: cache5m,
        cacheCreation1hTokens: cache1h,
        uncachedInputTokens: uncachedInput,
        outputTokens,
      },
    };
  }
}
