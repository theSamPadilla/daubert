import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductionEntity, ProductionType } from '../../database/entities/production.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { AccessPrincipal } from '../auth/access-principal';
import { CreateProductionDto } from './dto/create-production.dto';
import { UpdateProductionDto } from './dto/update-production.dto';

// Discriminated union of atomic ops. The list is intentionally small —
// extend with `report_*` and `chart_*` shapes as those types acquire
// equivalent token-cost issues. The discriminator is the `op` field.
type ChronologyEntry = Record<string, unknown>;
type Op =
  | { op: 'chronology_append'; entries: ChronologyEntry[] }
  | { op: 'chronology_replace'; index: number; entry: ChronologyEntry }
  | { op: 'chronology_delete'; indexes: number[] }
  | { op: 'chronology_set_title'; title: string };

@Injectable()
export class ProductionsService {
  constructor(
    @InjectRepository(ProductionEntity)
    private readonly repo: Repository<ProductionEntity>,
    private readonly caseAccess: CaseAccessService,
  ) {}

  async findAllForCase(caseId: string, principal: AccessPrincipal, type?: ProductionType) {
    await this.caseAccess.assertAccess(principal, caseId);
    const where: any = { caseId };
    if (type) where.type = type;
    return this.repo.find({ where, order: { createdAt: 'ASC' } });
  }

  async findOne(id: string, principal: AccessPrincipal) {
    const production = await this.repo.findOneBy({ id });
    if (!production) throw new NotFoundException(`Production ${id} not found`);
    await this.caseAccess.assertAccess(principal, production.caseId);
    return production;
  }

  async create(caseId: string, dto: CreateProductionDto, principal: AccessPrincipal) {
    await this.caseAccess.assertAccess(principal, caseId);
    const production = this.repo.create({ ...dto, caseId });
    return this.repo.save(production);
  }

  async update(id: string, dto: UpdateProductionDto, principal: AccessPrincipal) {
    if (dto.data !== undefined && dto.ops !== undefined) {
      throw new BadRequestException('`data` and `ops` are mutually exclusive');
    }

    const production = await this.findOne(id, principal);

    if (dto.name !== undefined) production.name = dto.name;
    if (dto.type !== undefined) production.type = dto.type;

    if (dto.data !== undefined) {
      production.data = dto.data;
    } else if (dto.ops !== undefined) {
      production.data = applyOps(production.type, production.data ?? {}, dto.ops);
    }

    return this.repo.save(production);
  }

  async remove(id: string, principal: AccessPrincipal) {
    const production = await this.findOne(id, principal);
    await this.repo.remove(production);
  }
}

// Pure function — applies ops sequentially. Each op operates on the state
// produced by the previous ops in the same call.
function applyOps(
  type: ProductionType,
  initial: Record<string, unknown>,
  rawOps: Record<string, unknown>[],
): Record<string, unknown> {
  let data: Record<string, unknown> = { ...initial };
  rawOps.forEach((raw, i) => {
    const op = parseOp(raw, i);
    data = applyOp(type, data, op, i);
  });
  return data;
}

function parseOp(raw: Record<string, unknown>, i: number): Op {
  const opName = raw.op;
  if (typeof opName !== 'string') {
    throw new BadRequestException(`ops[${i}]: missing string \`op\` discriminator`);
  }
  switch (opName) {
    case 'chronology_append': {
      if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
        throw new BadRequestException(`ops[${i}] (chronology_append): \`entries\` must be a non-empty array`);
      }
      return { op: 'chronology_append', entries: raw.entries as ChronologyEntry[] };
    }
    case 'chronology_replace': {
      if (typeof raw.index !== 'number' || !Number.isInteger(raw.index) || raw.index < 0) {
        throw new BadRequestException(`ops[${i}] (chronology_replace): \`index\` must be a non-negative integer`);
      }
      if (raw.entry === null || typeof raw.entry !== 'object') {
        throw new BadRequestException(`ops[${i}] (chronology_replace): \`entry\` must be an object`);
      }
      return { op: 'chronology_replace', index: raw.index, entry: raw.entry as ChronologyEntry };
    }
    case 'chronology_delete': {
      if (
        !Array.isArray(raw.indexes) ||
        raw.indexes.length === 0 ||
        !raw.indexes.every((n): n is number => Number.isInteger(n) && (n as number) >= 0)
      ) {
        throw new BadRequestException(`ops[${i}] (chronology_delete): \`indexes\` must be a non-empty array of non-negative integers`);
      }
      return { op: 'chronology_delete', indexes: raw.indexes as number[] };
    }
    case 'chronology_set_title': {
      if (typeof raw.title !== 'string') {
        throw new BadRequestException(`ops[${i}] (chronology_set_title): \`title\` must be a string`);
      }
      return { op: 'chronology_set_title', title: raw.title };
    }
    default:
      throw new BadRequestException(`ops[${i}]: unknown op "${opName}"`);
  }
}

function applyOp(
  type: ProductionType,
  data: Record<string, unknown>,
  op: Op,
  i: number,
): Record<string, unknown> {
  if (op.op.startsWith('chronology_') && type !== ProductionType.CHRONOLOGY) {
    throw new BadRequestException(`ops[${i}] (${op.op}): production is type "${type}", not "chronology"`);
  }
  const entries = Array.isArray(data.entries) ? [...(data.entries as ChronologyEntry[])] : [];

  switch (op.op) {
    case 'chronology_append':
      return { ...data, entries: [...entries, ...op.entries] };
    case 'chronology_replace': {
      if (op.index >= entries.length) {
        throw new BadRequestException(`ops[${i}] (chronology_replace): index ${op.index} out of bounds (length=${entries.length})`);
      }
      entries[op.index] = op.entry;
      return { ...data, entries };
    }
    case 'chronology_delete': {
      const sorted = [...op.indexes].sort((a, b) => b - a); // desc, so earlier indexes stay valid
      for (const idx of sorted) {
        if (idx >= entries.length) {
          throw new BadRequestException(`ops[${i}] (chronology_delete): index ${idx} out of bounds (length=${entries.length})`);
        }
        entries.splice(idx, 1);
      }
      return { ...data, entries };
    }
    case 'chronology_set_title':
      return { ...data, title: op.title };
  }
}
