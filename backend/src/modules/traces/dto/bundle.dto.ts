import { IsString, IsOptional, IsBoolean, IsArray, ArrayNotEmpty, IsNumber, Min, Max } from 'class-validator';

export class CreateEdgeBundleDto {
  @IsString()
  fromNodeId: string;

  @IsString()
  toNodeId: string;

  @IsString()
  token: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  edgeIds: string[];

  @IsOptional()
  @IsBoolean()
  collapsed?: boolean;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  width?: number;
}

export class UpdateEdgeBundleDto {
  @IsOptional()
  @IsString()
  fromNodeId?: string;

  @IsOptional()
  @IsString()
  toNodeId?: string;

  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  edgeIds?: string[];

  @IsOptional()
  @IsBoolean()
  collapsed?: boolean;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  width?: number;
}
