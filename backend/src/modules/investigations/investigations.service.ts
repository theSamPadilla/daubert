import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { ScriptRunEntity } from '../../database/entities/script-run.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { UpdateInvestigationDto } from './dto/update-investigation.dto';

@Injectable()
export class InvestigationsService {
  constructor(
    @InjectRepository(InvestigationEntity)
    private readonly repo: Repository<InvestigationEntity>,
    @InjectRepository(CaseEntity)
    private readonly caseRepo: Repository<CaseEntity>,
    @InjectRepository(ScriptRunEntity)
    private readonly scriptRunRepo: Repository<ScriptRunEntity>,
    private readonly caseAccess: CaseAccessService,
  ) {}

  async findAllForCase(caseId: string) {
    const c = await this.caseRepo.findOneBy({ id: caseId });
    if (!c) throw new NotFoundException(`Case ${caseId} not found`);
    return this.repo.find({
      where: { caseId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId?: string) {
    const inv = await this.repo.findOne({
      where: { id },
      relations: ['traces'],
    });
    if (!inv) throw new NotFoundException(`Investigation ${id} not found`);
    if (userId) await this.caseAccess.assertAccess(userId, inv.caseId);
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

  async update(id: string, dto: UpdateInvestigationDto, userId?: string) {
    const inv = await this.findOne(id, userId);
    if (dto.name !== undefined) inv.name = dto.name;
    if (dto.notes !== undefined) inv.notes = dto.notes;
    return this.repo.save(inv);
  }

  async remove(id: string, userId?: string) {
    const inv = await this.findOne(id, userId);
    await this.repo.remove(inv);
  }

  async listScriptRuns(investigationId: string, userId?: string) {
    await this.findOne(investigationId, userId);
    return this.scriptRunRepo.find({
      where: { investigationId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}
