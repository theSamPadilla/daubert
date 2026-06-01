import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCaseDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsUUID()
  ownerUserId: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;
}
