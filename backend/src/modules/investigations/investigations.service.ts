import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { UpdateInvestigationDto } from './dto/update-investigation.dto';

@Injectable()
export class InvestigationsService {
  constructor(
    @InjectRepository(InvestigationEntity)
    private readonly repo: Repository<InvestigationEntity>,
    @InjectRepository(CaseEntity)
    private readonly caseRepo: Repository<CaseEntity>,
  ) {}

  async findAllForCase(caseId: string) {
    const c = await this.caseRepo.findOneBy({ id: caseId });
    if (!c) throw new NotFoundException(`Case ${caseId} not found`);
    return this.repo.find({
      where: { caseId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const inv = await this.repo.findOne({
      where: { id },
      relations: ['traces'],
    });
    if (!inv) throw new NotFoundException(`Investigation ${id} not found`);
    return inv;
  }

  async create(caseId: string, dto: CreateInvestigationDto) {
    const c = await this.caseRepo.findOneBy({ id: caseId });
    if (!c) throw new NotFoundException(`Case ${caseId} not found`);

    const entity = this.repo.create({
      name: dto.name,
      notes: dto.notes || null,
      caseId,
    });
    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdateInvestigationDto) {
    const inv = await this.findOne(id);
    if (dto.name !== undefined) inv.name = dto.name;
    if (dto.notes !== undefined) inv.notes = dto.notes;
    return this.repo.save(inv);
  }

  async remove(id: string) {
    const inv = await this.findOne(id);
    await this.repo.remove(inv);
  }
}
