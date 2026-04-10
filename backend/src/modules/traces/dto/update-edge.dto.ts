import { IsString, IsOptional, IsArray, IsUrl, IsNumber } from 'class-validator';

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
