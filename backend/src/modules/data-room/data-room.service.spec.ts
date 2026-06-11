import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { Readable } from 'stream';
import { CaseEntity } from '../../database/entities/case.entity';
import { DataRoomAccessLogEntity } from '../../database/entities/data-room-access-log.entity';
import { DataRoomFileEntity } from '../../database/entities/data-room-file.entity';
import { DataRoomFolderEntity } from '../../database/entities/data-room-folder.entity';
import { DataRoomService } from './data-room.service';
import { GoogleDriveImportService } from './google-drive-import.service';
import { STORAGE_PROVIDER } from './storage/storage-provider.interface';

interface MockRepo {
  find: jest.Mock;
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  findOneByOrFail: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
  delete: jest.Mock;
  count: jest.Mock;
}

interface MockStorage {
  upload: jest.Mock;
  download: jest.Mock;
  delete: jest.Mock;
}

interface MockDriveImport {
  fetchForImport: jest.Mock;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('DataRoomService', () => {
  let service: DataRoomService;
  let fileRepo: MockRepo;
  let logRepo: MockRepo;
  let caseRepo: MockRepo;
  let folderRepo: MockRepo;
  let storage: MockStorage;
  let driveImport: MockDriveImport;

  function makeRepo(): MockRepo {
    return {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      findOneByOrFail: jest.fn(),
      // `create` just constructs an entity instance — model it as identity.
      create: jest.fn((e) => e),
      save: jest.fn(),
      remove: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    };
  }

  beforeEach(async () => {
    fileRepo = makeRepo();
    logRepo = makeRepo();
    caseRepo = makeRepo();
    folderRepo = makeRepo();
    storage = {
      upload: jest.fn(),
      download: jest.fn(),
      delete: jest.fn(),
    };
    driveImport = { fetchForImport: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        DataRoomService,
        { provide: getRepositoryToken(DataRoomFileEntity), useValue: fileRepo },
        {
          provide: getRepositoryToken(DataRoomAccessLogEntity),
          useValue: logRepo,
        },
        { provide: getRepositoryToken(CaseEntity), useValue: caseRepo },
        {
          provide: getRepositoryToken(DataRoomFolderEntity),
          useValue: folderRepo,
        },
        { provide: STORAGE_PROVIDER, useValue: storage },
        { provide: GoogleDriveImportService, useValue: driveImport },
      ],
    }).compile();

    service = moduleRef.get<DataRoomService>(DataRoomService);
  });

  // ---------------------------------------------------------------------------
  // listFiles
  // ---------------------------------------------------------------------------
  describe('listFiles', () => {
    it('returns mapped DTOs ordered by createdAt DESC and does not log', async () => {
      const now = new Date('2026-01-01T00:00:00.000Z');
      fileRepo.find.mockResolvedValue([
        {
          id: 'f1',
          caseId: 'c1',
          name: 'a.pdf',
          mimeType: 'application/pdf',
          size: '11',
          objectKey: 'org/o1/case/c1/f1',
          uploadedByUserId: 'u1',
          createdAt: now,
        },
      ]);

      const result = await service.listFiles('c1');

      expect(fileRepo.find).toHaveBeenCalledWith({
        where: { caseId: 'c1' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual([
        {
          id: 'f1',
          name: 'a.pdf',
          mimeType: 'application/pdf',
          size: '11',
          uploadedByUserId: 'u1',
          createdAt: now,
        },
      ]);
      expect(logRepo.save).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // uploadFromStream
  // ---------------------------------------------------------------------------
  describe('uploadFromStream', () => {
    it('builds objectKey org/<orgId>/case/<caseId>/<uuid>, uploads, saves the row and logs upload', async () => {
      caseRepo.findOneByOrFail.mockResolvedValue({ id: 'c1', orgId: 'o1' });
      storage.upload.mockResolvedValue({ size: 11 });
      fileRepo.save.mockImplementation(async (e) => e);
      logRepo.save.mockImplementation(async (e) => e);

      const dto = await service.uploadFromStream(
        'c1',
        'u1',
        'a.pdf',
        'application/pdf',
        Readable.from('hello data'),
      );

      expect(caseRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'c1' });
      expect(storage.upload).toHaveBeenCalledWith(
        expect.stringMatching(/^org\/o1\/case\/c1\/[0-9a-f-]{36}$/),
        expect.anything(),
        'application/pdf',
      );

      // The saved file row carries the explicit id matching the objectKey suffix.
      const savedFile = fileRepo.save.mock.calls[0][0];
      expect(savedFile.id).toMatch(UUID_RE);
      expect(savedFile.objectKey).toBe(`org/o1/case/c1/${savedFile.id}`);
      expect(savedFile).toMatchObject({
        caseId: 'c1',
        name: 'a.pdf',
        mimeType: 'application/pdf',
        size: '11',
        uploadedByUserId: 'u1',
      });

      expect(logRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 'c1',
          userId: 'u1',
          fileId: savedFile.id,
          action: 'upload',
        }),
      );

      expect(dto).toEqual({
        id: savedFile.id,
        name: 'a.pdf',
        mimeType: 'application/pdf',
        size: '11',
        uploadedByUserId: 'u1',
        createdAt: savedFile.createdAt,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getFileForDownload
  // ---------------------------------------------------------------------------
  describe('getFileForDownload', () => {
    it('throws NotFoundException when no row matches {id, caseId}', async () => {
      fileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getFileForDownload('c1', 'u1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.download).not.toHaveBeenCalled();
    });

    it('downloads via storage, logs download and returns metadata', async () => {
      const stream = Readable.from('bytes');
      fileRepo.findOne.mockResolvedValue({
        id: 'f1',
        caseId: 'c1',
        name: 'a.pdf',
        mimeType: 'application/pdf',
        size: '11',
        objectKey: 'org/o1/case/c1/f1',
      });
      storage.download.mockResolvedValue({ stream, size: 11 });
      logRepo.save.mockImplementation(async (e) => e);

      const result = await service.getFileForDownload('c1', 'u1', 'f1');

      expect(fileRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'f1', caseId: 'c1' },
      });
      expect(storage.download).toHaveBeenCalledWith('org/o1/case/c1/f1');
      expect(logRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 'c1',
          userId: 'u1',
          fileId: 'f1',
          action: 'download',
        }),
      );
      expect(result).toEqual({
        stream,
        name: 'a.pdf',
        mimeType: 'application/pdf',
        size: 11,
      });
    });

    it('treats a row from a different case as not found (cross-case isolation)', async () => {
      // The {id, caseId} where-clause means a mismatched caseId yields no row.
      fileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getFileForDownload('other-case', 'u1', 'f1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fileRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'f1', caseId: 'other-case' },
      });
      expect(storage.download).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // deleteFile
  // ---------------------------------------------------------------------------
  describe('deleteFile', () => {
    it('throws NotFoundException when no row matches {id, caseId}', async () => {
      fileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteFile('c1', 'u1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.delete).not.toHaveBeenCalled();
      expect(fileRepo.remove).not.toHaveBeenCalled();
    });

    it('deletes the object, removes the row and logs delete', async () => {
      const row = {
        id: 'f1',
        caseId: 'c1',
        objectKey: 'org/o1/case/c1/f1',
      };
      fileRepo.findOne.mockResolvedValue(row);
      storage.delete.mockResolvedValue(undefined);
      fileRepo.remove.mockResolvedValue(row);
      logRepo.save.mockImplementation(async (e) => e);

      await service.deleteFile('c1', 'u1', 'f1');

      expect(fileRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'f1', caseId: 'c1' },
      });
      expect(storage.delete).toHaveBeenCalledWith('org/o1/case/c1/f1');
      expect(fileRepo.remove).toHaveBeenCalledWith(row);
      expect(logRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 'c1',
          userId: 'u1',
          fileId: 'f1',
          action: 'delete',
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // importFromDrive
  // ---------------------------------------------------------------------------
  describe('importFromDrive', () => {
    it('imports every fileId by streaming through uploadFromStream; failed is empty', async () => {
      caseRepo.findOneByOrFail.mockResolvedValue({ id: 'c1', orgId: 'o1' });
      storage.upload.mockResolvedValue({ size: 7 });
      fileRepo.save.mockImplementation(async (e) => e);
      logRepo.save.mockImplementation(async (e) => e);
      driveImport.fetchForImport.mockImplementation(async (_token, fileId) => ({
        name: `${fileId}.pdf`,
        mimeType: 'application/pdf',
        stream: Readable.from('x'),
      }));

      const result = await service.importFromDrive('c1', 'u1', 'tok', [
        'g1',
        'g2',
      ]);

      // Both Drive files were fetched with the provided access token.
      expect(driveImport.fetchForImport).toHaveBeenCalledTimes(2);
      expect(driveImport.fetchForImport).toHaveBeenNthCalledWith(1, 'tok', 'g1');
      expect(driveImport.fetchForImport).toHaveBeenNthCalledWith(2, 'tok', 'g2');

      // Each import went through the real uploadFromStream path: a storage
      // upload, a data_room_files save, and an `upload` access-log save.
      expect(storage.upload).toHaveBeenCalledTimes(2);
      expect(fileRepo.save).toHaveBeenCalledTimes(2);
      expect(logRepo.save).toHaveBeenCalledTimes(2);
      expect(logRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: 'c1', userId: 'u1', action: 'upload' }),
      );

      expect(result.failed).toEqual([]);
      expect(result.imported).toHaveLength(2);
      expect(result.imported.map((f) => f.name)).toEqual(['g1.pdf', 'g2.pdf']);
      result.imported.forEach((f) => {
        expect(f.mimeType).toBe('application/pdf');
        expect(f.size).toBe('7');
        expect(f.uploadedByUserId).toBe('u1');
        expect(f.id).toMatch(UUID_RE);
      });
    });

    it('isolates failures: a rejecting fetchForImport lands in failed while the others still import', async () => {
      caseRepo.findOneByOrFail.mockResolvedValue({ id: 'c1', orgId: 'o1' });
      storage.upload.mockResolvedValue({ size: 7 });
      fileRepo.save.mockImplementation(async (e) => e);
      logRepo.save.mockImplementation(async (e) => e);
      driveImport.fetchForImport.mockImplementation(async (_token, fileId) => {
        if (fileId === 'bad') {
          throw new Error('Unsupported Google file type: x');
        }
        return {
          name: `${fileId}.pdf`,
          mimeType: 'application/pdf',
          stream: Readable.from('x'),
        };
      });

      const result = await service.importFromDrive('c1', 'u1', 'tok', [
        'g1',
        'bad',
        'g2',
      ]);

      // Only the two good ids were uploaded/saved/logged.
      expect(storage.upload).toHaveBeenCalledTimes(2);
      expect(fileRepo.save).toHaveBeenCalledTimes(2);
      expect(logRepo.save).toHaveBeenCalledTimes(2);

      expect(result.imported).toHaveLength(2);
      expect(result.imported.map((f) => f.name)).toEqual(['g1.pdf', 'g2.pdf']);
      expect(result.failed).toEqual([
        { fileId: 'bad', error: 'Unsupported Google file type: x' },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // createFolder
  // ---------------------------------------------------------------------------
  describe('createFolder', () => {
    it('saves a folder row with caseId, parentFolderId and createdByUserId, returns DTO', async () => {
      const createdAt = new Date('2026-02-01T00:00:00.000Z');
      // parent exists in this case
      folderRepo.findOneBy.mockResolvedValue({ id: 'parent-1', caseId: 'c1' });
      folderRepo.save.mockImplementation(async (e) => ({
        ...e,
        id: 'new-folder',
        createdAt,
      }));

      const dto = await service.createFolder('c1', 'u1', 'Evidence', 'parent-1');

      expect(folderRepo.findOneBy).toHaveBeenCalledWith({
        id: 'parent-1',
        caseId: 'c1',
      });
      const saved = folderRepo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        caseId: 'c1',
        parentFolderId: 'parent-1',
        name: 'Evidence',
        createdByUserId: 'u1',
      });
      expect(dto).toEqual({
        id: 'new-folder',
        caseId: 'c1',
        parentFolderId: 'parent-1',
        name: 'Evidence',
        createdByUserId: 'u1',
        createdAt,
      });
    });

    it('saves at root when parentFolderId is null without a parent lookup', async () => {
      const createdAt = new Date('2026-02-01T00:00:00.000Z');
      folderRepo.save.mockImplementation(async (e) => ({
        ...e,
        id: 'root-folder',
        createdAt,
      }));

      const dto = await service.createFolder('c1', 'u1', 'Top', null);

      expect(folderRepo.findOneBy).not.toHaveBeenCalled();
      expect(folderRepo.save.mock.calls[0][0]).toMatchObject({
        caseId: 'c1',
        parentFolderId: null,
        name: 'Top',
        createdByUserId: 'u1',
      });
      expect(dto.parentFolderId).toBeNull();
    });

    it('rejects when the parent folder is in another case (findOneBy null -> NotFound)', async () => {
      folderRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.createFolder('c1', 'u1', 'X', 'other-case-folder'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(folderRepo.save).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // listContents
  // ---------------------------------------------------------------------------
  describe('listContents', () => {
    it('at root: queries with IsNull parent/folder and returns folders + files, empty breadcrumb', async () => {
      const now = new Date('2026-01-01T00:00:00.000Z');
      folderRepo.find.mockResolvedValue([
        {
          id: 'fol1',
          caseId: 'c1',
          parentFolderId: null,
          name: 'A',
          createdByUserId: 'u1',
          createdAt: now,
        },
      ]);
      fileRepo.find.mockResolvedValue([
        {
          id: 'f1',
          caseId: 'c1',
          name: 'a.pdf',
          mimeType: 'application/pdf',
          size: '11',
          objectKey: 'org/o1/case/c1/f1',
          uploadedByUserId: 'u1',
          folderId: null,
          createdAt: now,
        },
      ]);

      const result = await service.listContents('c1', null);

      expect(folderRepo.find).toHaveBeenCalledWith({
        where: { caseId: 'c1', parentFolderId: IsNull() },
        order: { name: 'ASC' },
      });
      expect(fileRepo.find).toHaveBeenCalledWith({
        where: { caseId: 'c1', folderId: IsNull() },
        order: { createdAt: 'DESC' },
      });
      expect(result.breadcrumb).toEqual([]);
      expect(result.folders).toEqual([
        {
          id: 'fol1',
          caseId: 'c1',
          parentFolderId: null,
          name: 'A',
          createdByUserId: 'u1',
          createdAt: now,
        },
      ]);
      expect(result.files).toEqual([
        {
          id: 'f1',
          name: 'a.pdf',
          mimeType: 'application/pdf',
          size: '11',
          uploadedByUserId: 'u1',
          createdAt: now,
        },
      ]);
    });

    it('when nested: builds breadcrumb oldest-ancestor-first by walking parentFolderId', async () => {
      const now = new Date('2026-01-01T00:00:00.000Z');
      folderRepo.find.mockResolvedValue([]);
      fileRepo.find.mockResolvedValue([]);
      // current folder 'child' -> parent 'mid' -> root 'top' (parent null)
      folderRepo.findOneBy.mockImplementation(async ({ id }) => {
        const map: Record<string, any> = {
          child: { id: 'child', caseId: 'c1', parentFolderId: 'mid', name: 'Child' },
          mid: { id: 'mid', caseId: 'c1', parentFolderId: 'top', name: 'Mid' },
          top: { id: 'top', caseId: 'c1', parentFolderId: null, name: 'Top' },
        };
        return map[id] ?? null;
      });

      const result = await service.listContents('c1', 'child');

      expect(folderRepo.find).toHaveBeenCalledWith({
        where: { caseId: 'c1', parentFolderId: 'child' },
        order: { name: 'ASC' },
      });
      expect(fileRepo.find).toHaveBeenCalledWith({
        where: { caseId: 'c1', folderId: 'child' },
        order: { createdAt: 'DESC' },
      });
      expect(result.breadcrumb).toEqual([
        { id: 'top', name: 'Top' },
        { id: 'mid', name: 'Mid' },
        { id: 'child', name: 'Child' },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // moveFile
  // ---------------------------------------------------------------------------
  describe('moveFile', () => {
    it('sets folderId on the file and saves', async () => {
      const row = { id: 'f1', caseId: 'c1', folderId: null };
      fileRepo.findOne.mockResolvedValue(row);
      folderRepo.findOneBy.mockResolvedValue({ id: 'fol1', caseId: 'c1' });
      fileRepo.save.mockImplementation(async (e) => e);

      await service.moveFile('c1', 'u1', 'f1', 'fol1');

      expect(fileRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'f1', caseId: 'c1' },
      });
      expect(folderRepo.findOneBy).toHaveBeenCalledWith({
        id: 'fol1',
        caseId: 'c1',
      });
      const saved = fileRepo.save.mock.calls[0][0];
      expect(saved.folderId).toBe('fol1');
    });

    it('moves to root when targetFolderId is null', async () => {
      const row = { id: 'f1', caseId: 'c1', folderId: 'fol1' };
      fileRepo.findOne.mockResolvedValue(row);
      fileRepo.save.mockImplementation(async (e) => e);

      await service.moveFile('c1', 'u1', 'f1', null);

      expect(folderRepo.findOneBy).not.toHaveBeenCalled();
      expect(fileRepo.save.mock.calls[0][0].folderId).toBeNull();
    });

    it('throws NotFound when the file does not match {id, caseId}', async () => {
      fileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.moveFile('c1', 'u1', 'missing', 'fol1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fileRepo.save).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // moveFolder
  // ---------------------------------------------------------------------------
  describe('moveFolder', () => {
    it('rejects moving a folder into one of its descendants', async () => {
      // moving 'src' into 'deep'; deep -> mid -> src, so the ancestor walk hits src.
      folderRepo.findOne.mockResolvedValue({
        id: 'src',
        caseId: 'c1',
        parentFolderId: null,
      });
      folderRepo.findOneBy.mockImplementation(async ({ id }) => {
        const map: Record<string, any> = {
          deep: { id: 'deep', caseId: 'c1', parentFolderId: 'mid' },
          mid: { id: 'mid', caseId: 'c1', parentFolderId: 'src' },
          src: { id: 'src', caseId: 'c1', parentFolderId: null },
        };
        return map[id] ?? null;
      });

      await expect(
        service.moveFolder('c1', 'u1', 'src', 'deep'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(folderRepo.save).not.toHaveBeenCalled();
    });

    it('rejects moving a folder into itself', async () => {
      folderRepo.findOne.mockResolvedValue({
        id: 'src',
        caseId: 'c1',
        parentFolderId: null,
      });

      await expect(
        service.moveFolder('c1', 'u1', 'src', 'src'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(folderRepo.save).not.toHaveBeenCalled();
    });

    it('sets parentFolderId and saves for a valid move', async () => {
      const folder = { id: 'src', caseId: 'c1', parentFolderId: null };
      folderRepo.findOne.mockResolvedValue(folder);
      // ancestor walk from target 'dst' -> root (no cycle), then existence check.
      folderRepo.findOneBy.mockImplementation(async ({ id }) => {
        const map: Record<string, any> = {
          dst: { id: 'dst', caseId: 'c1', parentFolderId: null },
        };
        return map[id] ?? null;
      });
      folderRepo.save.mockImplementation(async (e) => e);

      await service.moveFolder('c1', 'u1', 'src', 'dst');

      expect(folderRepo.save.mock.calls[0][0].parentFolderId).toBe('dst');
    });

    it('throws NotFound when the folder does not match {id, caseId}', async () => {
      folderRepo.findOne.mockResolvedValue(null);

      await expect(
        service.moveFolder('c1', 'u1', 'missing', 'dst'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteFolder
  // ---------------------------------------------------------------------------
  describe('deleteFolder', () => {
    it('cascade-deletes: a folder with one subfolder containing one file', async () => {
      // top -> sub; file lives in sub.
      folderRepo.findOne.mockResolvedValue({
        id: 'top',
        caseId: 'c1',
        parentFolderId: null,
      });
      // BFS: children of 'top' = [sub]; children of 'sub' = [].
      folderRepo.find.mockImplementation(async ({ where }) => {
        if (where.parentFolderId === 'top') {
          return [{ id: 'sub', caseId: 'c1', parentFolderId: 'top' }];
        }
        return [];
      });
      const fileRow = {
        id: 'f1',
        caseId: 'c1',
        objectKey: 'org/o1/case/c1/f1',
        folderId: 'sub',
      };
      fileRepo.find.mockResolvedValue([fileRow]);
      fileRepo.delete.mockResolvedValue({ affected: 1 });
      storage.delete.mockResolvedValue(undefined);
      logRepo.save.mockImplementation(async (e) => e);
      folderRepo.delete.mockResolvedValue({ affected: 2 });

      await service.deleteFolder('c1', 'u1', 'top');

      // Audit rows are batch-saved BEFORE any deletion.
      expect(logRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            caseId: 'c1',
            userId: 'u1',
            fileId: 'f1',
            action: 'delete',
          }),
        ]),
      );

      // File rows are bulk-deleted by id, not via remove().
      expect(fileRepo.delete).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.anything() }),
      );
      expect(fileRepo.remove).not.toHaveBeenCalled();

      // Folder rows are bulk-deleted for the whole subtree.
      expect(folderRepo.delete).toHaveBeenCalled();
      const folderDelArg = folderRepo.delete.mock.calls[0][0];
      expect(folderDelArg.id._value ?? folderDelArg.id._type).toBeDefined();

      // Storage cleanup happens after DB work.
      expect(storage.delete).toHaveBeenCalledWith('org/o1/case/c1/f1');

      // files queried over the full subtree (top + sub)
      const fileFindArg = fileRepo.find.mock.calls[0][0];
      expect(fileFindArg.where.caseId).toBe('c1');
    });

    it('logs then deletes file rows before folder rows (DB-atomic ordering)', async () => {
      folderRepo.findOne.mockResolvedValue({ id: 'f1', caseId: 'c1', parentFolderId: null });
      folderRepo.find.mockResolvedValue([]);
      const fileRow = { id: 'file1', caseId: 'c1', objectKey: 'org/o1/case/c1/file1', folderId: 'f1' };
      fileRepo.find.mockResolvedValue([fileRow]);
      fileRepo.delete.mockResolvedValue({ affected: 1 });
      folderRepo.delete.mockResolvedValue({ affected: 1 });
      storage.delete.mockResolvedValue(undefined);

      const callOrder: string[] = [];
      logRepo.save.mockImplementation(async (e) => { callOrder.push('log'); return e; });
      fileRepo.delete.mockImplementation(async () => { callOrder.push('fileDelete'); return { affected: 1 }; });
      folderRepo.delete.mockImplementation(async () => { callOrder.push('folderDelete'); return { affected: 1 }; });
      storage.delete.mockImplementation(async () => { callOrder.push('storageDelete'); });

      await service.deleteFolder('c1', 'u1', 'f1');

      expect(callOrder).toEqual(['log', 'fileDelete', 'folderDelete', 'storageDelete']);
    });

    it('throws NotFound when the folder does not match {id, caseId}', async () => {
      folderRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteFolder('c1', 'u1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fileRepo.remove).not.toHaveBeenCalled();
      expect(fileRepo.delete).not.toHaveBeenCalled();
    });

    it('skips log and file delete when folder has no files, but still deletes folder rows', async () => {
      folderRepo.findOne.mockResolvedValue({ id: 'empty', caseId: 'c1', parentFolderId: null });
      folderRepo.find.mockResolvedValue([]);
      fileRepo.find.mockResolvedValue([]);
      folderRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteFolder('c1', 'u1', 'empty');

      expect(logRepo.save).not.toHaveBeenCalled();
      expect(fileRepo.delete).not.toHaveBeenCalled();
      expect(folderRepo.delete).toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getManifest
  // ---------------------------------------------------------------------------
  describe('getManifest', () => {
    it('resolves folder paths and respects the limit/truncation', async () => {
      folderRepo.find.mockResolvedValue([
        { id: 'f1', caseId: 'c1', parentFolderId: null, name: 'Bank Statements' },
        { id: 'f2', caseId: 'c1', parentFolderId: 'f1', name: '2024' },
      ]);
      fileRepo.find.mockResolvedValue([
        { id: 'a', caseId: 'c1', name: 'stmt.pdf', mimeType: 'application/pdf', size: '10', folderId: 'f2' },
        { id: 'b', caseId: 'c1', name: 'root.csv', mimeType: 'text/csv', size: '20', folderId: null },
      ]);
      fileRepo.count.mockResolvedValue(2);

      const res = await service.getManifest('c1', 25);

      expect(res.total).toBe(2);
      expect(res.truncated).toBe(false);
      expect(res.files).toEqual([
        { id: 'a', name: 'stmt.pdf', mimeType: 'application/pdf', size: 10, folder: '/Bank Statements/2024' },
        { id: 'b', name: 'root.csv', mimeType: 'text/csv', size: 20, folder: '/' },
      ]);
      expect(fileRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { caseId: 'c1' }, order: { createdAt: 'DESC' }, take: 25 }),
      );
    });

    it('flags truncated when total exceeds the limit', async () => {
      folderRepo.find.mockResolvedValue([]);
      fileRepo.find.mockResolvedValue([{ id: 'a', caseId: 'c1', name: 'x', mimeType: 'text/plain', size: '1', folderId: null }]);
      fileRepo.count.mockResolvedValue(40);
      const res = await service.getManifest('c1', 1);
      expect(res.truncated).toBe(true);
      expect(res.total).toBe(40);
    });
  });

  // ---------------------------------------------------------------------------
  // getFileForAgentRead
  // ---------------------------------------------------------------------------
  describe('getFileForAgentRead', () => {
    const fileRow = { id: 'a', caseId: 'c1', name: 'doc.pdf', mimeType: 'application/pdf', size: '100', objectKey: 'org/o/case/c1/a' };

    it('streams the object and writes an agent_read audit row', async () => {
      fileRepo.findOne.mockResolvedValue(fileRow);
      storage.download.mockResolvedValue({ stream: Readable.from(['x']) });
      const res = await service.getFileForAgentRead('c1', 'u1', 'a', 5 * 1024 * 1024);
      expect(res).toMatchObject({ name: 'doc.pdf', mimeType: 'application/pdf', size: 100, tooLarge: false });
      expect(storage.download).toHaveBeenCalledWith('org/o/case/c1/a');
      expect(logRepo.save).toHaveBeenCalled();
      expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'agent_read', fileId: 'a', caseId: 'c1', userId: 'u1' }));
    });

    it('throws NotFound for a file from another case', async () => {
      fileRepo.findOne.mockResolvedValue(null);
      await expect(service.getFileForAgentRead('c1', 'u1', 'a', 5 * 1024 * 1024)).rejects.toThrow(NotFoundException);
    });

    it('returns tooLarge without downloading or logging when size exceeds the cap', async () => {
      fileRepo.findOne.mockResolvedValue({ ...fileRow, size: String(99 * 1024 * 1024) });
      const res = await service.getFileForAgentRead('c1', 'u1', 'a', 5 * 1024 * 1024);
      expect(res.tooLarge).toBe(true);
      expect(res.stream).toBeUndefined();
      expect(storage.download).not.toHaveBeenCalled();
      expect(logRepo.save).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // uploadFromStream with folderId
  // ---------------------------------------------------------------------------
  describe('uploadFromStream with folderId', () => {
    it('persists the file with the given folderId after asserting the folder exists', async () => {
      caseRepo.findOneByOrFail.mockResolvedValue({ id: 'c1', orgId: 'o1' });
      folderRepo.findOneBy.mockResolvedValue({ id: 'folder-1', caseId: 'c1' });
      storage.upload.mockResolvedValue({ size: 11 });
      fileRepo.save.mockImplementation(async (e) => e);
      logRepo.save.mockImplementation(async (e) => e);

      await service.uploadFromStream(
        'c1',
        'u1',
        'a.pdf',
        'application/pdf',
        Readable.from('hello data'),
        'folder-1',
      );

      expect(folderRepo.findOneBy).toHaveBeenCalledWith({
        id: 'folder-1',
        caseId: 'c1',
      });
      expect(fileRepo.save.mock.calls[0][0].folderId).toBe('folder-1');
    });

    it('defaults folderId to null when omitted (root)', async () => {
      caseRepo.findOneByOrFail.mockResolvedValue({ id: 'c1', orgId: 'o1' });
      storage.upload.mockResolvedValue({ size: 11 });
      fileRepo.save.mockImplementation(async (e) => e);
      logRepo.save.mockImplementation(async (e) => e);

      await service.uploadFromStream(
        'c1',
        'u1',
        'a.pdf',
        'application/pdf',
        Readable.from('hello data'),
      );

      expect(folderRepo.findOneBy).not.toHaveBeenCalled();
      expect(fileRepo.save.mock.calls[0][0].folderId).toBeNull();
    });
  });

});
