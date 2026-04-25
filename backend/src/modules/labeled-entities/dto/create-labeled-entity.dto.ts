import { IsString, IsEnum, IsOptional, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';
import { EntityCategory } from '../../../database/entities/labeled-entity.entity';

export class CreateLabeledEntityDto {
  @IsString()
  name: string;

  @IsEnum(EntityCategory)
  category: EntityCategory;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (value as string[]).map((w) => w.trim().toLowerCase()))
  wallets: string[];

  @IsOptional()
  metadata?: Record<string, unknown>;
}
