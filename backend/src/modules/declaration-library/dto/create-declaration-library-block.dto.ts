import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { DeclarationLibraryBlockKind } from '../../../database/entities/declaration-library-block.entity';

export class CreateDeclarationLibraryBlockDto {
  @IsEnum(DeclarationLibraryBlockKind)
  kind: DeclarationLibraryBlockKind;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  category?: string | null;

  // Free-form JSONB blob (`{ paragraphs: DeclarationParagraph[] }`). Validated as
  // an opaque object here and normalized in the service — do NOT wrap it in a
  // nested class DTO: under the global `whitelist`/`transform` ValidationPipe,
  // class-transformer recurses into the un-decorated paragraph objects and
  // collapses each one to `[]`, corrupting the stored content.
  @IsObject()
  content: Record<string, unknown>;
}
