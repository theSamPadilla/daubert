import { IsString, IsEnum, IsOptional, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';
import { EntityCategory } from '../../../database/entities/labeled-entity.entity';

export class UpdateLabeledEntityDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(EntityCategory)
  category?: EntityCategory;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => value ? (value as string[]).map((w) => w.trim().toLowerCase()) : value)
  wallets?: string[];

  @IsOptional()
  metadata?: Record<string, unknown>;
}
