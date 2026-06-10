import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Readable } from 'stream';
import { CaseEntity } from '../../database/entities/case.entity';
import { DataRoomAccessLogEntity } from '../../database/entities/data-room-access-log.entity';
import { DataRoomFileEntity } from '../../database/entities/data-room-file.entity';
import { DataRoomService } from './data-room.service';
import { GoogleDriveImportService } from './google-drive-import.service';
import { STORAGE_PROVIDER } from './storage/storage-provider.interface';

interface MockRepo {
  find: jest.Mock;
  findOne: jest.Mock;
  findOneByOrFail: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
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
  let storage: MockStorage;
  let driveImport: MockDriveImport;

  function makeRepo(): MockRepo {
    return {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneByOrFail: jest.fn(),
      // `create` just constructs an entity instance — model it as identity.
      create: jest.fn((e) => e),
      save: jest.fn(),
      remove: jest.fn(),
    };
  }

  beforeEach(async () => {
    fileRepo = makeRepo();
    logRepo = makeRepo();
    caseRepo = makeRepo();
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

});
