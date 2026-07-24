import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import { CaseEntity } from '../../database/entities/case.entity';
import {
  DataRoomAccessLogEntity,
  DataRoomAction,
} from '../../database/entities/data-room-access-log.entity';
import { DataRoomFileEntity } from '../../database/entities/data-room-file.entity';
import { DataRoomFolderEntity } from '../../database/entities/data-room-folder.entity';
import { GoogleDriveExportService } from './google-drive-export.service';
import { GoogleDriveImportService } from './google-drive-import.service';
import {
  STORAGE_PROVIDER,
  StorageProvider,
} from './storage/storage-provider.interface';
import { DOCX_MIME } from '../productions/redline-extract';

/**
 * Files-API ceiling for AI-agent PDF reads. PDFs upload by `file_id` (full
 * vision, no inline base64 cap) up to Anthropic's 32 MB processing limit;
 * other types stay on the caller-supplied (smaller) inline ceiling.
 */
const PDF_AGENT_READ_BYTES = 32 * 1024 * 1024;

/**
 * Ceiling for redline source ingestion. The extractor (mammoth/unpdf) buffers
 * the whole file in memory, so this stays well under the agent-read ceiling.
 */
const REDLINE_MAX_BYTES = 20 * 1024 * 1024;

/** Shape returned to callers for a single data-room file. */
export interface DataRoomFileDto {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  uploadedByUserId: string;
  createdAt: Date;
}

/** Shape returned to callers for a single data-room folder. */
export interface DataRoomFolderDto {
  id: string;
  caseId: string;
  parentFolderId: string | null;
  name: string;
  createdByUserId: string;
  createdAt: Date;
}

/** A folder's listing: its path, child folders, and direct files. */
export interface DataRoomFolderContents {
  breadcrumb: { id: string; name: string }[];
  folders: DataRoomFolderDto[];
  files: DataRoomFileDto[];
}

/** A flat manifest entry for the AI agent: resolved folder path, numeric size. */
export interface DataRoomManifestEntry {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  folder: string; // POSIX-style path, '/' for root
}

export interface DataRoomManifest {
  files: DataRoomManifestEntry[];
  total: number;
  truncated: boolean;
}

/** Result of an agent file read. `tooLarge` short-circuits before any download. */
export interface AgentReadResult {
  tooLarge: boolean;
  name: string;
  mimeType: string;
  size: number;
  stream?: Readable;
  /** Cached Anthropic Files API id, if a prior oversized-PDF read uploaded it. */
  anthropicFileId: string | null;
}

export interface DriveExportResult {
  exported: { fileId: string; name: string; webViewLink: string | null }[];
  failed: { fileId: string; error: string }[];
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
    @InjectRepository(DataRoomFolderEntity)
    private readonly folderRepo: Repository<DataRoomFolderEntity>,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
    private readonly driveImport: GoogleDriveImportService,
    private readonly driveExport: GoogleDriveExportService,
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
   * Flat file manifest for the AI agent, newest-first. Each file carries a
   * resolved POSIX-style folder path. `limit` caps the returned files (for the
   * inline case-context manifest); `total`/`truncated` report the full count.
   * Not audited — building a listing isn't file access.
   */
  async getManifest(caseId: string, limit?: number): Promise<DataRoomManifest> {
    const [rows, total] = await Promise.all([
      this.fileRepo.find({
        where: { caseId },
        order: { createdAt: 'DESC' },
        ...(limit ? { take: limit } : {}),
      }),
      this.fileRepo.count({ where: { caseId } }),
    ]);

    const folders = await this.folderRepo.find({ where: { caseId } });
    const byId = new Map(folders.map((f) => [f.id, f]));
    const pathFor = (folderId: string | null): string => {
      const names: string[] = [];
      let cursor = folderId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const f = byId.get(cursor);
        if (!f) break;
        names.unshift(f.name);
        cursor = f.parentFolderId;
      }
      return '/' + names.join('/');
    };

    return {
      files: rows.map((r) => ({
        id: r.id,
        name: r.name,
        mimeType: r.mimeType,
        size: Number(r.size),
        folder: pathFor(r.folderId),
      })),
      total,
      truncated: limit != null && total > limit,
    };
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
    folderId?: string | null,
  ): Promise<DataRoomFileDto> {
    const id = crypto.randomUUID();
    const { orgId } = await this.caseRepo.findOneByOrFail({ id: caseId });
    if (folderId) {
      await this.assertFolderExists(caseId, folderId);
    }
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
        folderId: folderId ?? null,
      }),
    );

    await this.log(caseId, userId, 'upload', id);
    this.logger.log(`upload caseId=${caseId} fileId=${id} size=${size}`);
    return this.toDto(row);
  }

  /**
   * Import one or more Google Drive files into the case's data room. Each file
   * is fetched via {@link GoogleDriveImportService} and streamed through
   * {@link uploadFromStream} (storage write + row + audit). Failures are
   * isolated per file: a fetch/upload error for one id never aborts the rest —
   * the id is collected in `failed` with its message and the loop continues.
   */
  async importFromDrive(
    caseId: string,
    userId: string,
    accessToken: string,
    fileIds: string[],
    folderId?: string | null,
  ): Promise<{
    imported: DataRoomFileDto[];
    failed: { fileId: string; error: string }[];
  }> {
    const imported: DataRoomFileDto[] = [];
    const failed: { fileId: string; error: string }[] = [];
    for (const fileId of fileIds) {
      try {
        const { name, mimeType, stream } = await this.driveImport.fetchForImport(
          accessToken,
          fileId,
        );
        imported.push(
          await this.uploadFromStream(
            caseId,
            userId,
            name,
            mimeType,
            stream,
            folderId,
          ),
        );
      } catch (e) {
        failed.push({ fileId, error: (e as Error).message });
      }
    }
    return { imported, failed };
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
   * Export stored files to the user's Google Drive. Browser-supplied `accessToken`
   * (drive.file scope) authorizes the writes; storage creds authorize the reads.
   * Each file: tenancy-scoped lookup → stream from storage → drive.files.create →
   * `export` audit row. One file failing does not abort the batch. `destinationFolderId`
   * null → My Drive root.
   */
  async exportToDrive(
    caseId: string,
    userId: string,
    accessToken: string,
    fileIds: string[],
    destinationFolderId: string | null,
  ): Promise<DriveExportResult> {
    const exported: DriveExportResult['exported'] = [];
    const failed: DriveExportResult['failed'] = [];

    for (const fileId of fileIds) {
      try {
        const row = await this.fileRepo.findOne({ where: { id: fileId, caseId } });
        if (!row) {
          failed.push({ fileId, error: 'file_not_found' });
          continue;
        }
        const { stream } = await this.storage.download(row.objectKey);
        const created = await this.driveExport.uploadToFolder(
          accessToken, row.name, row.mimeType, stream, destinationFolderId,
        );
        await this.log(caseId, userId, 'export', fileId);
        this.logger.log(`export caseId=${caseId} fileId=${fileId} driveId=${created.id}`);
        exported.push({ fileId, name: row.name, webViewLink: created.webViewLink });
      } catch (e) {
        failed.push({ fileId, error: e instanceof Error ? e.message : 'export_failed' });
      }
    }
    return { exported, failed };
  }

  /**
   * Resolve a file for the AI agent to read. Scoped by `{ id, caseId }` so a
   * file from a different case reads as not found. Files larger than the ceiling
   * short-circuit to `{ tooLarge: true }` WITHOUT a download or audit row —
   * nothing was read. A successful read opens the storage stream and writes an
   * `agent_read` audit row (custody) before returning.
   *
   * `maxBytes` is the ceiling for non-PDF types; PDFs use the 32 MB Files-API
   * ceiling instead (they upload by `file_id` rather than inline base64). The
   * mime is only known after the row is fetched, so the ceiling is chosen here.
   */
  async getFileForAgentRead(
    caseId: string,
    userId: string,
    fileId: string,
    maxBytes: number,
  ): Promise<AgentReadResult> {
    const row = await this.fileRepo.findOne({ where: { id: fileId, caseId } });
    if (!row) {
      throw new NotFoundException('file_not_found');
    }
    const size = Number(row.size);
    const ceiling =
      row.mimeType === 'application/pdf' ? PDF_AGENT_READ_BYTES : maxBytes;
    if (size > ceiling) {
      return {
        tooLarge: true,
        name: row.name,
        mimeType: row.mimeType,
        size,
        anthropicFileId: row.anthropicFileId,
      };
    }
    const { stream } = await this.storage.download(row.objectKey);
    await this.log(caseId, userId, 'agent_read', fileId);
    this.logger.log(`agent_read caseId=${caseId} fileId=${fileId}`);
    return {
      tooLarge: false,
      name: row.name,
      mimeType: row.mimeType,
      size,
      stream,
      anthropicFileId: row.anthropicFileId,
    };
  }

  /**
   * Thin buffering wrapper around {@link getFileForAgentRead}: same tenancy
   * scoping, size gate, and `agent_read` audit row (all handled there — this
   * does not re-log or re-gate). A too-large result short-circuits before any
   * buffering; otherwise the resolved stream is fully buffered into memory.
   */
  async getFileBufferForAgent(
    caseId: string,
    userId: string,
    fileId: string,
    maxBytes: number,
  ): Promise<
    | { tooLarge: true; name: string; mimeType: string; size: number }
    | { tooLarge: false; name: string; mimeType: string; size: number; buffer: Buffer }
  > {
    const read = await this.getFileForAgentRead(caseId, userId, fileId, maxBytes);
    if (read.tooLarge) {
      return { tooLarge: true, name: read.name, mimeType: read.mimeType, size: read.size };
    }
    const buffer = await this.streamToBuffer(read.stream!);
    return { tooLarge: false, name: read.name, mimeType: read.mimeType, size: read.size, buffer };
  }

  /**
   * Resolve a file for redline ingestion. Scoped by `{ id, caseId }` so a file
   * from a different case reads as not found. Only DOCX/PDF sources are
   * eligible, and the file must be at or under {@link REDLINE_MAX_BYTES} —
   * the extractor buffers the whole file in memory. A successful read
   * buffers the storage stream and writes a `download` audit row before
   * returning.
   */
  async getFileForRedline(
    caseId: string,
    fileId: string,
    actorUserId: string,
  ): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
    const row = await this.fileRepo.findOne({ where: { id: fileId, caseId } });
    if (!row) {
      throw new NotFoundException('file_not_found');
    }
    if (row.mimeType !== DOCX_MIME && row.mimeType !== 'application/pdf') {
      throw new BadRequestException(
        `Unsupported redline source type: ${row.mimeType}. Upload a .docx (preferred) or .pdf.`,
      );
    }
    if (Number(row.size) > REDLINE_MAX_BYTES) {
      throw new BadRequestException(
        'File exceeds the 20MB redline ingestion limit',
      );
    }
    const { stream } = await this.storage.download(row.objectKey);
    const buffer = await this.streamToBuffer(stream);
    await this.log(caseId, actorUserId, 'download', fileId);
    this.logger.log(`redline download caseId=${caseId} fileId=${fileId}`);
    return { name: row.name, mimeType: row.mimeType, buffer };
  }

  /**
   * Cache the Anthropic Files API id on a file row so repeat oversized-PDF reads
   * reference the existing upload instead of re-uploading. Scoped by `{ id, caseId }`.
   */
  async setAnthropicFileId(
    caseId: string,
    fileId: string,
    anthropicFileId: string,
  ): Promise<void> {
    await this.fileRepo.update({ id: fileId, caseId }, { anthropicFileId });
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

  // --------------------------- Folder ops ---------------------------

  /**
   * Create a folder. When `parentFolderId` is given it must name a folder in the
   * same case (else NotFound) — this keeps the tree single-tenant. A null parent
   * creates the folder at the root.
   */
  async createFolder(
    caseId: string,
    userId: string,
    name: string,
    parentFolderId: string | null,
  ): Promise<DataRoomFolderDto> {
    if (parentFolderId) {
      await this.assertFolderExists(caseId, parentFolderId);
    }
    const row = await this.folderRepo.save(
      this.folderRepo.create({
        caseId,
        parentFolderId: parentFolderId ?? null,
        name,
        createdByUserId: userId,
      }),
    );
    return this.toFolderDto(row);
  }

  /**
   * List a folder's direct contents: child folders (A→Z), direct files (newest
   * first), and the breadcrumb path from the root down to (and including) the
   * folder. `folderId === null` lists the root, which has an empty breadcrumb.
   */
  async listContents(
    caseId: string,
    folderId: string | null,
  ): Promise<DataRoomFolderContents> {
    const folders = await this.folderRepo.find({
      where: { caseId, parentFolderId: folderId ?? IsNull() },
      order: { name: 'ASC' },
    });
    const files = await this.fileRepo.find({
      where: { caseId, folderId: folderId ?? IsNull() },
      order: { createdAt: 'DESC' },
    });
    const breadcrumb = await this.buildBreadcrumb(caseId, folderId);
    return {
      breadcrumb,
      folders: folders.map((f) => this.toFolderDto(f)),
      files: files.map((f) => this.toDto(f)),
    };
  }

  /**
   * Move a file to `targetFolderId` (null = root). The file and the destination
   * folder must both belong to the case — a mismatch reads as NotFound.
   */
  async moveFile(
    caseId: string,
    userId: string,
    fileId: string,
    targetFolderId: string | null,
  ): Promise<void> {
    const row = await this.fileRepo.findOne({ where: { id: fileId, caseId } });
    if (!row) {
      throw new NotFoundException('file_not_found');
    }
    if (targetFolderId) {
      await this.assertFolderExists(caseId, targetFolderId);
    }
    row.folderId = targetFolderId;
    await this.fileRepo.save(row);
    this.logger.log(
      `moveFile caseId=${caseId} fileId=${fileId} folderId=${targetFolderId}`,
    );
  }

  /**
   * Re-parent a folder under `targetFolderId` (null = root). Rejects moves that
   * would create a cycle: into itself, or into any of its own descendants
   * (detected by walking up from the target — if we reach the folder being
   * moved, the target is below it).
   */
  async moveFolder(
    caseId: string,
    userId: string,
    folderId: string,
    targetFolderId: string | null,
  ): Promise<void> {
    const folder = await this.folderRepo.findOne({
      where: { id: folderId, caseId },
    });
    if (!folder) {
      throw new NotFoundException('folder_not_found');
    }
    if (targetFolderId) {
      if (targetFolderId === folderId) {
        throw new BadRequestException(
          'cannot move a folder into itself or a descendant',
        );
      }
      let cursor: string | null = targetFolderId;
      while (cursor) {
        if (cursor === folderId) {
          throw new BadRequestException(
            'cannot move a folder into itself or a descendant',
          );
        }
        const parent: DataRoomFolderEntity | null =
          await this.folderRepo.findOneBy({ id: cursor, caseId });
        cursor = parent?.parentFolderId ?? null;
      }
      await this.assertFolderExists(caseId, targetFolderId);
    }
    folder.parentFolderId = targetFolderId;
    await this.folderRepo.save(folder);
    this.logger.log(
      `moveFolder caseId=${caseId} folderId=${folderId} parentFolderId=${targetFolderId}`,
    );
  }

  /**
   * Delete a folder and its entire subtree. The DB is the source of truth: all
   * audit rows, file rows, and folder rows are committed before any storage
   * delete is attempted. This ensures that a crash mid-cleanup can never leave a
   * half-deleted subtree in the DB — the only residue of a partial failure is
   * reclaimable GCS orphans, which are surfaced via a thrown error after the DB
   * work is complete.
   *
   * Order of operations:
   *   1. BFS subtree → collect all folder ids and file rows.
   *   2. Batch-insert all delete access-log rows (custody captured before removal).
   *   3. Bulk-delete all file rows (`DELETE … WHERE id IN (…)`).
   *   4. Bulk-delete all folder rows.
   *   5. Best-effort storage cleanup; if any object deletes fail, throw after all
   *      keys have been attempted.
   */
  async deleteFolder(
    caseId: string,
    userId: string,
    folderId: string,
  ): Promise<void> {
    const folder = await this.folderRepo.findOne({
      where: { id: folderId, caseId },
    });
    if (!folder) {
      throw new NotFoundException('folder_not_found');
    }

    // BFS the subtree, collecting every folder id (including the root folder).
    const allFolderIds: string[] = [folderId];
    const queue: string[] = [folderId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const children = await this.folderRepo.find({
        where: { caseId, parentFolderId: current },
      });
      for (const child of children) {
        allFolderIds.push(child.id);
        queue.push(child.id);
      }
    }

    const files = await this.fileRepo.find({
      where: { caseId, folderId: In(allFolderIds) },
    });

    const objectKeys = files.map((f) => f.objectKey);
    const fileIds = files.map((f) => f.id);

    // Step 1: Batch-insert audit rows BEFORE any deletion so custody is
    // captured even if a subsequent step fails. access_log.fileId is a plain
    // nullable varchar with no FK, so referencing soon-to-be-deleted ids is fine.
    if (fileIds.length) {
      const logRows = fileIds.map((id) =>
        this.logRepo.create({ caseId, fileId: id, userId, action: 'delete' as DataRoomAction }),
      );
      await this.logRepo.save(logRows);
    }

    // Step 2: Bulk-delete all file rows.
    if (fileIds.length) {
      await this.fileRepo.delete({ id: In(fileIds) });
    }

    // Step 3: Bulk-delete all folder rows.
    await this.folderRepo.delete({ id: In(allFolderIds) });

    this.logger.log(
      `deleteFolder caseId=${caseId} folderId=${folderId} folders=${allFolderIds.length} files=${files.length}`,
    );

    // Step 4: Best-effort storage cleanup. DB is already consistent at this
    // point; a failed object delete leaves a reclaimable GCS orphan.
    const storageErrors: unknown[] = [];
    for (const key of objectKeys) {
      try {
        await this.storage.delete(key);
      } catch (e) {
        storageErrors.push(e);
      }
    }
    if (storageErrors.length > 0) {
      throw new Error(
        `Folder deleted, but ${storageErrors.length} storage object(s) failed to delete and may be orphaned`,
      );
    }
  }

  // ------------------------- Helpers -------------------------

  /** Assert a folder `{ id, caseId }` exists, else NotFound (cross-tenant safe). */
  private async assertFolderExists(
    caseId: string,
    folderId: string,
  ): Promise<void> {
    const folder = await this.folderRepo.findOneBy({ id: folderId, caseId });
    if (!folder) {
      throw new NotFoundException('folder_not_found');
    }
  }

  /**
   * Walk up from `folderId` via parentFolderId (each hop scoped by caseId) and
   * return the path oldest-ancestor-first, including the folder itself. Root
   * (`folderId === null`) yields an empty breadcrumb.
   */
  private async buildBreadcrumb(
    caseId: string,
    folderId: string | null,
  ): Promise<{ id: string; name: string }[]> {
    const trail: { id: string; name: string }[] = [];
    let cursor: string | null = folderId;
    while (cursor) {
      const folder: DataRoomFolderEntity | null =
        await this.folderRepo.findOneBy({ id: cursor, caseId });
      if (!folder) {
        break;
      }
      trail.push({ id: folder.id, name: folder.name });
      cursor = folder.parentFolderId;
    }
    return trail.reverse();
  }

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

  /** Buffer a Readable fully in memory. Used for redline ingestion only. */
  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
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

  private toFolderDto(row: DataRoomFolderEntity): DataRoomFolderDto {
    return {
      id: row.id,
      caseId: row.caseId,
      parentFolderId: row.parentFolderId,
      name: row.name,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
    };
  }

}
