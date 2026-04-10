import { IsString, IsOptional, IsBoolean, IsArray, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

const NODE_SHAPES = ['ellipse', 'rectangle', 'roundrectangle', 'diamond', 'hexagon', 'triangle'] as const;

export class NewNodeDefinition {
  @IsString()
  address: string;

  @IsString()
  chain: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  @IsIn(NODE_SHAPES)
  shape?: typeof NODE_SHAPES[number];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateGroupDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsBoolean()
  collapsed?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  nodeIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NewNodeDefinition)
  newNodes?: NewNodeDefinition[];
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsBoolean()
  collapsed?: boolean;
}
