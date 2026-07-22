import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DeclarantsService } from './declarants.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';
const OTHER_ORG_ID = 'org-2';
const DECLARANT_ID = 'declarant-1';
const OWNER_USER_ID = 'user-owner';
const OTHER_USER_ID = 'user-other';

const ADMIN_REQUESTER = { userId: 'user-admin', orgRole: 'admin' };
const OWNER_REQUESTER = { userId: OWNER_USER_ID, orgRole: 'member' };
const NON_OWNER_REQUESTER = { userId: OTHER_USER_ID, orgRole: 'member' };

function makeDeclarant(overrides: any = {}) {
  return {
    id: DECLARANT_ID,
    displayName: 'Dr. Jane Smith',
    title: null,
    firm: null,
    qualifications: [],
    cvExhibit: null,
    priorTestimony: [],
    hourlyRate: null,
    nonContingencyDisclosure: null,
    dateOfBirth: null,
    address: null,
    organizationId: ORG_ID,
    userId: OWNER_USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockDeclarantRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

function makeService() {
  return new DeclarantsService(mockDeclarantRepo as any);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeclarantsService — listForOrg', () => {
  let service: DeclarantsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('returns org-scoped declarants ordered by displayName', async () => {
    const declarants = [makeDeclarant({ id: 'd1' }), makeDeclarant({ id: 'd2' })];
    mockDeclarantRepo.find.mockResolvedValue(declarants);

    const result = await service.listForOrg(ORG_ID);

    expect(result).toEqual(declarants);
    expect(mockDeclarantRepo.find).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID },
      order: { displayName: 'ASC' },
    });
  });

  it('returns an empty array when the org has no declarants', async () => {
    mockDeclarantRepo.find.mockResolvedValue([]);

    const result = await service.listForOrg(ORG_ID);

    expect(result).toEqual([]);
  });
});

describe('DeclarantsService — create', () => {
  let service: DeclarantsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('sets organizationId from the arg and passes qualifications/priorTestimony through when well-formed', async () => {
    const dto = {
      displayName: 'Dr. Jane Smith',
      qualifications: [{ id: 'p1', text: 'PhD', subItems: [], exhibitIds: [], footnotes: [] }],
      priorTestimony: ['Case A', 'Case B'],
    };
    mockDeclarantRepo.create.mockImplementation((args) => ({ ...args }));
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve({ id: 'new-id', ...d }));

    const result = await service.create(ORG_ID, dto as any, OWNER_REQUESTER);

    expect(mockDeclarantRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Dr. Jane Smith',
        qualifications: [{ id: 'p1', text: 'PhD', subItems: [], exhibitIds: [], footnotes: [] }],
        priorTestimony: ['Case A', 'Case B'],
        organizationId: ORG_ID,
      }),
    );
    expect(result).toMatchObject({ organizationId: ORG_ID, displayName: 'Dr. Jane Smith' });
  });

  it('coerces malformed qualifications so every stored paragraph is well-formed', async () => {
    const dto = {
      displayName: 'Messy',
      // A nested empty array, a paragraph missing `text`, and a non-object entry.
      qualifications: [[], { id: 'keep', subItems: [] }, 'nope'],
    };
    mockDeclarantRepo.create.mockImplementation((args) => ({ ...args }));
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve({ id: 'new-id', ...d }));

    await service.create(ORG_ID, dto as any, OWNER_REQUESTER);

    const created = mockDeclarantRepo.create.mock.calls[0][0];
    // The array `[]` and the string `'nope'` are dropped; the object survives with
    // a defaulted `text` and array fields — never an undefined `text`.
    expect(created.qualifications).toEqual([
      { id: 'keep', text: '', subItems: [], exhibitIds: [], footnotes: [] },
    ]);
  });

  it('coerces priorTestimony to an array of strings, dropping non-strings', async () => {
    const dto = {
      displayName: 'Messy',
      priorTestimony: ['Case A', 42, null, { foo: 'bar' }, 'Case B'],
    };
    mockDeclarantRepo.create.mockImplementation((args) => ({ ...args }));
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve({ id: 'new-id', ...d }));

    await service.create(ORG_ID, dto as any, OWNER_REQUESTER);

    const created = mockDeclarantRepo.create.mock.calls[0][0];
    expect(created.priorTestimony).toEqual(['Case A', 'Case B']);
  });

  it('defaults missing/undefined jsonb arrays to empty lists', async () => {
    const dto = { displayName: 'Minimal' };
    mockDeclarantRepo.create.mockImplementation((args) => ({ ...args }));
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve({ id: 'new-id', ...d }));

    await service.create(ORG_ID, dto as any, OWNER_REQUESTER);

    const created = mockDeclarantRepo.create.mock.calls[0][0];
    expect(created.qualifications).toEqual([]);
    expect(created.priorTestimony).toEqual([]);
  });

  it('throws ForbiddenException when a non-admin sets userId to another member', async () => {
    const dto = { displayName: 'Hijack', userId: OTHER_USER_ID };

    await expect(
      service.create(ORG_ID, dto as any, OWNER_REQUESTER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockDeclarantRepo.create).not.toHaveBeenCalled();
    expect(mockDeclarantRepo.save).not.toHaveBeenCalled();
  });

  it('allows a non-admin to self-link userId to their own id', async () => {
    const dto = { displayName: 'Self Link', userId: OWNER_USER_ID };
    mockDeclarantRepo.create.mockImplementation((args) => ({ ...args }));
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve({ id: 'new-id', ...d }));

    const result = await service.create(ORG_ID, dto as any, OWNER_REQUESTER);

    expect(result).toMatchObject({ userId: OWNER_USER_ID });
  });

  it('allows an admin to set userId to an arbitrary member', async () => {
    const dto = { displayName: 'Admin Link', userId: OTHER_USER_ID };
    mockDeclarantRepo.create.mockImplementation((args) => ({ ...args }));
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve({ id: 'new-id', ...d }));

    const result = await service.create(ORG_ID, dto as any, ADMIN_REQUESTER);

    expect(result).toMatchObject({ userId: OTHER_USER_ID });
  });

  it('allows create with no userId at all', async () => {
    const dto = { displayName: 'No Link' };
    mockDeclarantRepo.create.mockImplementation((args) => ({ ...args }));
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve({ id: 'new-id', ...d }));

    await expect(service.create(ORG_ID, dto as any, OWNER_REQUESTER)).resolves.toBeDefined();
  });
});

describe('DeclarantsService — update', () => {
  let service: DeclarantsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('throws NotFoundException on a cross-org id (before any ownership check)', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.update(OTHER_ORG_ID, DECLARANT_ID, { displayName: 'Hijacked' }, ADMIN_REQUESTER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockDeclarantRepo.findOneBy).toHaveBeenCalledWith({
      id: DECLARANT_ID,
      organizationId: OTHER_ORG_ID,
    });
  });

  it('throws ForbiddenException for a non-admin who does not own the declarant', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant({ userId: OWNER_USER_ID }));

    await expect(
      service.update(ORG_ID, DECLARANT_ID, { displayName: 'Nope' }, NON_OWNER_REQUESTER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockDeclarantRepo.save).not.toHaveBeenCalled();
  });

  it('allows an admin to update any declarant in the org', async () => {
    const declarant = makeDeclarant({ userId: OWNER_USER_ID });
    mockDeclarantRepo.findOneBy.mockResolvedValue(declarant);
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve(d));

    const result = await service.update(ORG_ID, DECLARANT_ID, { displayName: 'Admin Edit' }, ADMIN_REQUESTER);

    expect(result.displayName).toBe('Admin Edit');
    expect(mockDeclarantRepo.save).toHaveBeenCalled();
  });

  it('allows the owner (requester.userId === declarant.userId) to update', async () => {
    const declarant = makeDeclarant({ userId: OWNER_USER_ID });
    mockDeclarantRepo.findOneBy.mockResolvedValue(declarant);
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve(d));

    const result = await service.update(ORG_ID, DECLARANT_ID, { displayName: 'Owner Edit' }, OWNER_REQUESTER);

    expect(result.displayName).toBe('Owner Edit');
    expect(mockDeclarantRepo.save).toHaveBeenCalled();
  });

  it('normalizes qualifications/priorTestimony on update', async () => {
    const declarant = makeDeclarant({ userId: OWNER_USER_ID });
    mockDeclarantRepo.findOneBy.mockResolvedValue(declarant);
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve(d));

    const result = await service.update(
      ORG_ID,
      DECLARANT_ID,
      { qualifications: [{ id: 'q', subItems: [] }, 'junk'], priorTestimony: ['x', 5] },
      OWNER_REQUESTER,
    );

    expect(result.qualifications).toEqual([
      { id: 'q', text: '', subItems: [], exhibitIds: [], footnotes: [] },
    ]);
    expect(result.priorTestimony).toEqual(['x']);
  });

  it('throws ForbiddenException when a non-admin sets userId to another member', async () => {
    const declarant = makeDeclarant({ userId: OWNER_USER_ID });
    mockDeclarantRepo.findOneBy.mockResolvedValue(declarant);

    await expect(
      service.update(ORG_ID, DECLARANT_ID, { userId: OTHER_USER_ID }, OWNER_REQUESTER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockDeclarantRepo.save).not.toHaveBeenCalled();
  });

  it('allows a non-admin to self-link userId to their own id', async () => {
    const declarant = makeDeclarant({ userId: OWNER_USER_ID });
    mockDeclarantRepo.findOneBy.mockResolvedValue(declarant);
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve(d));

    const result = await service.update(
      ORG_ID, DECLARANT_ID, { userId: OWNER_USER_ID }, OWNER_REQUESTER,
    );

    expect(result.userId).toBe(OWNER_USER_ID);
    expect(mockDeclarantRepo.save).toHaveBeenCalled();
  });

  it('allows an admin to set userId to an arbitrary member', async () => {
    const declarant = makeDeclarant({ userId: OWNER_USER_ID });
    mockDeclarantRepo.findOneBy.mockResolvedValue(declarant);
    mockDeclarantRepo.save.mockImplementation((d) => Promise.resolve(d));

    const result = await service.update(
      ORG_ID, DECLARANT_ID, { userId: OTHER_USER_ID }, ADMIN_REQUESTER,
    );

    expect(result.userId).toBe(OTHER_USER_ID);
    expect(mockDeclarantRepo.save).toHaveBeenCalled();
  });
});

describe('DeclarantsService — remove', () => {
  let service: DeclarantsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('throws NotFoundException on a cross-org id', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.remove(OTHER_ORG_ID, DECLARANT_ID, ADMIN_REQUESTER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockDeclarantRepo.findOneBy).toHaveBeenCalledWith({
      id: DECLARANT_ID,
      organizationId: OTHER_ORG_ID,
    });
  });

  it('throws ForbiddenException for a non-admin who does not own the declarant', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant({ userId: OWNER_USER_ID }));

    await expect(
      service.remove(ORG_ID, DECLARANT_ID, NON_OWNER_REQUESTER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockDeclarantRepo.remove).not.toHaveBeenCalled();
  });

  it('allows an admin to remove any declarant in the org', async () => {
    const declarant = makeDeclarant({ userId: OWNER_USER_ID });
    mockDeclarantRepo.findOneBy.mockResolvedValue(declarant);

    await service.remove(ORG_ID, DECLARANT_ID, ADMIN_REQUESTER);

    expect(mockDeclarantRepo.remove).toHaveBeenCalledWith(declarant);
  });

  it('allows the owner to remove their own declarant', async () => {
    const declarant = makeDeclarant({ userId: OWNER_USER_ID });
    mockDeclarantRepo.findOneBy.mockResolvedValue(declarant);

    await service.remove(ORG_ID, DECLARANT_ID, OWNER_REQUESTER);

    expect(mockDeclarantRepo.remove).toHaveBeenCalledWith(declarant);
  });
});
