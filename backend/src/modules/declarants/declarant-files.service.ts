import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { Repository } from 'typeorm';
import { DeclarantEntity } from '../../database/entities/declarant.entity';
import { DeclarantFileEntity, DeclarantFileKind } from '../../database/entities/declarant-file.entity';
import {
  STORAGE_PROVIDER,
  StorageProvider,
} from '../data-room/storage/storage-provider.interface';
import { DeclarantRequester } from './declarants.service';

/**
 * Manages a declarant's supporting files (CVs, prior declarations): files live
 * in object storage (via the injected {@link StorageProvider}) and are described
 * by `declarant_files` rows.
 *
 * Object keys are `org/<orgId>/<fileId>` — a flat, org-scoped file space shared
 * by any future org-level files (the declarant linkage lives in the DB row, not
 * the key). The key binds to the row's primary key, mirroring the data-room
 * convention, so storage and DB stay in lockstep.
 *
 * Every method resolves the declarant org-scoped first (`{ id, organizationId }`)
 * so a cross-org id always reads as 404 before any ownership check runs. Reads
 * (`list`/`download`) stop there — member access is enough. Writes
 * (`upload`/`remove`) additionally require the requester to be an org admin OR
 * the declarant's linked owner, mirroring `DeclarantsService#loadOwned`.
 */
@Injectable()
export class DeclarantFilesService {
  constructor(
    @InjectRepository(DeclarantFileEntity)
    private readonly fileRepo: Repository<DeclarantFileEntity>,
    @InjectRepository(DeclarantEntity)
    private readonly declarantRepo: Repository<DeclarantEntity>,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider,
  ) {}

  /** List a declarant's files. Member read — no ownership check. */
  async list(organizationId: string, declarantId: string): Promise<DeclarantFileEntity[]> {
    await this.loadDeclarant(organizationId, declarantId);
    return this.fileRepo.find({ where: { declarantId } });
  }

  /**
   * Stream a new file into storage and record it. Owner/admin only. The row's
   * id IS the object key suffix, so the row id is resolved up front — storage
   * write happens BEFORE the row is saved, so a storage failure leaves no
   * orphan row (no cleanup path needed).
   */
  async upload(
    organizationId: string,
    declarantId: string,
    requester: DeclarantRequester,
    kind: DeclarantFileKind,
    name: string,
    mimeType: string,
    stream: Readable,
  ): Promise<DeclarantFileEntity> {
    await this.loadOwned(organizationId, declarantId, requester);

    const id = randomUUID();
    const objectKey = `org/${organizationId}/${id}`;

    const { size } = await this.storage.upload(objectKey, stream, mimeType);

    return this.fileRepo.save(
      this.fileRepo.create({
        id,
        declarantId,
        kind,
        name,
        mimeType,
        size: String(size),
        objectKey,
        uploadedByUserId: requester.userId,
      }),
    );
  }

  /** Resolve a file for download. Member read — no ownership check. */
  async download(
    organizationId: string,
    declarantId: string,
    fileId: string,
  ): Promise<{ stream: Readable; name: string; mimeType: string; size: string }> {
    await this.loadDeclarant(organizationId, declarantId);

    const row = await this.fileRepo.findOne({ where: { id: fileId, declarantId } });
    if (!row) {
      throw new NotFoundException(`Declarant file ${fileId} not found`);
    }

    const { stream } = await this.storage.download(row.objectKey);
    return { stream, name: row.name, mimeType: row.mimeType, size: row.size };
  }

  /**
   * Delete a file's storage object and row. Owner/admin only. Storage is
   * deleted BEFORE the row, per the data-room precedent inverted for this
   * simpler (single-file, unaudited) flow.
   */
  async remove(
    organizationId: string,
    declarantId: string,
    fileId: string,
    requester: DeclarantRequester,
  ): Promise<void> {
    await this.loadOwned(organizationId, declarantId, requester);

    const row = await this.fileRepo.findOne({ where: { id: fileId, declarantId } });
    if (!row) {
      throw new NotFoundException(`Declarant file ${fileId} not found`);
    }

    await this.storage.delete(row.objectKey);
    await this.fileRepo.remove(row);
  }

  /** Load an org-scoped declarant, else 404. No ownership check. */
  private async loadDeclarant(
    organizationId: string,
    declarantId: string,
  ): Promise<DeclarantEntity> {
    const declarant = await this.declarantRepo.findOneBy({ id: declarantId, organizationId });
    if (!declarant) throw new NotFoundException(`Declarant ${declarantId} not found`);
    return declarant;
  }

  /**
   * Load an org-scoped declarant, then enforce self-ownership: allowed only if
   * the requester is an org admin OR owns the declarant. Mirrors
   * `DeclarantsService#loadOwned` exactly.
   */
  private async loadOwned(
    organizationId: string,
    declarantId: string,
    requester: DeclarantRequester,
  ): Promise<DeclarantEntity> {
    const declarant = await this.loadDeclarant(organizationId, declarantId);

    const isAdmin = requester.orgRole === 'admin';
    const isOwner = declarant.userId != null && declarant.userId === requester.userId;
    if (!isAdmin && !isOwner) {
      throw new ForbiddenException('You can only modify files on your own declarant profile');
    }

    return declarant;
  }
}
