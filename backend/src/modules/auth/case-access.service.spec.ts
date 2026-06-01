import { ForbiddenException } from '@nestjs/common';
import { CaseAccessService } from './case-access.service';
import { CaseRole } from '../../database/entities/case-member.entity';

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

describe('CaseAccessService.assertRole', () => {
  let service: CaseAccessService;
  const memberRepo = { findOneBy: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CaseAccessService(memberRepo as any);
  });

  // ── Script principal ───────────────────────────────────────────────────────

  it('script principal: returns null without checking role', async () => {
    const result = await service.assertRole(
      { kind: 'script', caseId: 'c1' },
      'c1',
      'editor' as CaseRole,
    );
    expect(result).toBeNull();
    expect(memberRepo.findOneBy).not.toHaveBeenCalled();
  });

  // ── User principal: sufficient role ───────────────────────────────────────

  it('user principal: returns membership when role meets the minimum (owner >= editor)', async () => {
    const membership = { userId: 'u1', caseId: 'c1', role: 'owner' as CaseRole };
    memberRepo.findOneBy.mockResolvedValue(membership);

    const result = await service.assertRole(
      { kind: 'user', userId: 'u1' },
      'c1',
      'editor' as CaseRole,
    );
    expect(result).toBe(membership);
  });

  it('user principal: returns membership when role exactly matches the minimum (editor >= editor)', async () => {
    const membership = { userId: 'u1', caseId: 'c1', role: 'editor' as CaseRole };
    memberRepo.findOneBy.mockResolvedValue(membership);

    const result = await service.assertRole(
      { kind: 'user', userId: 'u1' },
      'c1',
      'editor' as CaseRole,
    );
    expect(result).toBe(membership);
  });

  // ── User principal: insufficient role ─────────────────────────────────────

  it('user principal: throws ForbiddenException with correct message when role is below minimum', async () => {
    const membership = { userId: 'u1', caseId: 'c1', role: 'viewer' as CaseRole };
    memberRepo.findOneBy.mockResolvedValue(membership);

    await expect(
      service.assertRole(
        { kind: 'user', userId: 'u1' },
        'c1',
        'editor' as CaseRole,
      ),
    ).rejects.toThrow("Requires role 'editor' or higher");

    await expect(
      service.assertRole(
        { kind: 'user', userId: 'u1' },
        'c1',
        'editor' as CaseRole,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── User principal: not a member ──────────────────────────────────────────

  it('user principal: propagates ForbiddenException from assertAccess when not a member', async () => {
    memberRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.assertRole(
        { kind: 'user', userId: 'u1' },
        'c1',
        'viewer' as CaseRole,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // The message should be assertAccess's message, not assertRole's
    await expect(
      service.assertRole(
        { kind: 'user', userId: 'u1' },
        'c1',
        'viewer' as CaseRole,
      ),
    ).rejects.toThrow('You do not have access to this case');
  });
});
