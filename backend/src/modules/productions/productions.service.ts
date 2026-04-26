import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductionEntity, ProductionType } from '../../database/entities/production.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { CreateProductionDto } from './dto/create-production.dto';
import { UpdateProductionDto } from './dto/update-production.dto';

@Injectable()
export class ProductionsService {
  constructor(
    @InjectRepository(ProductionEntity)
    private readonly repo: Repository<ProductionEntity>,
    private readonly caseAccess: CaseAccessService,
  ) {}

  async findAllForCase(caseId: string, userId?: string, type?: ProductionType) {
    if (userId) await this.caseAccess.assertAccess(userId, caseId);
    const where: any = { caseId };
    if (type) where.type = type;
    return this.repo.find({ where, order: { createdAt: 'ASC' } });
  }

  async findOne(id: string, userId?: string) {
    const production = await this.repo.findOneBy({ id });
    if (!production) throw new NotFoundException(`Production ${id} not found`);
    if (userId) await this.caseAccess.assertAccess(userId, production.caseId);
    return production;
  }

  async create(caseId: string, dto: CreateProductionDto, userId?: string) {
    if (userId) await this.caseAccess.assertAccess(userId, caseId);
    const production = this.repo.create({ ...dto, caseId });
    return this.repo.save(production);
  }

  async update(id: string, dto: UpdateProductionDto, userId?: string) {
    const production = await this.findOne(id, userId);
    Object.assign(production, dto);
    return this.repo.save(production);
  }

  async remove(id: string, userId?: string) {
    const production = await this.findOne(id, userId);
    await this.repo.remove(production);
  }
}
