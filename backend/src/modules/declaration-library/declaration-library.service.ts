import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  DeclarationLibraryBlockEntity,
  DeclarationLibraryBlockKind,
} from '../../database/entities/declaration-library-block.entity';
import { CreateDeclarationLibraryBlockDto } from './dto/create-declaration-library-block.dto';
import { UpdateDeclarationLibraryBlockDto } from './dto/update-declaration-library-block.dto';

interface NormalizedLibraryParagraph {
  id: string;
  text: string;
  subItems: unknown[];
  exhibitIds: unknown[];
  footnotes: unknown[];
}

/**
 * Coerce the free-form `content` blob into `{ paragraphs: DeclarationParagraph[] }`
 * with every paragraph a well-formed object. This is the write-time guarantee that
 * the editor/picker can always read `paragraph.text` — malformed entries (e.g. an
 * array or a paragraph missing `text`, whether from a bad client or the agent) are
 * dropped or defaulted rather than persisted.
 */
export function normalizeLibraryContent(content: unknown): { paragraphs: NormalizedLibraryParagraph[] } {
  const raw =
    content && typeof content === 'object' && !Array.isArray(content)
      ? (content as Record<string, unknown>).paragraphs
      : undefined;
  const list = Array.isArray(raw) ? raw : [];
  const paragraphs = list
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
  return { paragraphs };
}

@Injectable()
export class DeclarationLibraryService {
  constructor(
    @InjectRepository(DeclarationLibraryBlockEntity)
    private readonly blockRepo: Repository<DeclarationLibraryBlockEntity>,
  ) {}

  async listForOrg(
    organizationId: string,
    kind?: DeclarationLibraryBlockKind,
  ): Promise<DeclarationLibraryBlockEntity[]> {
    return this.blockRepo.find({
      where: kind ? { organizationId, kind } : { organizationId },
      order: { kind: 'ASC', name: 'ASC' },
    });
  }

  async create(
    organizationId: string,
    dto: CreateDeclarationLibraryBlockDto,
  ): Promise<DeclarationLibraryBlockEntity> {
    const block = this.blockRepo.create({
      ...dto,
      content: normalizeLibraryContent(dto.content),
      organizationId,
    });
    return this.blockRepo.save(block);
  }

  async update(
    organizationId: string,
    blockId: string,
    dto: UpdateDeclarationLibraryBlockDto,
  ): Promise<DeclarationLibraryBlockEntity> {
    const block = await this.blockRepo.findOneBy({ id: blockId, organizationId });
    if (!block) throw new NotFoundException(`Declaration library block ${blockId} not found`);

    if (dto.kind !== undefined) block.kind = dto.kind;
    if (dto.name !== undefined) block.name = dto.name;
    if (dto.category !== undefined) block.category = dto.category;
    if (dto.content !== undefined) block.content = normalizeLibraryContent(dto.content);

    return this.blockRepo.save(block);
  }

  async remove(organizationId: string, blockId: string): Promise<void> {
    const block = await this.blockRepo.findOneBy({ id: blockId, organizationId });
    if (!block) throw new NotFoundException(`Declaration library block ${blockId} not found`);

    await this.blockRepo.remove(block);
  }
}
