import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ExhibitItemDto {
  @IsIn(['production', 'investigation'])
  refType!: 'production' | 'investigation';

  @IsUUID()
  refId!: string;

  @IsString() @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(300)
  subtitle?: string;

  // PNG data URL for investigations (graph snapshot).
  // Also accepted for chart productions (client-captured canvas).
  @IsOptional() @IsString()
  imageDataUrl?: string;
}

export class ExportExhibitDto {
  @IsString() @MaxLength(200)
  filename!: string;

  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ExhibitItemDto)
  items!: ExhibitItemDto[];
}
