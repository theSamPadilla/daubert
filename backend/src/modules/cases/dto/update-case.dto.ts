import { IsString, IsOptional, ValidateIf } from 'class-validator';

export class UpdateCaseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @ValidateIf((o) => o.summary !== null)
  @IsOptional()
  @IsString()
  summary?: string | null;
}
