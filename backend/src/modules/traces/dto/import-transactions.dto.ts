import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  IsIn,
  ArrayMaxSize,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import type {
  SolanaContext,
  UtxoContext,
  UtxoInput,
  UtxoOutput,
} from '../../blockchain/types';

// ---------------------------------------------------------------------------
// UTXO provenance.
//
// These classes exist for ONE reason: the global pipe in main.ts runs with
// `whitelist: true`, which silently DELETES any property no class-validator
// decorator declares. An undeclared `utxo` therefore never reaches
// TracesService — the import succeeds, and the Bitcoin evidence is gone with
// no error anywhere. `import-transactions.dto.spec.ts` is the canary for that.
//
// The `implements` clauses bind these to the canonical interfaces in
// `blockchain/types.ts`; if that shape changes and these do not, the backend
// stops compiling instead of quietly dropping fields at runtime.
//
// Nullable addresses (bare scripts, unknown script types, coinbase inputs,
// OP_RETURN outputs) use `@ValidateIf(... !== null)` rather than
// `@IsOptional()`: null is a MEANINGFUL value here ("no decodable address"),
// and it must pass validation without `@IsString()` firing, while still
// registering validation metadata so `whitelist` keeps the property.
// ---------------------------------------------------------------------------

export class UtxoInputDto implements UtxoInput {
  @ValidateIf((o: UtxoInputDto) => o.address !== null)
  @IsString()
  address: string | null;

  /** Satoshis, as a decimal string. */
  @IsString()
  value: string;

  @IsString()
  prevTxid: string;

  @IsNumber()
  prevVout: number;

  @IsOptional()
  @IsString()
  scriptType?: string;

  @IsOptional()
  @IsBoolean()
  coinbase?: boolean;
}

export class UtxoOutputDto implements UtxoOutput {
  @ValidateIf((o: UtxoOutputDto) => o.address !== null)
  @IsString()
  address: string | null;

  /** Satoshis, as a decimal string. */
  @IsString()
  value: string;

  @IsNumber()
  index: number;

  @IsOptional()
  @IsString()
  scriptType?: string;

  @IsOptional()
  @IsBoolean()
  change?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  changeEvidence?: string[];

  @IsOptional()
  @IsBoolean()
  opReturn?: boolean;
}

export class UtxoContextDto implements UtxoContext {
  // 500 is deliberately generous — a 400-input consolidation is a real
  // Bitcoin transaction. The cap exists to bound the validation cost of a
  // hostile payload, not to second-guess the chain.
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UtxoInputDto)
  inputs: UtxoInputDto[];

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UtxoOutputDto)
  outputs: UtxoOutputDto[];

  /** Satoshis, as a decimal string. */
  @IsString()
  fee: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  warnings?: string[];

  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

  @IsOptional()
  @IsNumber()
  blockHeight?: number | null;

  /** Which output this edge represents (payment edges). */
  @IsOptional()
  @IsNumber()
  vout?: number;

  @IsOptional()
  @IsIn(['input', 'output'])
  legType?: 'input' | 'output';

  @IsOptional()
  @IsNumber()
  legIndex?: number;

  /** Row should materialize as a tx-junction node. */
  @IsOptional()
  @IsBoolean()
  junction?: boolean;
}

// ---------------------------------------------------------------------------
// Solana per-transfer provenance.
//
// Same whitelist hazard as the UTXO classes above, with a different loss: one
// Solana signature can carry several transfers, and `transferIndex` is what
// edgeIdentityKey() uses to tell them apart. If `solana` is not declared here,
// `whitelist: true` deletes it and every leg of a multi-transfer signature
// collapses onto one edge identity — a quietly incomplete graph, no error.
//
// No field of SolanaContext is nullable (absent means "not applicable to this
// leg"), so plain `@IsOptional()` is correct throughout — the `@ValidateIf`
// treatment the UTXO addresses need does not apply.
// ---------------------------------------------------------------------------

export class SolanaContextDto implements SolanaContext {
  /** Position in [...nativeTransfers, ...tokenTransfers] for the source tx. */
  @IsNumber()
  transferIndex: number;

  @IsString()
  feePayer: string;

  @IsIn(['native', 'spl'])
  kind: 'native' | 'spl';

  @IsOptional()
  @IsString()
  mint?: string;

  @IsOptional()
  @IsNumber()
  decimals?: number;

  /** Raw token accounts — evidentiary, kept verbatim. */
  @IsOptional()
  @IsString()
  fromTokenAccount?: string;

  @IsOptional()
  @IsString()
  toTokenAccount?: string;

  /** Helius tx type (TRANSFER, SWAP, ...). */
  @IsOptional()
  @IsString()
  type?: string;

  /** Helius source program (JUPITER, ...). */
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsNumber()
  slot?: number;

  @IsOptional()
  @IsBoolean()
  spam?: boolean;

  // The spam verdict is an INFERENCE, so its evidence strings travel with it.
  // 10 is well above the handful of heuristics detectSpam can cite and bounds
  // a hostile payload.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  spamEvidence?: string[];
}

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

  @IsOptional()
  @IsString()
  fromLabel?: string;

  @IsOptional()
  @IsString()
  toLabel?: string;

  /** Present only on rows from UTXO chains (Bitcoin). */
  @IsOptional()
  @ValidateNested()
  @Type(() => UtxoContextDto)
  utxo?: UtxoContextDto;

  /** Present only on rows from Solana. */
  @IsOptional()
  @ValidateNested()
  @Type(() => SolanaContextDto)
  solana?: SolanaContextDto;
}

export class ImportTransactionsDto {
  // Each item can itself carry up to 500+500 nested UTXO input/output rows
  // (see UtxoContextDto above), so an unbounded top-level array multiplies
  // into a very expensive nested-validation pass. 5000 is well above any
  // legitimate single import (callers batch large imports client-side) and
  // bounds the validation cost of a hostile payload.
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ImportTransactionItem)
  transactions: ImportTransactionItem[];
}
