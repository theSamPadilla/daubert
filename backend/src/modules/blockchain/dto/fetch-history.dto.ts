import { IsString, IsOptional, IsNumber, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class FetchHistoryOptions {
  @IsOptional()
  @IsNumber()
  startBlock?: number;

  @IsOptional()
  @IsNumber()
  endBlock?: number;

  @IsOptional()
  @IsNumber()
  page?: number;

  @IsOptional()
  @IsNumber()
  offset?: number;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';
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
