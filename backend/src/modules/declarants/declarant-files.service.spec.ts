import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { DeclarantFileKind } from '../../database/entities/declarant-file.entity';
import { DeclarantFilesService } from './declarant-files.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';
const OTHER_ORG_ID = 'org-2';
const DECLARANT_ID = 'declarant-1';
const FILE_ID = 'file-1';
const OWNER_USER_ID = 'user-owner';
const OTHER_USER_ID = 'user-other';

const ADMIN_REQUESTER = { userId: 'user-admin', orgRole: 'admin' };
const OWNER_REQUESTER = { userId: OWNER_USER_ID, orgRole: 'member' };
const NON_OWNER_REQUESTER = { userId: OTHER_USER_ID, orgRole: 'member' };

function makeDeclarant(overrides: any = {}) {
  return {
    id: DECLARANT_ID,
    displayName: 'Dr. Jane Smith',
    organizationId: ORG_ID,
    userId: OWNER_USER_ID,
    ...overrides,
  };
}

function makeFile(overrides: any = {}) {
  return {
    id: FILE_ID,
    declarantId: DECLARANT_ID,
    kind: DeclarantFileKind.CV,
    name: 'cv.pdf',
    mimeType: 'application/pdf',
    size: '1024',
    objectKey: `org/${ORG_ID}/${FILE_ID}`,
    uploadedByUserId: OWNER_USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFileRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

const mockDeclarantRepo = {
  findOneBy: jest.fn(),
};

const mockStorage = {
  upload: jest.fn(),
  download: jest.fn(),
  delete: jest.fn(),
};

function makeService() {
  return new DeclarantFilesService(
    mockFileRepo as any,
    mockDeclarantRepo as any,
    mockStorage as any,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeclarantFilesService — list', () => {
  let service: DeclarantFilesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('throws NotFoundException on a cross-org declarant id', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(null);

    await expect(service.list(OTHER_ORG_ID, DECLARANT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mockDeclarantRepo.findOneBy).toHaveBeenCalledWith({
      id: DECLARANT_ID,
      organizationId: OTHER_ORG_ID,
    });
  });

  it('returns files for the declarant without an ownership check', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant());
    const files = [makeFile({ id: 'f1' }), makeFile({ id: 'f2' })];
    mockFileRepo.find.mockResolvedValue(files);

    const result = await service.list(ORG_ID, DECLARANT_ID);

    expect(result).toEqual(files);
    expect(mockFileRepo.find).toHaveBeenCalledWith({
      where: { declarantId: DECLARANT_ID },
    });
  });
});

describe('DeclarantFilesService — upload', () => {
  let service: DeclarantFilesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('throws NotFoundException on a cross-org declarant id (before any ownership check)', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(null);
    const stream = new Readable();

    await expect(
      service.upload(
        OTHER_ORG_ID,
        DECLARANT_ID,
        ADMIN_REQUESTER,
        DeclarantFileKind.CV,
        'cv.pdf',
        'application/pdf',
        stream,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockStorage.upload).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException for a non-admin who does not own the declarant', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant());
    const stream = new Readable();

    await expect(
      service.upload(
        ORG_ID,
        DECLARANT_ID,
        NON_OWNER_REQUESTER,
        DeclarantFileKind.CV,
        'cv.pdf',
        'application/pdf',
        stream,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockStorage.upload).not.toHaveBeenCalled();
    expect(mockFileRepo.save).not.toHaveBeenCalled();
  });

  it('allows the owner to upload, and uploads to storage BEFORE saving the row', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant());
    mockStorage.upload.mockResolvedValue({ size: 2048 });
    mockFileRepo.create.mockImplementation((args) => ({ ...args }));
    mockFileRepo.save.mockImplementation((row) => Promise.resolve(row));

    const stream = new Readable();
    const callOrder: string[] = [];
    mockStorage.upload.mockImplementation(async () => {
      callOrder.push('storage.upload');
      return { size: 2048 };
    });
    mockFileRepo.save.mockImplementation(async (row: any) => {
      callOrder.push('fileRepo.save');
      return row;
    });

    const result = await service.upload(
      ORG_ID,
      DECLARANT_ID,
      OWNER_REQUESTER,
      DeclarantFileKind.CV,
      'cv.pdf',
      'application/pdf',
      stream,
    );

    expect(callOrder).toEqual(['storage.upload', 'fileRepo.save']);
    expect(mockStorage.upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^org/${ORG_ID}/.+`)),
      stream,
      'application/pdf',
    );
    expect(mockFileRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        declarantId: DECLARANT_ID,
        kind: DeclarantFileKind.CV,
        name: 'cv.pdf',
        mimeType: 'application/pdf',
        size: '2048',
        uploadedByUserId: OWNER_USER_ID,
      }),
    );
    expect(result).toMatchObject({ declarantId: DECLARANT_ID, size: '2048' });
  });

  it('allows an admin to upload on behalf of any declarant in the org', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant());
    mockStorage.upload.mockResolvedValue({ size: 512 });
    mockFileRepo.create.mockImplementation((args) => ({ ...args }));
    mockFileRepo.save.mockImplementation((row) => Promise.resolve(row));

    const stream = new Readable();
    const result = await service.upload(
      ORG_ID,
      DECLARANT_ID,
      ADMIN_REQUESTER,
      DeclarantFileKind.PRIOR_DECLARATION,
      'decl.pdf',
      'application/pdf',
      stream,
    );

    expect(result).toMatchObject({ uploadedByUserId: ADMIN_REQUESTER.userId });
  });

  it('generates the object key using a UUID resolved up front (not the declarant id twice)', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant());
    mockStorage.upload.mockResolvedValue({ size: 100 });
    mockFileRepo.create.mockImplementation((args) => ({ ...args }));
    mockFileRepo.save.mockImplementation((row) => Promise.resolve(row));

    const stream = new Readable();
    await service.upload(
      ORG_ID,
      DECLARANT_ID,
      OWNER_REQUESTER,
      DeclarantFileKind.CV,
      'cv.pdf',
      'application/pdf',
      stream,
    );

    const created = mockFileRepo.create.mock.calls[0][0];
    const uploadedKey = mockStorage.upload.mock.calls[0][0];
    expect(created.objectKey).toBe(uploadedKey);
    expect(created.id).toBeDefined();
    expect(uploadedKey).toBe(`org/${ORG_ID}/${created.id}`);
  });
});

describe('DeclarantFilesService — download', () => {
  let service: DeclarantFilesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('throws NotFoundException on a cross-org declarant id', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(null);

    await expect(service.download(OTHER_ORG_ID, DECLARANT_ID, FILE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mockFileRepo.findOne).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the file does not belong to the declarant', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant());
    mockFileRepo.findOne.mockResolvedValue(null);

    await expect(service.download(ORG_ID, DECLARANT_ID, FILE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mockFileRepo.findOne).toHaveBeenCalledWith({
      where: { id: FILE_ID, declarantId: DECLARANT_ID },
    });
  });

  it('does not apply an ownership check for a member read', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant({ userId: OWNER_USER_ID }));
    const file = makeFile();
    mockFileRepo.findOne.mockResolvedValue(file);
    const stream = new Readable();
    mockStorage.download.mockResolvedValue({ stream });

    const result = await service.download(ORG_ID, DECLARANT_ID, FILE_ID);

    expect(result).toEqual({
      stream,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
    });
    expect(mockStorage.download).toHaveBeenCalledWith(file.objectKey);
  });
});

describe('DeclarantFilesService — remove', () => {
  let service: DeclarantFilesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('throws NotFoundException on a cross-org declarant id', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.remove(OTHER_ORG_ID, DECLARANT_ID, FILE_ID, ADMIN_REQUESTER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockStorage.delete).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException for a non-admin who does not own the declarant', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant());

    await expect(
      service.remove(ORG_ID, DECLARANT_ID, FILE_ID, NON_OWNER_REQUESTER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockFileRepo.findOne).not.toHaveBeenCalled();
    expect(mockStorage.delete).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the file does not belong to the declarant', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant());
    mockFileRepo.findOne.mockResolvedValue(null);

    await expect(
      service.remove(ORG_ID, DECLARANT_ID, FILE_ID, ADMIN_REQUESTER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockStorage.delete).not.toHaveBeenCalled();
  });

  it('deletes from storage BEFORE removing the row (owner)', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant());
    const file = makeFile();
    mockFileRepo.findOne.mockResolvedValue(file);

    const callOrder: string[] = [];
    mockStorage.delete.mockImplementation(async () => {
      callOrder.push('storage.delete');
    });
    mockFileRepo.remove.mockImplementation(async () => {
      callOrder.push('fileRepo.remove');
    });

    await service.remove(ORG_ID, DECLARANT_ID, FILE_ID, OWNER_REQUESTER);

    expect(callOrder).toEqual(['storage.delete', 'fileRepo.remove']);
    expect(mockStorage.delete).toHaveBeenCalledWith(file.objectKey);
    expect(mockFileRepo.remove).toHaveBeenCalledWith(file);
  });

  it('allows an admin to remove any declarant file in the org', async () => {
    mockDeclarantRepo.findOneBy.mockResolvedValue(makeDeclarant());
    const file = makeFile();
    mockFileRepo.findOne.mockResolvedValue(file);

    await service.remove(ORG_ID, DECLARANT_ID, FILE_ID, ADMIN_REQUESTER);

    expect(mockStorage.delete).toHaveBeenCalledWith(file.objectKey);
    expect(mockFileRepo.remove).toHaveBeenCalledWith(file);
  });
});
