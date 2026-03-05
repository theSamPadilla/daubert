import { IsString } from 'class-validator';

export class GetTransactionDto {
  @IsString()
  txHash: string;

  @IsString()
  chain: string;
}
