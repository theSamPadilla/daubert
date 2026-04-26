import { IsString, IsEnum, IsObject, IsOptional } from 'class-validator';
import { ProductionType } from '../../../database/entities/production.entity';

export class UpdateProductionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ProductionType)
  type?: ProductionType;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
