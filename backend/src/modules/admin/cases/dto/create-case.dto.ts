import { IsArray, IsDateString, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class LinkDto {
  @IsString()
  @MaxLength(2048)
  url: string;

  @IsString()
  @MaxLength(200)
  label: string;
}

export class CreateCaseDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsUUID()
  ownerUserId: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkDto)
  links?: LinkDto[];
}
