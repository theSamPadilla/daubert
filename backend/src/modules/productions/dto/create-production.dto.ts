import { IsString, IsEnum, IsObject } from 'class-validator';
import { ProductionType } from '../../../database/entities/production.entity';

export class CreateProductionDto {
  @IsString()
  name: string;

  @IsEnum(ProductionType)
  type: ProductionType;

  @IsObject()
  data: Record<string, unknown>;
}
