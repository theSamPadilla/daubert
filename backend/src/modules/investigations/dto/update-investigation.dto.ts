import { IsString, IsOptional } from 'class-validator';

export class UpdateInvestigationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
