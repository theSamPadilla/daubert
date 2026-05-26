import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FONT_FAMILIES, FONT_SIZES, FontFamily, FontSize } from './render-options';

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

  // Whole-exhibit render options. Per-item overrides are deliberately not
  // supported — see the design note in this folder's commit history.
  @IsOptional() @IsIn(FONT_FAMILIES as readonly string[])
  fontFamily?: FontFamily;

  @IsOptional() @IsInt() @IsIn(FONT_SIZES as readonly number[])
  fontSize?: FontSize;
}
