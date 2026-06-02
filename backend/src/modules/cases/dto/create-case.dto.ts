import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CreateCaseDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsUUID()
  orgId: string;
}
