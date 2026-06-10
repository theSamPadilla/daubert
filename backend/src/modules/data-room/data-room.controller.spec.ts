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

const mockService = {
  listFiles: jest.fn(),
  uploadFromStream: jest.fn(),
  getFileForDownload: jest.fn(),
  deleteFile: jest.fn(),
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
});
