import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { SuperAdminGuard } from '../../auth/super-admin.guard';
import { SuperadminTokenUsageController } from './token-usage.controller';
import { TokenUsageService } from './token-usage.service';

// ── Mock service ──────────────────────────────────────────────────────────────

const mockOverview = { days: 30, totalCost: 1.23, totalTokens: 5000, totalCalls: 10, cacheHitRate: 0.4 };
const mockByOrgRows = [{ orgId: 'org-1', orgName: 'Acme', calls: 5, totalTokens: 2000, cost: 0.5 }];
const mockByUserRows = [{ userId: 'u-1', email: 'a@b.com', orgName: 'Acme', calls: 3, totalTokens: 1000, cost: 0.2 }];
const mockByCaseRows = [{ caseId: 'c-1', caseName: 'FTX', orgName: 'Acme', calls: 2, totalTokens: 800, cost: 0.1 }];
const mockByConvRows = [
  { conversationId: 'cv-1', title: 'Trace', caseName: 'FTX', userEmail: 'a@b.com', calls: 1, totalTokens: 400, cost: 0.05 },
];
const mockMatrixRows = [{ orgId: 'org-1', orgName: 'Acme', model: 'claude-sonnet-4-6', calls: 5, totalTokens: 2000, cost: 0.5 }];
const mockCacheEff = {
  days: 30,
  cacheHitRate: 0.4,
  breakdown: { cacheReadTokens: 400, cacheCreation5mTokens: 100, cacheCreation1hTokens: 50, uncachedInputTokens: 450, outputTokens: 500 },
};

function makeService(): jest.Mocked<TokenUsageService> {
  return {
    overview: jest.fn().mockResolvedValue(mockOverview),
    byOrg: jest.fn().mockResolvedValue(mockByOrgRows),
    byUser: jest.fn().mockResolvedValue(mockByUserRows),
    byCase: jest.fn().mockResolvedValue(mockByCaseRows),
    byConversation: jest.fn().mockResolvedValue(mockByConvRows),
    orgModelMatrix: jest.fn().mockResolvedValue(mockMatrixRows),
    cacheEffectiveness: jest.fn().mockResolvedValue(mockCacheEff),
  } as unknown as jest.Mocked<TokenUsageService>;
}

// ── Test module factory ───────────────────────────────────────────────────────

async function build() {
  const svc = makeService();
  const module: TestingModule = await Test.createTestingModule({
    controllers: [SuperadminTokenUsageController],
    providers: [{ provide: TokenUsageService, useValue: svc }],
  })
    .overrideGuard(SuperAdminGuard)
    .useValue({ canActivate: (_ctx: ExecutionContext) => true })
    .compile();

  return { controller: module.get(SuperadminTokenUsageController), svc };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SuperadminTokenUsageController', () => {
  // ── Default days = 30, limit = 10 ─────────────────────────────────────────

  it('overview: uses default days=30 and returns service result', async () => {
    const { controller, svc } = await build();
    const result = await controller.overview(30);
    expect(svc.overview).toHaveBeenCalledWith(30);
    expect(result).toBe(mockOverview);
  });

  it('byOrg: uses default days=30, limit=10 and returns service result', async () => {
    const { controller, svc } = await build();
    const result = await controller.byOrg(30, 10);
    expect(svc.byOrg).toHaveBeenCalledWith(30, 10);
    expect(result).toBe(mockByOrgRows);
  });

  // ── Clamping: unknown days → 30 ───────────────────────────────────────────

  it('overview: clamps unknown days (e.g. 14) to 30', async () => {
    const { controller, svc } = await build();
    await controller.overview(14);
    expect(svc.overview).toHaveBeenCalledWith(30);
  });

  it('byOrg: clamps unknown days (e.g. 60) to 30, valid days=7 pass through', async () => {
    const { controller, svc } = await build();
    await controller.byOrg(60, 5);
    expect(svc.byOrg).toHaveBeenCalledWith(30, 5);

    await controller.byOrg(7, 5);
    expect(svc.byOrg).toHaveBeenCalledWith(7, 5);

    await controller.byOrg(90, 5);
    expect(svc.byOrg).toHaveBeenCalledWith(90, 5);
  });

  // ── Limit clamping: >100 → 100 ────────────────────────────────────────────

  it('byUser/byCase/byConversation: limit >100 clamps to 100', async () => {
    const { controller, svc } = await build();

    await controller.byUser(30, 200);
    expect(svc.byUser).toHaveBeenCalledWith(30, 100);

    await controller.byCase(30, 150);
    expect(svc.byCase).toHaveBeenCalledWith(30, 100);

    await controller.byConversation(30, 999);
    expect(svc.byConversation).toHaveBeenCalledWith(30, 100);
  });

  // ── Pass-through for endpoints without limit ───────────────────────────────

  it('orgModelMatrix: passes clamped days through, returns service result', async () => {
    const { controller, svc } = await build();
    const result = await controller.orgModelMatrix(7);
    expect(svc.orgModelMatrix).toHaveBeenCalledWith(7);
    expect(result).toBe(mockMatrixRows);
  });

  it('cacheEffectiveness: passes clamped days through, returns service result', async () => {
    const { controller, svc } = await build();
    const result = await controller.cacheEffectiveness(90);
    expect(svc.cacheEffectiveness).toHaveBeenCalledWith(90);
    expect(result).toBe(mockCacheEff);
  });

  // ── Each endpoint returns service result unchanged ─────────────────────────

  it('byUser/byCase/byConversation: return service results unchanged', async () => {
    const { controller, svc } = await build();

    expect(await controller.byUser(30, 10)).toBe(mockByUserRows);
    expect(svc.byUser).toHaveBeenCalledWith(30, 10);

    expect(await controller.byCase(30, 10)).toBe(mockByCaseRows);
    expect(svc.byCase).toHaveBeenCalledWith(30, 10);

    expect(await controller.byConversation(30, 10)).toBe(mockByConvRows);
    expect(svc.byConversation).toHaveBeenCalledWith(30, 10);
  });
});
