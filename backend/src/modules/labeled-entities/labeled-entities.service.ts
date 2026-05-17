import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LabeledEntityEntity, EntityCategory } from '../../database/entities/labeled-entity.entity';
import { CreateLabeledEntityDto } from './dto/create-labeled-entity.dto';
import { UpdateLabeledEntityDto } from './dto/update-labeled-entity.dto';

@Injectable()
export class LabeledEntitiesService {
  constructor(
    @InjectRepository(LabeledEntityEntity)
    private readonly repo: Repository<LabeledEntityEntity>,
  ) {}

  async findAll(filters?: { category?: EntityCategory; search?: string }) {
    const qb = this.repo.createQueryBuilder('e');

    if (filters?.category) {
      qb.andWhere('e.category = :category', { category: filters.category });
    }
    if (filters?.search) {
      qb.andWhere('e.name ILIKE :search', { search: `%${filters.search}%` });
    }

    qb.orderBy('e.name', 'ASC');
    return qb.getMany();
  }

  async findOne(id: string) {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new NotFoundException(`LabeledEntity ${id} not found`);
    return entity;
  }

  /**
   * Look up entities by wallet address.
   * Wallets are stored lowercased (normalized on insert via DTO transform).
   * Query lowercases the input for a case-insensitive match.
   */
  async lookupByAddress(address: string) {
    return this.repo
      .createQueryBuilder('e')
      .where(
        `EXISTS (SELECT 1 FROM jsonb_array_elements_text(e.wallets) w WHERE w = LOWER(:address))`,
        { address: address.trim() },
      )
      .getMany();
  }

  /**
   * Bulk version of lookupByAddress. One round-trip for N addresses.
   * Returns a Map keyed by lowercased address; missing addresses are absent.
   */
  async lookupByAddresses(addresses: string[]): Promise<Map<string, LabeledEntityEntity[]>> {
    const map = new Map<string, LabeledEntityEntity[]>();
    if (addresses.length === 0) return map;

    const lowered = Array.from(
      new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean)),
    );
    if (lowered.length === 0) return map;

    // Single query: any entity whose wallets array contains any of the input addresses.
    const matches = await this.repo
      .createQueryBuilder('e')
      .where(
        `EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(e.wallets) w
           WHERE LOWER(w) = ANY(:addresses)
         )`,
        { addresses: lowered },
      )
      .getMany();

    for (const entity of matches) {
      for (const wallet of entity.wallets ?? []) {
        const w = wallet.toLowerCase();
        if (!lowered.includes(w)) continue;
        const existing = map.get(w);
        if (existing) existing.push(entity);
        else map.set(w, [entity]);
      }
    }

    return map;
  }

  async create(dto: CreateLabeledEntityDto) {
    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdateLabeledEntityDto) {
    const entity = await this.findOne(id);
    Object.assign(entity, dto);
    return this.repo.save(entity);
  }

  async remove(id: string) {
    const entity = await this.findOne(id);
    await this.repo.remove(entity);
  }
}
