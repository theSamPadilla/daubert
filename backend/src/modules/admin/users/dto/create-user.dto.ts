import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { CaseRole } from '../../../../database/entities/case-member.entity';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(200)
  name: string;

  /** Optional case to add the new user to immediately. If set, `caseRole` is required. */
  @IsOptional()
  @IsUUID()
  caseId?: string;

  /** Required when `caseId` is set, ignored otherwise. */
  @ValidateIf((o) => !!o.caseId)
  @IsIn(['owner', 'guest'])
  caseRole?: CaseRole;
}
