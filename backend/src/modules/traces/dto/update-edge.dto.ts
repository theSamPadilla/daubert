import { IsString, IsOptional, IsArray, IsUrl, IsNumber, Min, Max } from 'class-validator';

export class UpdateEdgeDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  amount?: string;

  @IsOptional()
  token?: { address?: string; symbol?: string; decimals?: number };

  @IsOptional()
  @IsNumber()
  usdValue?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  lineStyle?: 'solid' | 'dashed' | 'dotted';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  width?: number;

  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  links?: string[];
}
