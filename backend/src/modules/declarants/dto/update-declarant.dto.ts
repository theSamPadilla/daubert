import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateDeclarantDto {
  @IsOptional()
  @IsString()
  displayName?: string;

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

  // Free-form JSONB arrays; see CreateDeclarantDto for why these are bare
  // `@IsArray()` rather than nested class DTOs, and why `@Transform` (not just
  // `@IsArray()`) is required to prevent class-transformer from collapsing the
  // array's paragraph objects to `[]`.
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
