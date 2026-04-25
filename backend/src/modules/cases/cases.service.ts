import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CaseEntity } from '../../database/entities/case.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { UpdateCaseDto } from './dto/update-case.dto';

@Injectable()
export class CasesService {
  constructor(
    @InjectRepository(CaseEntity)
    private readonly repo: Repository<CaseEntity>,
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
  ) {}

  async findAllForUser(user: UserEntity) {
    const memberships = await this.memberRepo.find({
      where: { userId: user.id },
      relations: ['case'],
      order: { case: { createdAt: 'DESC' } },
    });
    return memberships.map((m) => ({
      ...m.case,
      role: m.role,
    }));
  }

  async findOne(id: string) {
    const c = await this.repo.findOne({
      where: { id },
      relations: ['investigations'],
    });
    if (!c) throw new NotFoundException(`Case ${id} not found`);
    return c;
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
