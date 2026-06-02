import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { InviteRole } from '../../../database/entities/case-invite.entity';

export class CreateInviteDto {
  @IsEmail()
  email: string;

  @IsIn(['owner', 'editor', 'viewer'])
  role: InviteRole;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
