import { NotFoundException } from '@nestjs/common';
import { DeclarationLibraryService } from './declaration-library.service';
import { DeclarationLibraryBlockKind } from '../../database/entities/declaration-library-block.entity';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';
const OTHER_ORG_ID = 'org-2';
const BLOCK_ID = 'block-1';

function makeBlock(overrides: any = {}) {
  return {
    id: BLOCK_ID,
    kind: DeclarationLibraryBlockKind.DECLARANT_PROFILE,
    name: 'Test Block',
    category: null,
    content: {},
    organizationId: ORG_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockBlockRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

function makeService() {
  return new DeclarationLibraryService(mockBlockRepo as any);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeclarationLibraryService — listForOrg', () => {
  let service: DeclarationLibraryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('returns org-scoped blocks ordered by kind then name', async () => {
    const blocks = [makeBlock({ id: 'b1' }), makeBlock({ id: 'b2' })];
    mockBlockRepo.find.mockResolvedValue(blocks);

    const result = await service.listForOrg(ORG_ID);

    expect(result).toEqual(blocks);
    expect(mockBlockRepo.find).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID },
      order: { kind: 'ASC', name: 'ASC' },
    });
  });

  it('applies an optional kind filter', async () => {
    mockBlockRepo.find.mockResolvedValue([]);

    await service.listForOrg(ORG_ID, DeclarationLibraryBlockKind.BOILERPLATE);

    expect(mockBlockRepo.find).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, kind: DeclarationLibraryBlockKind.BOILERPLATE },
      order: { kind: 'ASC', name: 'ASC' },
    });
  });

  it('returns empty array when org has no blocks', async () => {
    mockBlockRepo.find.mockResolvedValue([]);

    const result = await service.listForOrg(ORG_ID);

    expect(result).toEqual([]);
  });
});

describe('DeclarationLibraryService — create', () => {
  let service: DeclarationLibraryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('creates a block with a valid kind and sets organizationId', async () => {
    const dto = {
      kind: DeclarationLibraryBlockKind.DECLARANT_PROFILE,
      name: 'New Block',
      category: 'General',
      content: {
        paragraphs: [{ id: 'p1', text: 'Hello', subItems: [], exhibitIds: [], footnotes: [] }],
      },
    };
    mockBlockRepo.create.mockImplementation((args) => ({ ...args }));
    mockBlockRepo.save.mockImplementation((b) => Promise.resolve({ id: 'new-id', ...b }));

    const result = await service.create(ORG_ID, dto as any);

    expect(mockBlockRepo.create).toHaveBeenCalledWith({
      ...dto,
      content: { paragraphs: [{ id: 'p1', text: 'Hello', subItems: [], exhibitIds: [], footnotes: [] }] },
      organizationId: ORG_ID,
    });
    expect(result).toMatchObject({ organizationId: ORG_ID, kind: dto.kind, name: dto.name });
  });

  it('normalizes malformed content so every stored paragraph is well-formed', async () => {
    const dto = {
      kind: DeclarationLibraryBlockKind.BOILERPLATE,
      name: 'Messy',
      // Junk the class-transformer mangling / a bad client could produce:
      // a nested empty array, a paragraph missing `text`, and a non-object entry.
      content: { paragraphs: [[], { id: 'keep', subItems: [] }, 'nope'] },
    };
    mockBlockRepo.create.mockImplementation((args) => ({ ...args }));
    mockBlockRepo.save.mockImplementation((b) => Promise.resolve({ id: 'new-id', ...b }));

    await service.create(ORG_ID, dto as any);

    const created = mockBlockRepo.create.mock.calls[0][0];
    // The array `[]` and the string `'nope'` are dropped; the object survives with
    // a defaulted `text` and array fields — never an undefined `text`.
    expect(created.content).toEqual({
      paragraphs: [{ id: 'keep', text: '', subItems: [], exhibitIds: [], footnotes: [] }],
    });
  });

  it('coerces a completely missing paragraphs array to an empty list', async () => {
    const dto = {
      kind: DeclarationLibraryBlockKind.BOILERPLATE,
      name: 'Empty',
      content: { foo: 'bar' },
    };
    mockBlockRepo.create.mockImplementation((args) => ({ ...args }));
    mockBlockRepo.save.mockImplementation((b) => Promise.resolve({ id: 'new-id', ...b }));

    await service.create(ORG_ID, dto as any);

    const created = mockBlockRepo.create.mock.calls[0][0];
    expect(created.content).toEqual({ paragraphs: [] });
  });
});

describe('DeclarationLibraryService — update', () => {
  let service: DeclarationLibraryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('merges dto fields onto the existing block and saves', async () => {
    const block = makeBlock();
    mockBlockRepo.findOneBy.mockResolvedValue(block);
    mockBlockRepo.save.mockImplementation((b) => Promise.resolve(b));

    const result = await service.update(ORG_ID, BLOCK_ID, { name: 'Updated Name' });

    expect(mockBlockRepo.findOneBy).toHaveBeenCalledWith({ id: BLOCK_ID, organizationId: ORG_ID });
    expect(result.name).toBe('Updated Name');
    expect(mockBlockRepo.save).toHaveBeenCalled();
  });

  it('throws NotFoundException on a cross-org id', async () => {
    // Cross-org: findOneBy scoped by organizationId returns null since the block
    // belongs to a different org.
    mockBlockRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.update(OTHER_ORG_ID, BLOCK_ID, { name: 'Hijacked' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockBlockRepo.findOneBy).toHaveBeenCalledWith({ id: BLOCK_ID, organizationId: OTHER_ORG_ID });
  });

  it('throws NotFoundException when block does not exist at all', async () => {
    mockBlockRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.update(ORG_ID, 'ghost-id', { name: 'Nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DeclarationLibraryService — remove', () => {
  let service: DeclarationLibraryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('removes the block when found and scoped correctly', async () => {
    const block = makeBlock();
    mockBlockRepo.findOneBy.mockResolvedValue(block);

    await service.remove(ORG_ID, BLOCK_ID);

    expect(mockBlockRepo.findOneBy).toHaveBeenCalledWith({ id: BLOCK_ID, organizationId: ORG_ID });
    expect(mockBlockRepo.remove).toHaveBeenCalledWith(block);
  });

  it('throws NotFoundException on a cross-org id', async () => {
    mockBlockRepo.findOneBy.mockResolvedValue(null);

    await expect(service.remove(OTHER_ORG_ID, BLOCK_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when block does not exist at all', async () => {
    mockBlockRepo.findOneBy.mockResolvedValue(null);

    await expect(service.remove(ORG_ID, 'ghost-id')).rejects.toBeInstanceOf(NotFoundException);
  });
});
