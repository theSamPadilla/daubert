import { IsIn } from 'class-validator';
import { OrgRole } from '../../../database/entities/organization-member.entity';

export class UpdateOrgMemberRoleDto {
  @IsIn(['admin', 'member', 'guest'])
  role: OrgRole;
}
