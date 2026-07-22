import { Transform } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDeclarantDto {
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @IsOptional()
  @IsString()
  title?: string | null;

  @IsOptional()
  @IsString()
  firm?: string | null;

  @IsOptional()
  @IsString()
  cvExhibit?: string | null;

  @IsOptional()
  @IsString()
  hourlyRate?: string | null;

  @IsOptional()
  @IsString()
  nonContingencyDisclosure?: string | null;

  @IsOptional()
  @IsString()
  dateOfBirth?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  // Free-form JSONB arrays (`qualifications` = paragraph objects, `priorTestimony`
  // = strings). Validated as bare arrays and normalized in the service — do NOT
  // wrap them in nested class DTOs: under the global `whitelist`/`transform`
  // ValidationPipe, class-transformer recurses into the un-decorated paragraph
  // objects and collapses each one to `[]`, corrupting the stored content.
  // The `@Transform` below passes the RAW source value straight through
  // (bypassing class-transformer's per-element conversion of the array), which
  // is what actually prevents the collapse — the bare `@IsArray()` alone is not
  // enough, since class-transformer still recurses into the array's elements.
  @IsOptional()
  @IsArray()
  @Transform(({ obj }) => obj.qualifications, { toClassOnly: true })
  qualifications?: unknown[];

  @IsOptional()
  @IsArray()
  @Transform(({ obj }) => obj.priorTestimony, { toClassOnly: true })
  priorTestimony?: unknown[];

  @IsOptional()
  @IsString()
  userId?: string | null;
}
