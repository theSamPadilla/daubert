import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductionEntity, ProductionType } from '../../database/entities/production.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { AccessPrincipal } from '../auth/access-principal';
import { CreateProductionDto } from './dto/create-production.dto';
import { UpdateProductionDto } from './dto/update-production.dto';

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
    const production = await this.findOne(id, principal);
    Object.assign(production, dto);
    return this.repo.save(production);
  }

  async remove(id: string, principal: AccessPrincipal) {
    const production = await this.findOne(id, principal);
    await this.repo.remove(production);
  }
}
