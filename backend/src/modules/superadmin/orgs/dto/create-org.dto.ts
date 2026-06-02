import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateOrgDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric and hyphens only' })
  @MaxLength(100)
  slug?: string;

  @IsEmail()
  firstAdminEmail: string;
}
