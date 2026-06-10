import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
} from 'class-validator';

export class ImportFromDriveDto {
  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  fileIds: string[];
}
