import { IsString, IsOptional, IsNumber, IsIn, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';

class FetchHistoryOptions {
  @IsOptional()
  @IsNumber()
  startBlock?: number;

  @IsOptional()
  @IsNumber()
  endBlock?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string;

  @IsOptional()
  @IsNumber()
  page?: number;

  @IsOptional()
  @IsNumber()
  offset?: number;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';

  @IsOptional()
  @IsNumber()
  maxTotal?: number;
}

export class FetchHistoryDto {
  @IsString()
  address: string;

  @IsString()
  chain: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FetchHistoryOptions)
  options?: FetchHistoryOptions;
}
