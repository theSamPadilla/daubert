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
