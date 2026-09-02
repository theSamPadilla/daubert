import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { validateAddressForChain } from '../../generated/shared/address';
import { AddressClassificationEntity } from '../../database/entities/address-classification.entity';
import { AddressClassificationsService } from './address-classifications.service';
import { AddressesDto, ChainAddressPairDto } from './dto/addresses.dto';

/** Postgres SQLSTATE for "relation does not exist". */
const UNDEFINED_TABLE = '42P01';

/**
 * Checks whether an error is Postgres "undefined_table" (42P01).
 *
 * Prod runs this code against the pre-migration schema until
 * `database/migrations/1788385406000-AddAddressClassifications.ts` is applied
 * by hand, so every read/write here would otherwise throw on the very first
 * request after deploy — including `/addresses/lookup`, which investigation
 * loads call unconditionally. Degrade to "nothing known yet" instead of a
 * hard page failure; once the migration lands, this branch simply stops
 * firing.
 *
 * Same defensive double-check as `OAuthStateBagService.isUniqueConstraintError`:
 * TypeORM surfaces this as a `QueryFailedError` and copies the driver's `code`
 * onto it, but we check both locations so detection doesn't depend on which
 * TypeORM version or driver stub is in play.
 */
function isUndefinedTableError(err: unknown): boolean {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (e['code'] === UNDEFINED_TABLE) return true;
    const driverError = e['driverError'];
    if (
      driverError !== null &&
      typeof driverError === 'object' &&
      (driverError as Record<string, unknown>)['code'] === UNDEFINED_TABLE
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Keeps only pairs that look like a real address for their claimed chain.
 * See `ChainAddressPairDto` for why this can't be enforced at the DTO layer:
 * a batch lifted off an investigation's nodes legitimately contains a
 * Bitcoin tx-junction's txid and empty-address nodes, and one bad item must
 * not sink the rest of the batch.
 */
function validPairs(pairs: ChainAddressPairDto[]): ChainAddressPairDto[] {
  return pairs.filter((p) => validateAddressForChain(p.address, p.chain) === null);
}

/**
 * The wire shape of a classification, which is deliberately NOT the entity.
 *
 * `id`, `createdAt` and `updatedAt` come from `BaseEntity` and mean nothing to a
 * client that addresses these rows by `(chain, address)`. They are also the one
 * place the two routes would otherwise disagree: `lookup` returns rows read back
 * from the database, which carry them, whereas `classify` returns freshly built
 * rows that never round-tripped, where they are undefined and vanish in
 * serialization. Projecting explicitly makes both routes return the same shape,
 * which is what the OpenAPI schema declares.
 */
function toResponse(row: AddressClassificationEntity) {
  return {
    chain: row.chain,
    address: row.address,
    addressType: row.addressType,
    tokenStandard: row.tokenStandard ?? null,
    symbol: row.symbol ?? null,
    decimals: row.decimals ?? null,
    name: row.name ?? null,
    probedAt: row.probedAt,
  };
}

/**
 * Classification registry endpoints. Not case-scoped — classifications are a
 * machine-derived fact about a (chain, address) pair, shared across every
 * case that happens to touch it — so, like `LabeledEntitiesController`, any
 * authenticated user may hit these via the app-wide `AuthGuard` and no
 * per-route role decorator is needed.
 */
@Controller('addresses')
export class AddressClassificationsController {
  constructor(private readonly service: AddressClassificationsService) {}

  @Post('lookup')
  async lookup(@Body() dto: AddressesDto) {
    try {
      const found = await this.service.lookupMany(validPairs(dto.addresses));
      return Array.from(found.values()).map(toResponse);
    } catch (err) {
      if (isUndefinedTableError(err)) return [];
      throw err;
    }
  }

  // Probing costs up to 6 rate-limited calls per address on a limiter shared
  // with fetch-history and the AI sandbox (see AddressClassificationsService),
  // so this is throttled per the ExternalTraceController/AuthEmailController
  // precedent — any authenticated user could otherwise burn that shared quota.
  @Post('classify')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async classify(@Body() dto: AddressesDto) {
    try {
      const { classified, remaining } = await this.service.classifyMissing(
        validPairs(dto.addresses),
      );
      return { classified: classified.map(toResponse), remaining };
    } catch (err) {
      if (isUndefinedTableError(err)) return { classified: [], remaining: 0 };
      throw err;
    }
  }
}
