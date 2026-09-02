import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, ValidateNested } from 'class-validator';

/**
 * A single (chain, address) pair from the caller. Deliberately unconstrained
 * beyond "these are strings": the caller passes an investigation's node list
 * verbatim, which legitimately contains Bitcoin tx-junction nodes (`address`
 * holds a transaction id) and nodes with an empty `address`. Rejecting either
 * shape here would fail class-validator and 400 the *whole* batch over one
 * bad item — the controller filters those out per-item instead, via
 * `validateAddressForChain`.
 */
export class ChainAddressPairDto {
  @IsString()
  chain: string;

  @IsString()
  address: string;
}

export class AddressesDto {
  // 1000 is far more than any real investigation's node count; it exists to
  // bound the validation cost of a hostile payload, not to second-guess
  // legitimate callers.
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ChainAddressPairDto)
  addresses: ChainAddressPairDto[];
}
