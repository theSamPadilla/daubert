import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrgInviteRole } from '../../../database/entities/organization-invite.entity';

export class CreateOrgInviteDto {
  @IsEmail()
  email: string;

  @IsIn(['member', 'guest'])
  role: OrgInviteRole;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  message?: string;
}
