import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { DeclarantEntity } from '../../database/entities/declarant.entity';
import { CreateDeclarantDto } from './dto/create-declarant.dto';
import { UpdateDeclarantDto } from './dto/update-declarant.dto';

/**
 * The requester context an org route supplies for row-level authorization.
 * `userId` is the authenticated user's id (from the user principal) and
 * `orgRole` is their role in the host org (from `req.orgMembership.role`).
 */
export interface DeclarantRequester {
  userId: string;
  orgRole: string;
}

/**
 * Coerce the free-form `qualifications` blob into an array of well-formed
 * paragraph objects. This is the write-time guarantee that every stored
 * qualification is `{ id, text, subItems[], exhibitIds[], footnotes[] }` — malformed
 * entries (e.g. an array, or a paragraph missing `text`, whether from a bad client
 * or the agent) are dropped or defaulted rather than persisted.
 */
export function normalizeQualifications(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .filter(
      (p): p is Record<string, unknown> => !!p && typeof p === 'object' && !Array.isArray(p),
    )
    .map((p) => ({
      id: typeof p.id === 'string' ? p.id : randomUUID(),
      text: typeof p.text === 'string' ? p.text : '',
      subItems: Array.isArray(p.subItems) ? p.subItems : [],
      exhibitIds: Array.isArray(p.exhibitIds) ? p.exhibitIds : [],
      footnotes: Array.isArray(p.footnotes) ? p.footnotes : [],
    }));
}

/** Coerce `priorTestimony` into a plain array of strings, dropping non-strings. */
export function normalizePriorTestimony(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  return list.filter((s): s is string => typeof s === 'string');
}

@Injectable()
export class DeclarantsService {
  constructor(
    @InjectRepository(DeclarantEntity)
    private readonly declarantRepo: Repository<DeclarantEntity>,
  ) {}

  async listForOrg(organizationId: string): Promise<DeclarantEntity[]> {
    return this.declarantRepo.find({
      where: { organizationId },
      order: { displayName: 'ASC' },
    });
  }

  async create(
    organizationId: string,
    dto: CreateDeclarantDto,
    requester: DeclarantRequester,
  ): Promise<DeclarantEntity> {
    this.assertUserIdAssignable(dto.userId, requester);
    const declarant = this.declarantRepo.create({
      ...dto,
      qualifications: normalizeQualifications(dto.qualifications),
      priorTestimony: normalizePriorTestimony(dto.priorTestimony),
      organizationId,
    });
    return this.declarantRepo.save(declarant);
  }

  async update(
    organizationId: string,
    declarantId: string,
    dto: UpdateDeclarantDto,
    requester: DeclarantRequester,
  ): Promise<DeclarantEntity> {
    const declarant = await this.loadOwned(organizationId, declarantId, requester);
    this.assertUserIdAssignable(dto.userId, requester);

    if (dto.displayName !== undefined) declarant.displayName = dto.displayName;
    if (dto.title !== undefined) declarant.title = dto.title;
    if (dto.firm !== undefined) declarant.firm = dto.firm;
    if (dto.cvExhibit !== undefined) declarant.cvExhibit = dto.cvExhibit;
    if (dto.hourlyRate !== undefined) declarant.hourlyRate = dto.hourlyRate;
    if (dto.nonContingencyDisclosure !== undefined) {
      declarant.nonContingencyDisclosure = dto.nonContingencyDisclosure;
    }
    if (dto.dateOfBirth !== undefined) declarant.dateOfBirth = dto.dateOfBirth;
    if (dto.address !== undefined) declarant.address = dto.address;
    if (dto.userId !== undefined) declarant.userId = dto.userId;
    if (dto.qualifications !== undefined) {
      declarant.qualifications = normalizeQualifications(dto.qualifications);
    }
    if (dto.priorTestimony !== undefined) {
      declarant.priorTestimony = normalizePriorTestimony(dto.priorTestimony);
    }

    return this.declarantRepo.save(declarant);
  }

  async remove(
    organizationId: string,
    declarantId: string,
    requester: DeclarantRequester,
  ): Promise<void> {
    const declarant = await this.loadOwned(organizationId, declarantId, requester);
    await this.declarantRepo.remove(declarant);
  }

  /**
   * Gate client-supplied `userId` writes: a non-admin may only set `userId` to
   * their own id (self-link) or leave it null/unset. Only an org admin may
   * assign a declarant's ownership to an arbitrary user id.
   */
  private assertUserIdAssignable(
    userId: string | null | undefined,
    requester: DeclarantRequester,
  ): void {
    if (userId == null) return;
    if (requester.orgRole === 'admin') return;
    if (userId === requester.userId) return;
    throw new ForbiddenException('Only admins can link a declarant to another member');
  }

  /**
   * Load an org-scoped declarant, then enforce self-ownership: the mutation is
   * allowed only if the requester is an org admin OR owns the declarant
   * (`declarant.userId === requester.userId`). Loading is scoped by
   * `organizationId` first so a cross-org id surfaces as a 404 (never leaking
   * existence) before the ownership check runs.
   */
  private async loadOwned(
    organizationId: string,
    declarantId: string,
    requester: DeclarantRequester,
  ): Promise<DeclarantEntity> {
    const declarant = await this.declarantRepo.findOneBy({ id: declarantId, organizationId });
    if (!declarant) throw new NotFoundException(`Declarant ${declarantId} not found`);

    const isAdmin = requester.orgRole === 'admin';
    const isOwner = declarant.userId != null && declarant.userId === requester.userId;
    if (!isAdmin && !isOwner) {
      throw new ForbiddenException('You can only modify your own declarant profile');
    }

    return declarant;
  }
}
