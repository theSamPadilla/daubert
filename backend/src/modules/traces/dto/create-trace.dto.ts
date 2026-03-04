import { IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';

export class CreateTraceDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @IsOptional()
  @IsBoolean()
  collapsed?: boolean;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
