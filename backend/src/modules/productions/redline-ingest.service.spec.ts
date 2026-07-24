// backend/src/modules/productions/redline-ingest.service.spec.ts

import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedlineIngestService } from './redline-ingest.service';
import { DataRoomService } from '../data-room/data-room.service';
import * as redlineExtract from './redline-extract';

jest.mock('./redline-extract', () => ({
  ...jest.requireActual('./redline-extract'),
  extractBaseText: jest.fn(),
}));

const mockDataRoom = {
  getFileForRedline: jest.fn(),
};

describe('RedlineIngestService', () => {
  let service: RedlineIngestService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        RedlineIngestService,
        { provide: DataRoomService, useValue: mockDataRoom },
      ],
    }).compile();

    service = module.get(RedlineIngestService);
  });

  describe('buildData', () => {
    it('fetches the file via DataRoomService, extracts text, and seeds RedlineData', async () => {
      const buffer = Buffer.from('docx bytes');
      const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      mockDataRoom.getFileForRedline.mockResolvedValue({
        name: 'contract.docx',
        mimeType,
        buffer,
      });
      (redlineExtract.extractBaseText as jest.Mock).mockResolvedValue({
        kind: 'docx',
        text: 'Hello world.',
      });

      const result = await service.buildData('case-1', 'file-1', 'user-1');

      expect(mockDataRoom.getFileForRedline).toHaveBeenCalledWith('case-1', 'file-1', 'user-1');
      expect(redlineExtract.extractBaseText).toHaveBeenCalledWith(buffer, mimeType);

      expect(result.schemaVersion).toBe(1);
      expect(result.source).toMatchObject({
        fileId: 'file-1',
        fileName: 'contract.docx',
        mimeType,
        kind: 'docx',
      });
      expect(typeof result.source.extractedAt).toBe('string');
      expect(result.baseText).toBe('Hello world.');
      expect(result.edits).toEqual([]);
      expect(result.comments).toEqual([]);
    });

    it('propagates errors from getFileForRedline (e.g. a file from another case)', async () => {
      mockDataRoom.getFileForRedline.mockRejectedValue(new NotFoundException('file_not_found'));

      await expect(service.buildData('case-1', 'bad-file', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(redlineExtract.extractBaseText).not.toHaveBeenCalled();
    });
  });
});
