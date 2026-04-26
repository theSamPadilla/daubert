import { IsIn, IsUUID } from 'class-validator';
import { CaseRole } from '../../../../database/entities/case-member.entity';

export class AddMemberDto {
  @IsUUID()
  userId: string;

  @IsIn(['owner', 'guest'])
  role: CaseRole;
}
