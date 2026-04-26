import { IsIn } from 'class-validator';
import { CaseRole } from '../../../../database/entities/case-member.entity';

export class UpdateMemberRoleDto {
  @IsIn(['owner', 'guest'])
  role: CaseRole;
}
