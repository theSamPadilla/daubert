// backend/src/modules/external-trace/dto/trace-query.dto.ts
import { IsIn, IsInt, IsString, Max, Min, Matches } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ADDRESS_RE } from '../../../generated/shared/address';

const SUPPORTED_CHAINS = ['ethereum', 'polygon', 'arbitrum', 'base', 'tron', 'bitcoin', 'solana'] as const;
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

export class TraceQueryDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(ADDRESS_RE, {
    message:
      'address must be an EVM (0x…), Tron (T…), Bitcoin (1…/3…/bc1…), or Solana (base58) address',
  })
  address!: string;

  @IsIn(SUPPORTED_CHAINS as unknown as string[])
  chain!: SupportedChain;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  hops: number = 1;
}
