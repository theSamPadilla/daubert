import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { DeclarationLibraryBlockKind } from '../../../database/entities/declaration-library-block.entity';

export class UpdateDeclarationLibraryBlockDto {
  @IsOptional()
  @IsEnum(DeclarationLibraryBlockKind)
  kind?: DeclarationLibraryBlockKind;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string | null;

  // Free-form JSONB blob; see CreateDeclarationLibraryBlockDto for why this is a
  // plain `@IsObject()` rather than a nested class DTO.
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;
}
