import { IsEmail, IsIn } from 'class-validator';
import { OrgRole } from '../../../database/entities/organization-member.entity';

export class AddOrgMemberDto {
  @IsEmail()
  email: string;

  @IsIn(['admin', 'member', 'guest'])
  role: OrgRole;
}
