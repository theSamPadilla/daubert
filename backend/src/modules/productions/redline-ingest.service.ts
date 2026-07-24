// backend/src/modules/productions/redline-ingest.service.ts

import { Injectable } from '@nestjs/common';
import { DataRoomService } from '../data-room/data-room.service';
import { extractBaseText } from './redline-extract';
import { RedlineData, seedRedlineData } from './redline-data';

/**
 * Builds the immutable RedlineData snapshot for a new redline production:
 * fetch the source file from the data room, extract its base text, and seed
 * the schema. Called once at production-creation time; the result becomes
 * the production's `data` column.
 */
@Injectable()
export class RedlineIngestService {
  constructor(private readonly dataRoom: DataRoomService) {}

  async buildData(
    caseId: string,
    sourceFileId: string,
    actorUserId: string,
  ): Promise<RedlineData> {
    const { name, mimeType, buffer } = await this.dataRoom.getFileForRedline(
      caseId,
      sourceFileId,
      actorUserId,
    );
    const { kind, text } = await extractBaseText(buffer, mimeType);
    return seedRedlineData(
      {
        fileId: sourceFileId,
        fileName: name,
        mimeType,
        kind,
        extractedAt: new Date().toISOString(),
      },
      text,
    );
  }
}
