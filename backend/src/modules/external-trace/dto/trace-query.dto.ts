// backend/src/modules/external-trace/dto/trace-query.dto.ts
import { IsIn, IsInt, IsString, Max, Min, Matches } from 'class-validator';
import { Transform, Type } from 'class-transformer';

const SUPPORTED_CHAINS = ['ethereum', 'polygon', 'arbitrum', 'base', 'tron'] as const;
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

export class TraceQueryDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^(0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33})$/, {
    message: 'address must be an EVM (0x + 40 hex) or Tron (base58, 34 chars starting with T) address',
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
