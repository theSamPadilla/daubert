import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Readable } from 'stream';
import { CaseEntity } from '../../database/entities/case.entity';
import { DataRoomAccessLogEntity } from '../../database/entities/data-room-access-log.entity';
import { DataRoomFileEntity } from '../../database/entities/data-room-file.entity';
import { DataRoomService } from './data-room.service';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('DataRoomService', () => {
  let service: DataRoomService;
  let fileRepo: MockRepo;
  let logRepo: MockRepo;
  let caseRepo: MockRepo;
  let storage: MockStorage;

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
  // requireWriteAccess
  // ---------------------------------------------------------------------------
  describe('requireWriteAccess', () => {
    it('throws ForbiddenException for viewer', () => {
      expect(() => DataRoomService.requireWriteAccess('viewer')).toThrow(
        ForbiddenException,
      );
    });

    it('allows non-viewer roles', () => {
      expect(() => DataRoomService.requireWriteAccess('owner')).not.toThrow();
      expect(() => DataRoomService.requireWriteAccess('editor')).not.toThrow();
      expect(() => DataRoomService.requireWriteAccess(undefined)).not.toThrow();
    });
  });
});
