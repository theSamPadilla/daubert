import { IsEmail, IsIn } from 'class-validator';
import { CaseRole } from '../../../database/entities/case-member.entity';

export class AddMemberDto {
  @IsEmail()
  email: string;

  @IsIn(['owner', 'editor', 'viewer'])
  role: CaseRole;
}
