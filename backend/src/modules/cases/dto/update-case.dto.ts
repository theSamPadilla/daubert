import { IsString, IsOptional, IsDateString } from 'class-validator';

export class UpdateCaseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;
}
