import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ADDRESS_RE } from '../../../generated/shared/address';

export class WalletSetDto {
  @ValidateIf((o: WalletSetDto) => !o.groupId && !o.wallets)
  @IsUUID()
  traceId?: string;

  @ValidateIf((o: WalletSetDto) => !o.traceId && !o.wallets)
  @IsUUID()
  groupId?: string;

  @ValidateIf((o: WalletSetDto) => !o.traceId && !o.groupId)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @Matches(ADDRESS_RE, { each: true })
  wallets?: string[];
}

export class TimeRangeDto {
  @IsOptional()
  @IsInt()
  startTimestamp?: number;

  @IsOptional()
  @IsInt()
  endTimestamp?: number;
}

export class SearchBetweenDto {
  @ValidateNested()
  @Type(() => WalletSetDto)
  sideA!: WalletSetDto;

  @ValidateNested()
  @Type(() => WalletSetDto)
  sideB!: WalletSetDto;

  @IsString()
  chain!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TimeRangeDto)
  timeRange?: TimeRangeDto;
}
