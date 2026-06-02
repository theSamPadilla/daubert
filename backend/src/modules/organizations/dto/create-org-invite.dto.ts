import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { OrgInviteRole } from '../../../database/entities/organization-invite.entity';

export class CreateOrgInviteDto {
  @IsEmail()
  email: string;

  @IsIn(['member', 'guest'])
  role: OrgInviteRole;

  @IsOptional()
  @IsString()
  message?: string;
}
