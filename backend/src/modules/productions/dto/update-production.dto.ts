import { IsArray, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { ProductionType } from '../../../database/entities/production.entity';

export class UpdateProductionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ProductionType)
  type?: ProductionType;

  // Full replacement of `data`. Mutually exclusive with `ops`.
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  // Atomic operations applied in order. Mutually exclusive with `data`.
  // Validated structurally by the service per op type.
  @IsOptional()
  @IsArray()
  ops?: Record<string, unknown>[];
}
