import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequireSuperAdmin } from '../../auth/require-super-admin.decorator';
import { CaseEntity } from '../../../database/entities/case.entity';

@Controller('superadmin/cases')
@RequireSuperAdmin()
export class SuperadminCasesController {
  constructor(
    @InjectRepository(CaseEntity)
    private readonly caseRepo: Repository<CaseEntity>,
  ) {}

  @Get()
  async findAll(): Promise<Array<{ id: string; name: string; orgId: string; orgName: string; memberCount: number; createdAt: Date }>> {
    const cases = await this.caseRepo.find({ relations: ['organization', 'members'] });
    return cases.map((c) => ({
      id: c.id,
      name: c.name,
      orgId: c.orgId,
      orgName: c.organization?.name ?? '',
      memberCount: c.members?.length ?? 0,
      createdAt: c.createdAt,
    }));
  }
}
