import { ConflictException, NotFoundException } from '@nestjs/common';
import { CasesService } from './cases.service';
import { CaseRole } from '../../database/entities/case-member.entity';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

const mockMemberRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

const mockDataSource = {
  transaction: jest.fn(),
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CASE_ID = 'case-1';
const OWNER_ID = 'user-owner';
const EDITOR_ID = 'user-editor';

function makeMember(userId: string, role: CaseRole) {
  return { id: `m-${userId}`, userId, caseId: CASE_ID, role } as any;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService() {
  return new CasesService(mockRepo as any, mockMemberRepo as any, mockDataSource as any);
}

/**
 * Wire dataSource.transaction to invoke the callback with a mock EntityManager.
 * Returns the mock manager so individual tests can set up method return values.
 */
function setupTransaction(managerOverrides: Partial<{
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  count: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
}> = {}) {
  const mockManager = {
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
    remove: jest.fn().mockResolvedValue(undefined),
    ...managerOverrides,
  };
  mockDataSource.transaction.mockImplementation((cb: (m: any) => Promise<any>) => cb(mockManager));
  return mockManager;
}

// ── ≥1 owner invariant: updateMemberRole ─────────────────────────────────────

describe('CasesService — ≥1 owner invariant: updateMemberRole', () => {
  let service: CasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('wraps the operation in a transaction', async () => {
    const member = makeMember(EDITOR_ID, 'editor');
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
    });
    mgr.save.mockResolvedValue({ ...member, role: 'owner' });

    await service.updateMemberRole(CASE_ID, EDITOR_ID, 'owner');

    expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('demoting the only owner throws ConflictException', async () => {
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(makeMember(OWNER_ID, 'owner')),
      count: jest.fn().mockResolvedValue(1),
    });
    // suppress unused-var warning
    void mgr;

    await expect(service.updateMemberRole(CASE_ID, OWNER_ID, 'editor')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateMemberRole(CASE_ID, OWNER_ID, 'viewer')).rejects.toBeInstanceOf(ConflictException);
  });

  it('demoting one of two owners succeeds', async () => {
    const member = makeMember(OWNER_ID, 'owner');
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
      count: jest.fn().mockResolvedValue(2),
    });
    mgr.save.mockResolvedValue({ ...member, role: 'editor' });

    const result = await service.updateMemberRole(CASE_ID, OWNER_ID, 'editor');

    expect(mgr.count).toHaveBeenCalledWith(
      expect.anything(),
      { where: { caseId: CASE_ID, role: 'owner' } },
    );
    expect(result.role).toBe('editor');
  });

  it('promoting a non-owner skips the invariant check entirely', async () => {
    const member = makeMember(EDITOR_ID, 'editor');
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
    });
    mgr.save.mockResolvedValue({ ...member, role: 'owner' });

    await service.updateMemberRole(CASE_ID, EDITOR_ID, 'owner');

    // count must NOT be called when promoting to owner
    expect(mgr.count).not.toHaveBeenCalled();
  });
});

// ── ≥1 owner invariant: removeMember ─────────────────────────────────────────

describe('CasesService — ≥1 owner invariant: removeMember', () => {
  let service: CasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('removing the only owner throws ConflictException', async () => {
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(makeMember(OWNER_ID, 'owner')),
      count: jest.fn().mockResolvedValue(1),
    });

    await expect(service.removeMember(CASE_ID, OWNER_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('removing a non-existent member throws NotFoundException', async () => {
    // assertNotLastOwner sees null → short-circuits (not owner)
    // then the second findOneBy also returns null → NotFoundException
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(null),
    });

    await expect(service.removeMember(CASE_ID, 'unknown-user')).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ── ≥1 owner invariant: leave ────────────────────────────────────────────────

describe('CasesService — ≥1 owner invariant: leave', () => {
  let service: CasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('last owner self-leaves throws ConflictException', async () => {
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(makeMember(OWNER_ID, 'owner')),
      count: jest.fn().mockResolvedValue(1),
    });

    await expect(service.leave(CASE_ID, OWNER_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('editor self-leave succeeds', async () => {
    const member = makeMember(EDITOR_ID, 'editor');
    // assertNotLastOwner: findOneBy returns editor (role !== owner → short-circuits)
    // leave's own findOneBy: returns the member
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
    });

    await service.leave(CASE_ID, EDITOR_ID);

    expect(mgr.remove).toHaveBeenCalledWith(member);
  });

  it('non-member self-leave throws NotFoundException', async () => {
    // assertNotLastOwner: findOneBy returns null → short-circuits
    // leave's own findOneBy: also returns null → NotFoundException
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(null),
    });

    await expect(service.leave(CASE_ID, 'not-a-member')).rejects.toBeInstanceOf(NotFoundException);
  });
});
