import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateCaseDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;
}
