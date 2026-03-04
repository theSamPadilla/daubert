import { IsString, IsOptional } from 'class-validator';

export class CreateInvestigationDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
