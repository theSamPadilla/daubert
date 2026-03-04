import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaseEntity } from '../../database/entities/case.entity';
import { UsersService } from '../users/users.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { UpdateCaseDto } from './dto/update-case.dto';

@Injectable()
export class CasesService {
  constructor(
    @InjectRepository(CaseEntity)
    private readonly repo: Repository<CaseEntity>,
    private readonly usersService: UsersService,
  ) {}

  async findAll() {
    const user = await this.usersService.getDefaultUser();
    return this.repo.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const c = await this.repo.findOne({
      where: { id },
      relations: ['investigations'],
    });
    if (!c) throw new NotFoundException(`Case ${id} not found`);
    return c;
  }

  async create(dto: CreateCaseDto) {
    const user = await this.usersService.getDefaultUser();
    const entity = this.repo.create({
      name: dto.name,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      links: dto.links || [],
      userId: user.id,
    });
    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdateCaseDto) {
    const c = await this.findOne(id);
    if (dto.name !== undefined) c.name = dto.name;
    if (dto.startDate !== undefined) c.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.links !== undefined) c.links = dto.links;
    return this.repo.save(c);
  }

  async remove(id: string) {
    const c = await this.findOne(id);
    await this.repo.remove(c);
  }
}
