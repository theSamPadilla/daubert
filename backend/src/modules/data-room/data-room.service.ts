import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import { CaseEntity } from '../../database/entities/case.entity';
import {
  DataRoomAccessLogEntity,
  DataRoomAction,
} from '../../database/entities/data-room-access-log.entity';
import { DataRoomFileEntity } from '../../database/entities/data-room-file.entity';
import {
  STORAGE_PROVIDER,
  StorageProvider,
} from './storage/storage-provider.interface';

/** Shape returned to callers for a single data-room file. */
export interface DataRoomFileDto {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  uploadedByUserId: string;
  createdAt: Date;
}

/**
 * Manages a case's built-in data room: files live in object storage (via the
 * injected {@link StorageProvider}) and are described by `data_room_files` rows.
 * Every upload/download/delete is written to `data_room_access_log` as part of
 * the operation's flow — the audit record is part of the chain-of-custody
 * guarantee, so a log failure fails the operation.
 *
 * Object keys are `org/<orgId>/case/<caseId>/<fileId>`, where `<fileId>` is the
 * row's primary key. Binding the key to the row id keeps storage and DB in
 * lockstep and makes cross-case access impossible: every read/delete is scoped
 * by `{ id, caseId }`, so a file from another case is simply "not found".
 */
@Injectable()
export class DataRoomService {
  private readonly logger = new Logger(DataRoomService.name);

  constructor(
    @InjectRepository(DataRoomFileEntity)
    private readonly fileRepo: Repository<DataRoomFileEntity>,
    @InjectRepository(DataRoomAccessLogEntity)
    private readonly logRepo: Repository<DataRoomAccessLogEntity>,
    @InjectRepository(CaseEntity)
    private readonly caseRepo: Repository<CaseEntity>,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
  ) {}

  // --------------------------- File ops ---------------------------

  /** List a case's files, newest first. Not audited (browsing isn't access). */
  async listFiles(caseId: string): Promise<DataRoomFileDto[]> {
    const rows = await this.fileRepo.find({
      where: { caseId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Stream a new file into storage and record it. The row's id IS the object
   * key suffix, so the row is created with an explicit id resolved up front.
   */
  async uploadFromStream(
    caseId: string,
    userId: string,
    name: string,
    mimeType: string,
    body: Readable,
  ): Promise<DataRoomFileDto> {
    const id = crypto.randomUUID();
    const { orgId } = await this.caseRepo.findOneByOrFail({ id: caseId });
    const objectKey = `org/${orgId}/case/${caseId}/${id}`;

    const { size } = await this.storage.upload(objectKey, body, mimeType);

    const row = await this.fileRepo.save(
      this.fileRepo.create({
        id,
        caseId,
        name,
        mimeType,
        size: String(size),
        objectKey,
        uploadedByUserId: userId,
      }),
    );

    await this.log(caseId, userId, 'upload', id);
    this.logger.log(`upload caseId=${caseId} fileId=${id} size=${size}`);
    return this.toDto(row);
  }

  /**
   * Resolve a file for download. Scoped by `{ id, caseId }` so a file from a
   * different case reads as not found. Opens the storage stream and audits the
   * access before returning.
   */
  async getFileForDownload(
    caseId: string,
    userId: string,
    fileId: string,
  ): Promise<{ stream: Readable; name: string; mimeType: string; size: number }> {
    const row = await this.fileRepo.findOne({
      where: { id: fileId, caseId },
    });
    if (!row) {
      throw new NotFoundException('file_not_found');
    }

    const { stream } = await this.storage.download(row.objectKey);
    await this.log(caseId, userId, 'download', fileId);
    this.logger.log(`download caseId=${caseId} fileId=${fileId}`);
    return {
      stream,
      name: row.name,
      mimeType: row.mimeType,
      size: Number(row.size),
    };
  }

  /**
   * Delete a file's storage object and row. Scoped by `{ id, caseId }` for
   * cross-case isolation. Audited.
   */
  async deleteFile(
    caseId: string,
    userId: string,
    fileId: string,
  ): Promise<void> {
    const row = await this.fileRepo.findOne({
      where: { id: fileId, caseId },
    });
    if (!row) {
      throw new NotFoundException('file_not_found');
    }

    const { objectKey } = row;
    await this.fileRepo.remove(row);
    await this.storage.delete(objectKey);
    await this.log(caseId, userId, 'delete', fileId);
    this.logger.log(`delete caseId=${caseId} fileId=${fileId}`);
  }

  // ------------------------- Helpers -------------------------

  /**
   * Insert an access-log row. Awaited as part of the operation flow so a log
   * failure propagates — the audit record is part of the custody guarantee.
   */
  private async log(
    caseId: string,
    userId: string,
    action: DataRoomAction,
    fileId: string | null,
  ): Promise<void> {
    await this.logRepo.save(
      this.logRepo.create({ caseId, fileId, userId, action }),
    );
  }

  private toDto(row: DataRoomFileEntity): DataRoomFileDto {
    return {
      id: row.id,
      name: row.name,
      mimeType: row.mimeType,
      size: row.size,
      uploadedByUserId: row.uploadedByUserId,
      createdAt: row.createdAt,
    };
  }

}
