import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ExportToDriveDto {
  @IsString() @IsNotEmpty()
  accessToken: string;

  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(25) @IsString({ each: true })
  fileIds: string[];

  @IsOptional() @IsString()
  destinationFolderId?: string | null;
}
