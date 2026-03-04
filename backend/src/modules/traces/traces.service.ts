import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TraceEntity } from '../../database/entities/trace.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CreateTraceDto } from './dto/create-trace.dto';
import { UpdateTraceDto } from './dto/update-trace.dto';

@Injectable()
export class TracesService {
  constructor(
    @InjectRepository(TraceEntity)
    private readonly repo: Repository<TraceEntity>,
    @InjectRepository(InvestigationEntity)
    private readonly invRepo: Repository<InvestigationEntity>,
  ) {}

  async findAllForInvestigation(investigationId: string) {
    const inv = await this.invRepo.findOneBy({ id: investigationId });
    if (!inv) throw new NotFoundException(`Investigation ${investigationId} not found`);
    return this.repo.find({
      where: { investigationId },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(id: string) {
    const trace = await this.repo.findOneBy({ id });
    if (!trace) throw new NotFoundException(`Trace ${id} not found`);
    return trace;
  }

  async create(investigationId: string, dto: CreateTraceDto) {
    const inv = await this.invRepo.findOneBy({ id: investigationId });
    if (!inv) throw new NotFoundException(`Investigation ${investigationId} not found`);

    const entity = this.repo.create({
      name: dto.name,
      color: dto.color || null,
      visible: dto.visible ?? true,
      collapsed: dto.collapsed ?? false,
      data: dto.data || {},
      investigationId,
    });
    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdateTraceDto) {
    const trace = await this.findOne(id);
    if (dto.name !== undefined) trace.name = dto.name;
    if (dto.color !== undefined) trace.color = dto.color;
    if (dto.visible !== undefined) trace.visible = dto.visible;
    if (dto.collapsed !== undefined) trace.collapsed = dto.collapsed;
    if (dto.data !== undefined) trace.data = dto.data;
    return this.repo.save(trace);
  }

  async remove(id: string) {
    const trace = await this.findOne(id);
    await this.repo.remove(trace);
  }
}
