import { IsString, IsOptional, IsNumber, IsArray, IsIn } from 'class-validator';

const NODE_SHAPES = ['ellipse', 'rectangle', 'roundrectangle', 'diamond', 'hexagon', 'triangle'] as const;

export class UpdateNodeDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsNumber()
  size?: number;

  @IsOptional()
  @IsString()
  @IsIn(NODE_SHAPES)
  shape?: typeof NODE_SHAPES[number];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];
}
