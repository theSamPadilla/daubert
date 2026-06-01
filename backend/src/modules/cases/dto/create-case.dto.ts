import { IsString, IsOptional } from 'class-validator';

export class CreateCaseDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  summary?: string;
}
