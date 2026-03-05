import { Type } from 'class-transformer';
import { IsString, IsOptional, IsNumber, IsArray, ValidateNested } from 'class-validator';

export class ImportTransactionItem {
  @IsString()
  from: string;

  @IsString()
  to: string;

  @IsString()
  txHash: string;

  @IsString()
  chain: string;

  @IsString()
  timestamp: string;

  @IsString()
  amount: string;

  @IsString()
  token: string;

  @IsOptional()
  @IsNumber()
  blockNumber?: number;
}

export class ImportTransactionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportTransactionItem)
  transactions: ImportTransactionItem[];
}
