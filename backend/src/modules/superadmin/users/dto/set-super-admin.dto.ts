import { IsBoolean } from 'class-validator';

export class SetSuperAdminDto {
  @IsBoolean()
  value: boolean;
}
