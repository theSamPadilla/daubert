import {
  IsOptional,
  IsString,
  IsNotEmpty,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  parentFolderId?: string | null;
}

export class MoveRequestDto {
  @ValidateIf((o) => o.targetFolderId !== null)
  @IsString()
  targetFolderId: string | null;
}
