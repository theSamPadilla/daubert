import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import { DataRoomController } from './data-room.controller';
import { DataRoomService } from './data-room.service';
import { REQUIRED_ROLE_KEY } from '../auth/require-role.decorator';
import { RoleGuard } from '../auth/role.guard';

const MOCK_CASE_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const MOCK_FILE_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const MOCK_USER_ID = 'cccccccc-0000-0000-0000-000000000003';
const MOCK_FOLDER_ID = 'dddddddd-0000-0000-0000-000000000004';

const mockService = {
  listFiles: jest.fn(),
  uploadFromStream: jest.fn(),
  getFileForDownload: jest.fn(),
  deleteFile: jest.fn(),
  importFromDrive: jest.fn(),
  listContents: jest.fn(),
  createFolder: jest.fn(),
  deleteFolder: jest.fn(),
  moveFile: jest.fn(),
  moveFolder: jest.fn(),
};

describe('DataRoomController', () => {
  let controller: DataRoomController;
  let reflector: Reflector;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataRoomController],
      providers: [
        { provide: DataRoomService, useValue: mockService },
        Reflector,
      ],
    })
      .overrideGuard(RoleGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(DataRoomController);
    reflector = module.get(Reflector);
  });

  // ----------------------------------------------------------------
  // Role metadata
  // ----------------------------------------------------------------

  describe('role metadata', () => {
    it('GET files requires viewer', () => {
      const role = Reflect.getMetadata(
        REQUIRED_ROLE_KEY,
        controller.listFiles,
      );
      expect(role).toBe('viewer');
    });

    it('POST files requires editor', () => {
      const role = Reflect.getMetadata(
        REQUIRED_ROLE_KEY,
        controller.upload,
      );
      expect(role).toBe('editor');
    });

    it('GET download requires viewer', () => {
      const role = Reflect.getMetadata(
        REQUIRED_ROLE_KEY,
        controller.download,
      );
      expect(role).toBe('viewer');
    });

    it('DELETE file requires editor', () => {
      const role = Reflect.getMetadata(
        REQUIRED_ROLE_KEY,
        controller.deleteFile,
      );
      expect(role).toBe('editor');
    });

    it('POST import/google-drive requires editor', () => {
      const role = Reflect.getMetadata(
        REQUIRED_ROLE_KEY,
        controller.importFromDrive,
      );
      expect(role).toBe('editor');
    });

    it('GET contents requires viewer', () => {
      const role = Reflect.getMetadata(
        REQUIRED_ROLE_KEY,
        controller.listContents,
      );
      expect(role).toBe('viewer');
    });

    it('POST folders requires editor', () => {
      const role = Reflect.getMetadata(
        REQUIRED_ROLE_KEY,
        controller.createFolder,
      );
      expect(role).toBe('editor');
    });

    it('DELETE folder requires editor', () => {
      const role = Reflect.getMetadata(
        REQUIRED_ROLE_KEY,
        controller.deleteFolder,
      );
      expect(role).toBe('editor');
    });

    it('PATCH file move requires editor', () => {
      const role = Reflect.getMetadata(
        REQUIRED_ROLE_KEY,
        controller.moveFile,
      );
      expect(role).toBe('editor');
    });

    it('PATCH folder move requires editor', () => {
      const role = Reflect.getMetadata(
        REQUIRED_ROLE_KEY,
        controller.moveFolder,
      );
      expect(role).toBe('editor');
    });
  });

  // ----------------------------------------------------------------
  // listFiles
  // ----------------------------------------------------------------

  describe('listFiles', () => {
    it('calls service.listFiles with caseId and returns the result', async () => {
      const files = [{ id: MOCK_FILE_ID, name: 'doc.pdf' }];
      mockService.listFiles.mockResolvedValueOnce(files);

      const result = await controller.listFiles(MOCK_CASE_ID);

      expect(mockService.listFiles).toHaveBeenCalledWith(MOCK_CASE_ID);
      expect(result).toBe(files);
    });
  });

  // ----------------------------------------------------------------
  // download
  // ----------------------------------------------------------------

  describe('download', () => {
    it('calls service.getFileForDownload and returns a StreamableFile', async () => {
      const stream = Readable.from(['hello']);
      mockService.getFileForDownload.mockResolvedValueOnce({
        stream,
        name: 'test.txt',
        mimeType: 'text/plain',
        size: 5,
      });

      const mockReq: any = { user: { id: MOCK_USER_ID } };
      const mockRes: any = { setHeader: jest.fn(), headersSent: false };
      const result = await controller.download(
        MOCK_CASE_ID,
        MOCK_FILE_ID,
        mockReq,
        mockRes,
      );

      expect(mockService.getFileForDownload).toHaveBeenCalledWith(
        MOCK_CASE_ID,
        MOCK_USER_ID,
        MOCK_FILE_ID,
      );
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('sets Content-Length when size is present', async () => {
      const stream = Readable.from(['hello']);
      mockService.getFileForDownload.mockResolvedValueOnce({
        stream,
        name: 'test.txt',
        mimeType: 'text/plain',
        size: 5,
      });

      const mockReq: any = { user: { id: MOCK_USER_ID } };
      const mockRes: any = { setHeader: jest.fn(), headersSent: false };
      await controller.download(MOCK_CASE_ID, MOCK_FILE_ID, mockReq, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Length', 5);
    });
  });

  // ----------------------------------------------------------------
  // deleteFile
  // ----------------------------------------------------------------

  describe('deleteFile', () => {
    it('calls service.deleteFile with caseId, userId, fileId', async () => {
      mockService.deleteFile.mockResolvedValueOnce(undefined);

      await controller.deleteFile(
        MOCK_CASE_ID,
        MOCK_FILE_ID,
        { user: { id: MOCK_USER_ID } } as any,
      );

      expect(mockService.deleteFile).toHaveBeenCalledWith(
        MOCK_CASE_ID,
        MOCK_USER_ID,
        MOCK_FILE_ID,
      );
    });
  });

  // ----------------------------------------------------------------
  // importFromDrive
  // ----------------------------------------------------------------

  describe('importFromDrive', () => {
    it('delegates to service.importFromDrive and returns the result', async () => {
      const mockResult = { imported: [{ id: MOCK_FILE_ID, name: 'doc.pdf' }], failed: [] };
      mockService.importFromDrive.mockResolvedValueOnce(mockResult);

      const dto = { accessToken: 't', fileIds: ['a', 'b'] };
      const req: any = { user: { id: 'u1' } };
      const result = await controller.importFromDrive(MOCK_CASE_ID, dto as any, req);

      expect(mockService.importFromDrive).toHaveBeenCalledWith(
        MOCK_CASE_ID,
        'u1',
        't',
        ['a', 'b'],
        null,
      );
      expect(result).toBe(mockResult);
    });

    it('passes folderId to service.importFromDrive when provided', async () => {
      const mockResult = { imported: [], failed: [] };
      mockService.importFromDrive.mockResolvedValueOnce(mockResult);

      const dto = { accessToken: 't', fileIds: ['a'], folderId: MOCK_FOLDER_ID };
      const req: any = { user: { id: 'u1' } };
      await controller.importFromDrive(MOCK_CASE_ID, dto as any, req);

      expect(mockService.importFromDrive).toHaveBeenCalledWith(
        MOCK_CASE_ID,
        'u1',
        't',
        ['a'],
        MOCK_FOLDER_ID,
      );
    });
  });

  // ----------------------------------------------------------------
  // listContents
  // ----------------------------------------------------------------

  describe('listContents', () => {
    it('requires viewer role', () => {
      const role = Reflect.getMetadata(REQUIRED_ROLE_KEY, controller.listContents);
      expect(role).toBe('viewer');
    });

    it('calls service.listContents with caseId and null when no folderId', async () => {
      const contents = { folders: [], files: [] };
      mockService.listContents.mockResolvedValueOnce(contents);

      const result = await controller.listContents(MOCK_CASE_ID, undefined);

      expect(mockService.listContents).toHaveBeenCalledWith(MOCK_CASE_ID, null);
      expect(result).toBe(contents);
    });

    it('calls service.listContents with folderId when provided', async () => {
      const contents = { folders: [], files: [] };
      mockService.listContents.mockResolvedValueOnce(contents);

      const result = await controller.listContents(MOCK_CASE_ID, MOCK_FOLDER_ID);

      expect(mockService.listContents).toHaveBeenCalledWith(MOCK_CASE_ID, MOCK_FOLDER_ID);
      expect(result).toBe(contents);
    });
  });

  // ----------------------------------------------------------------
  // createFolder
  // ----------------------------------------------------------------

  describe('createFolder', () => {
    it('calls service.createFolder with caseId, userId, name, null parentFolderId', async () => {
      const folder = { id: MOCK_FOLDER_ID, name: 'Evidence' };
      mockService.createFolder.mockResolvedValueOnce(folder);

      const dto = { name: 'Evidence' };
      const req: any = { user: { id: MOCK_USER_ID } };
      const result = await controller.createFolder(MOCK_CASE_ID, dto as any, req);

      expect(mockService.createFolder).toHaveBeenCalledWith(
        MOCK_CASE_ID,
        MOCK_USER_ID,
        'Evidence',
        null,
      );
      expect(result).toBe(folder);
    });

    it('passes parentFolderId when provided', async () => {
      const folder = { id: MOCK_FOLDER_ID, name: 'Sub' };
      mockService.createFolder.mockResolvedValueOnce(folder);

      const dto = { name: 'Sub', parentFolderId: MOCK_FOLDER_ID };
      const req: any = { user: { id: MOCK_USER_ID } };
      await controller.createFolder(MOCK_CASE_ID, dto as any, req);

      expect(mockService.createFolder).toHaveBeenCalledWith(
        MOCK_CASE_ID,
        MOCK_USER_ID,
        'Sub',
        MOCK_FOLDER_ID,
      );
    });
  });

  // ----------------------------------------------------------------
  // deleteFolder
  // ----------------------------------------------------------------

  describe('deleteFolder', () => {
    it('calls service.deleteFolder with caseId, userId, folderId', async () => {
      mockService.deleteFolder.mockResolvedValueOnce(undefined);

      await controller.deleteFolder(
        MOCK_CASE_ID,
        MOCK_FOLDER_ID,
        { user: { id: MOCK_USER_ID } } as any,
      );

      expect(mockService.deleteFolder).toHaveBeenCalledWith(
        MOCK_CASE_ID,
        MOCK_USER_ID,
        MOCK_FOLDER_ID,
      );
    });
  });

  // ----------------------------------------------------------------
  // moveFile
  // ----------------------------------------------------------------

  describe('moveFile', () => {
    it('calls service.moveFile with caseId, userId, fileId, targetFolderId', async () => {
      mockService.moveFile.mockResolvedValueOnce(undefined);

      const dto = { targetFolderId: MOCK_FOLDER_ID };
      await controller.moveFile(
        MOCK_CASE_ID,
        MOCK_FILE_ID,
        dto as any,
        { user: { id: MOCK_USER_ID } } as any,
      );

      expect(mockService.moveFile).toHaveBeenCalledWith(
        MOCK_CASE_ID,
        MOCK_USER_ID,
        MOCK_FILE_ID,
        MOCK_FOLDER_ID,
      );
    });

    it('passes null targetFolderId to move file to root', async () => {
      mockService.moveFile.mockResolvedValueOnce(undefined);

      const dto = { targetFolderId: null };
      await controller.moveFile(
        MOCK_CASE_ID,
        MOCK_FILE_ID,
        dto as any,
        { user: { id: MOCK_USER_ID } } as any,
      );

      expect(mockService.moveFile).toHaveBeenCalledWith(
        MOCK_CASE_ID,
        MOCK_USER_ID,
        MOCK_FILE_ID,
        null,
      );
    });
  });

  // ----------------------------------------------------------------
  // moveFolder
  // ----------------------------------------------------------------

  describe('moveFolder', () => {
    it('calls service.moveFolder with caseId, userId, folderId, targetFolderId', async () => {
      mockService.moveFolder.mockResolvedValueOnce(undefined);

      const TARGET_FOLDER_ID = 'eeeeeeee-0000-0000-0000-000000000005';
      const dto = { targetFolderId: TARGET_FOLDER_ID };
      await controller.moveFolder(
        MOCK_CASE_ID,
        MOCK_FOLDER_ID,
        dto as any,
        { user: { id: MOCK_USER_ID } } as any,
      );

      expect(mockService.moveFolder).toHaveBeenCalledWith(
        MOCK_CASE_ID,
        MOCK_USER_ID,
        MOCK_FOLDER_ID,
        TARGET_FOLDER_ID,
      );
    });

    it('passes null targetFolderId to move folder to root', async () => {
      mockService.moveFolder.mockResolvedValueOnce(undefined);

      const dto = { targetFolderId: null };
      await controller.moveFolder(
        MOCK_CASE_ID,
        MOCK_FOLDER_ID,
        dto as any,
        { user: { id: MOCK_USER_ID } } as any,
      );

      expect(mockService.moveFolder).toHaveBeenCalledWith(
        MOCK_CASE_ID,
        MOCK_USER_ID,
        MOCK_FOLDER_ID,
        null,
      );
    });
  });
});
