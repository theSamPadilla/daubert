import { ForbiddenException } from '@nestjs/common';
import { CaseAccessService } from './case-access.service';
import { CaseRole } from '../../database/entities/case-member.entity';

describe('CaseAccessService.assertAccess', () => {
  let service: CaseAccessService;
  const memberRepo = { findOneBy: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CaseAccessService(
      memberRepo as any,
      { findOneBy: jest.fn().mockResolvedValue(null) } as any,
      { findOneBy: jest.fn().mockResolvedValue(null) } as any,
      { findOneBy: jest.fn().mockResolvedValue(null) } as any,
    );
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
      { kind: 'script', caseId: 'c1', role: 'editor' },
      'c1',
    );
    expect(result).toBeNull();
    expect(memberRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('script principal: throws ForbiddenException with cross_case_access on mismatch', async () => {
    await expect(
      service.assertAccess({ kind: 'script', caseId: 'c1', role: 'editor' }, 'c2'),
    ).rejects.toThrow('cross_case_access');

    await expect(
      service.assertAccess({ kind: 'script', caseId: 'c1', role: 'editor' }, 'c2'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(memberRepo.findOneBy).not.toHaveBeenCalled();
  });
});

describe('CaseAccessService.assertRole', () => {
  let service: CaseAccessService;
  const memberRepo = { findOneBy: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CaseAccessService(
      memberRepo as any,
      { findOneBy: jest.fn().mockResolvedValue(null) } as any,
      { findOneBy: jest.fn().mockResolvedValue(null) } as any,
      { findOneBy: jest.fn().mockResolvedValue(null) } as any,
    );
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

describe('CaseAccessService.assertRole — script principal role enforcement', () => {
  let service: CaseAccessService;
  const memberRepo = { findOneBy: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CaseAccessService(
      memberRepo as any,
      { findOneBy: jest.fn().mockResolvedValue(null) } as any,
      { findOneBy: jest.fn().mockResolvedValue(null) } as any,
      { findOneBy: jest.fn().mockResolvedValue(null) } as any,
    );
  });

  it('script viewer: admitted for minRole=viewer', async () => {
    const result = await service.assertRole(
      { kind: 'script', caseId: 'c1', role: 'viewer' },
      'c1',
      'viewer' as CaseRole,
    );
    expect(result).toBeNull();
  });

  it('script viewer: forbidden for minRole=editor', async () => {
    await expect(
      service.assertRole(
        { kind: 'script', caseId: 'c1', role: 'viewer' },
        'c1',
        'editor' as CaseRole,
      ),
    ).rejects.toThrow("Requires role 'editor' or higher");
  });

  it('script editor: admitted for minRole=editor', async () => {
    const result = await service.assertRole(
      { kind: 'script', caseId: 'c1', role: 'editor' },
      'c1',
      'editor' as CaseRole,
    );
    expect(result).toBeNull();
  });

  it('script editor: forbidden for minRole=owner', async () => {
    await expect(
      service.assertRole(
        { kind: 'script', caseId: 'c1', role: 'editor' },
        'c1',
        'owner' as CaseRole,
      ),
    ).rejects.toThrow("Requires role 'owner' or higher");
  });

  it('script owner: admitted for all roles', async () => {
    for (const min of ['viewer', 'editor', 'owner'] as CaseRole[]) {
      const r = await service.assertRole(
        { kind: 'script', caseId: 'c1', role: 'owner' },
        'c1',
        min,
      );
      expect(r).toBeNull();
    }
  });

  it('script principal: cross-case still forbidden regardless of role', async () => {
    await expect(
      service.assertRole(
        { kind: 'script', caseId: 'c1', role: 'owner' },
        'c2',
        'viewer' as CaseRole,
      ),
    ).rejects.toThrow('cross_case_access');
  });
});

describe('CaseAccessService — mcp principal cross-org chokepoint', () => {
  let service: CaseAccessService;
  const memberRepo = { findOneBy: jest.fn() };
  const caseRepo = { findOne: jest.fn(), findOneBy: jest.fn() };
  const orgMemberRepo = { findOneBy: jest.fn() };
  const orgRepo = { findOneBy: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CaseAccessService(
      memberRepo as any,
      caseRepo as any,
      orgMemberRepo as any,
      orgRepo as any,
    );
  });

  // ── (a) Cross-org gate ────────────────────────────────────────────────────

  it('mcp principal: rejects when case.orgId !== principal.organizationId (cross_org_access) without leaking case data', async () => {
    caseRepo.findOne.mockResolvedValue({ id: 'c1', orgId: 'org-OTHER', name: 'Secret Case' });

    const principal = {
      kind: 'mcp' as const,
      userId: 'u1',
      organizationId: 'org-MINE',
      sessionId: 's1',
    };

    const promise = service.assertAccess(principal, 'c1');

    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(promise).rejects.toThrow('cross_org_access');

    // Confirm the error message does NOT leak case data (name, orgId).
    try {
      await service.assertAccess(principal, 'c1');
    } catch (e: any) {
      expect(e.message).not.toContain('Secret Case');
      expect(e.message).not.toContain('org-OTHER');
    }

    // No membership lookup should have happened — gate is the cross-org check.
    expect(memberRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('mcp principal: case not found → ForbiddenException (opaque)', async () => {
    caseRepo.findOne.mockResolvedValue(null);

    const principal = {
      kind: 'mcp' as const,
      userId: 'u1',
      organizationId: 'org-MINE',
      sessionId: 's1',
    };

    await expect(service.assertAccess(principal, 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Should not leak case existence; matches the file's opaque-not-found convention.
    expect(memberRepo.findOneBy).not.toHaveBeenCalled();
  });

  // ── (b) Same-org with explicit case_members row ───────────────────────────

  it('mcp principal: same-org, user has editor case_members row → assertRole returns the membership', async () => {
    caseRepo.findOne.mockResolvedValue({ id: 'c1', orgId: 'org-MINE' });
    const membership = { userId: 'u1', caseId: 'c1', role: 'editor' as CaseRole };
    memberRepo.findOneBy.mockResolvedValue(membership);

    const result = await service.assertRole(
      {
        kind: 'mcp',
        userId: 'u1',
        organizationId: 'org-MINE',
        sessionId: 's1',
      },
      'c1',
      'editor' as CaseRole,
    );

    expect(result).toBe(membership);
    expect(memberRepo.findOneBy).toHaveBeenCalledWith({
      userId: 'u1',
      caseId: 'c1',
    });
  });

  // ── (c) Same-org, org-admin with no case_members row → implicit owner ────

  it('mcp principal: same-org, no case_members row, user is org admin → returns synthetic owner via tryOrgImplicit', async () => {
    caseRepo.findOne.mockResolvedValue({ id: 'c1', orgId: 'org-MINE' });
    // tryOrgImplicit calls caseRepo.findOneBy as well — return the same case.
    caseRepo.findOneBy.mockResolvedValue({ id: 'c1', orgId: 'org-MINE' });
    memberRepo.findOneBy.mockResolvedValue(null);
    orgMemberRepo.findOneBy.mockResolvedValue({
      userId: 'u1',
      organizationId: 'org-MINE',
      role: 'admin',
    });
    orgRepo.findOneBy.mockResolvedValue({ id: 'org-MINE', deletedAt: null });

    const result = await service.assertAccess(
      {
        kind: 'mcp',
        userId: 'u1',
        organizationId: 'org-MINE',
        sessionId: 's1',
      },
      'c1',
    );

    expect(result).not.toBeNull();
    expect(result!.role).toBe('owner');
    expect(result!.userId).toBe('u1');
    expect(result!.caseId).toBe('c1');
  });

  // ── (d) Same-org, no case access and not org-admin → denied ───────────────

  it('mcp principal: same-org but no case_members row and not org-admin → ForbiddenException', async () => {
    caseRepo.findOne.mockResolvedValue({ id: 'c1', orgId: 'org-MINE' });
    caseRepo.findOneBy.mockResolvedValue({ id: 'c1', orgId: 'org-MINE' });
    memberRepo.findOneBy.mockResolvedValue(null);
    // No org membership at all.
    orgMemberRepo.findOneBy.mockResolvedValue(null);
    orgRepo.findOneBy.mockResolvedValue({ id: 'org-MINE', deletedAt: null });

    await expect(
      service.assertAccess(
        {
          kind: 'mcp',
          userId: 'u1',
          organizationId: 'org-MINE',
          sessionId: 's1',
        },
        'c1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── assertRole role-enforcement on mcp branch ─────────────────────────────

  it('mcp principal: assertRole rejects when membership role is below minRole', async () => {
    caseRepo.findOne.mockResolvedValue({ id: 'c1', orgId: 'org-MINE' });
    memberRepo.findOneBy.mockResolvedValue({
      userId: 'u1',
      caseId: 'c1',
      role: 'viewer' as CaseRole,
    });

    await expect(
      service.assertRole(
        {
          kind: 'mcp',
          userId: 'u1',
          organizationId: 'org-MINE',
          sessionId: 's1',
        },
        'c1',
        'editor' as CaseRole,
      ),
    ).rejects.toThrow("Requires role 'editor' or higher");
  });
});
