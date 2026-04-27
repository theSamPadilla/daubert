import { ForbiddenException } from '@nestjs/common';
import { CaseAccessService } from './case-access.service';

describe('CaseAccessService.assertAccess', () => {
  let service: CaseAccessService;
  const memberRepo = { findOneBy: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CaseAccessService(memberRepo as any);
  });

  // ── User principal ─────────────────────────────────────────────────────────

  it('user principal: returns the membership when found', async () => {
    const membership = { userId: 'u1', caseId: 'c1', role: 'editor' };
    memberRepo.findOneBy.mockResolvedValue(membership);

    const result = await service.assertAccess(
      { kind: 'user', userId: 'u1' },
      'c1',
    );
    expect(result).toBe(membership);
    expect(memberRepo.findOneBy).toHaveBeenCalledWith({
      userId: 'u1',
      caseId: 'c1',
    });
  });

  it('user principal: throws ForbiddenException when not a member', async () => {
    memberRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.assertAccess({ kind: 'user', userId: 'u1' }, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── Script principal ───────────────────────────────────────────────────────

  it('script principal: passes when caseId matches (returns null)', async () => {
    const result = await service.assertAccess(
      { kind: 'script', caseId: 'c1' },
      'c1',
    );
    expect(result).toBeNull();
    expect(memberRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('script principal: throws ForbiddenException with cross_case_access on mismatch', async () => {
    await expect(
      service.assertAccess({ kind: 'script', caseId: 'c1' }, 'c2'),
    ).rejects.toThrow('cross_case_access');

    await expect(
      service.assertAccess({ kind: 'script', caseId: 'c1' }, 'c2'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(memberRepo.findOneBy).not.toHaveBeenCalled();
  });
});
