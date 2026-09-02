import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AddressClassificationEntity } from '../../database/entities/address-classification.entity';
import { ProviderRegistry } from '../blockchain/provider-registry';
import { ContractClassification } from '../blockchain/contract-classifier';
import { chainFamily } from '../../generated/shared/chains';
import { normalizeAddressForChain } from '../../generated/shared/address';

export interface ChainAddressPair {
  chain: string;
  address: string;
}

/**
 * Classification costs up to 6 rate-limited calls per address on a limiter
 * shared with fetch-history and the agent sandbox, so this is capped rather than
 * unbounded. `remaining` is returned explicitly: silent truncation would leave
 * the caller with no termination condition.
 */
const MAX_CLASSIFY_PER_REQUEST = 25;

/**
 * How many addresses this service probes at once. Deliberately small: probes
 * share the same rate-limited bucket as fetch-history and the agent sandbox
 * (see ProviderRegistry), so a wide pool here just starves those callers
 * without classifying any faster — the bucket is the real bottleneck.
 */
const PROBE_CONCURRENCY = 5;

/** Postgres SQLSTATE for "relation does not exist". */
const UNDEFINED_TABLE = '42P01';

/**
 * True when an error is Postgres "undefined_table" (42P01).
 *
 * This lives in the SERVICE, not in a caller, because the service is the only
 * thing that touches `address_classifications` — so every consumer (the HTTP
 * controller, the AI chat tool, the MCP read tool) inherits the same
 * degradation without having to remember it. A caller that forgot would take
 * down whatever surrounds it: the AI chat path awaits its tool call with no
 * catch, so an unguarded throw there aborts the entire response stream rather
 * than one tool.
 *
 * The window this covers is real and expected: prod runs this code against the
 * pre-migration schema until `1788385406000-AddAddressClassifications.ts` is
 * applied by hand. Degrade to "nothing known yet" and the graph simply keeps
 * its stored values.
 *
 * Checks both locations for the same reason as
 * `OAuthStateBagService.isUniqueConstraintError`: TypeORM copies the driver
 * code onto `QueryFailedError`, but not in every version or driver stub.
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
 * The one canonical map key for a (chain, address) pair, used by every caller
 * so lookups and writes never disagree on what "the same address" means.
 * Always route through `normalizeAddressForChain` rather than re-lowercasing —
 * Tron and Bitcoin addresses are case-sensitive base58.
 */
export function classificationKey(chain: string, address: string): string {
  return `${chain}:${normalizeAddressForChain(address, chain)}`;
}

/** Runs `worker` over `items` with at most `limit` in flight at once. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

@Injectable()
export class AddressClassificationsService {
  constructor(
    @InjectRepository(AddressClassificationEntity)
    private readonly repo: Repository<AddressClassificationEntity>,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  /**
   * Bulk lookup, keyed canonically. One round-trip for N pairs; missing pairs
   * are simply absent from the result rather than represented some other way.
   */
  /**
   * Every caller is protected from the pre-migration window here rather than at
   * its own call site — see `isUndefinedTableError`.
   */
  async lookupMany(pairs: ChainAddressPair[]): Promise<Map<string, AddressClassificationEntity>> {
    try {
      return await this.lookupManyImpl(pairs);
    } catch (err) {
      if (isUndefinedTableError(err)) return new Map();
      throw err;
    }
  }

  async classifyMissing(
    pairs: ChainAddressPair[],
    cap = MAX_CLASSIFY_PER_REQUEST,
  ): Promise<{ classified: AddressClassificationEntity[]; remaining: number }> {
    try {
      return await this.classifyMissingImpl(pairs, cap);
    } catch (err) {
      if (isUndefinedTableError(err)) return { classified: [], remaining: 0 };
      throw err;
    }
  }

  private async lookupManyImpl(pairs: ChainAddressPair[]): Promise<Map<string, AddressClassificationEntity>> {
    const result = new Map<string, AddressClassificationEntity>();
    if (pairs.length === 0) return result;

    // Dedup and normalize up front so the query and the map key never diverge.
    const byKey = new Map<string, ChainAddressPair>();
    for (const { chain, address } of pairs) {
      byKey.set(classificationKey(chain, address), {
        chain,
        address: normalizeAddressForChain(address, chain),
      });
    }

    const normalized = Array.from(byKey.values());
    const params: Record<string, string> = {};
    const tuples = normalized.map((pair, i) => {
      params[`chain${i}`] = pair.chain;
      params[`address${i}`] = pair.address;
      return `(:chain${i}, :address${i})`;
    });

    const rows = await this.repo
      .createQueryBuilder('c')
      .where(`(c.chain, c.address) IN (${tuples.join(', ')})`, params)
      .getMany();

    for (const row of rows) {
      result.set(classificationKey(row.chain, row.address), row);
    }
    return result;
  }

  /**
   * Classifies whichever of `pairs` are not already on record, up to `cap`.
   * See MAX_CLASSIFY_PER_REQUEST for why this is bounded, and the module-level
   * comments for the load-bearing order of operations.
   */
  private async classifyMissingImpl(
    pairs: ChainAddressPair[],
    cap = MAX_CLASSIFY_PER_REQUEST,
  ): Promise<{ classified: AddressClassificationEntity[]; remaining: number }> {
    // 1. Non-EVM pairs are dropped before anything else — bitcoin/solana route
    // through different provider interfaces (ProviderRegistry.get() throws for
    // them), and Tron reports determined: false anyway. They never count
    // toward `remaining`, since we never intended to classify them here.
    const evmPairs = pairs.filter((p) => chainFamily(p.chain) === 'evm');

    const byKey = new Map<string, ChainAddressPair>();
    for (const { chain, address } of evmPairs) {
      const key = classificationKey(chain, address);
      if (!byKey.has(key)) {
        byKey.set(key, { chain, address: normalizeAddressForChain(address, chain) });
      }
    }

    const unique = Array.from(byKey.entries());
    if (unique.length === 0) return { classified: [], remaining: 0 };

    // 2. Re-SELECT ALL requested keys — not just a capped slice — immediately
    // before probing. Another instance may have landed some of them since the
    // caller's own lookup; this collapses the common sequential-arrival case
    // across Cloud Run instances. Landed rows are reported back in
    // `classified` (below) so a caller can tell "already on file" from
    // "could not answer" — and, critically, the cap/remaining math below is
    // computed AFTER this filter, so a landed pair never eats a cap slot or
    // inflates `remaining` for pairs nobody has looked at yet.
    const alreadyLanded = await this.lookupMany(unique.map(([, pair]) => pair));
    const landed = unique.filter(([key]) => alreadyLanded.has(key));
    const notLanded = unique.filter(([key]) => !alreadyLanded.has(key));

    const remaining = Math.max(0, notLanded.length - cap);
    const toProbe = notLanded.slice(0, cap);

    const classified: AddressClassificationEntity[] = landed.map(([key]) => alreadyLanded.get(key)!);
    if (toProbe.length === 0) return { classified, remaining };

    // 3. Probe the remainder with bounded concurrency.
    await runWithConcurrency(toProbe, PROBE_CONCURRENCY, async ([, pair]) => {
      let probed: { classification: ContractClassification; determined: boolean };
      try {
        probed = await this.providerRegistry.get(pair.chain).classifyAddress(pair.address);
      } catch {
        // 6. A probe that throws is skipped, not fatal — one bad address must
        // not lose the batch.
        return;
      }

      // 4. Persist only determined === true. Absence means "not yet asked",
      // never "asked and got nothing" — this is what keeps unreachable probes
      // out of a table the whole system trusts.
      if (!probed.determined) return;

      const entity = this.repo.create({
        chain: pair.chain,
        address: pair.address,
        addressType: probed.classification.addressType,
        tokenStandard: probed.classification.tokenStandard ?? null,
        symbol: probed.classification.symbol ?? null,
        decimals: probed.classification.decimals ?? null,
        name: probed.classification.name ?? null,
        probedAt: new Date(),
      });

      // 5. ON CONFLICT DO NOTHING: concurrent probing across instances is
      // wasteful but never incorrect.
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(AddressClassificationEntity)
        .values(entity)
        .onConflict('("chain", "address") DO NOTHING')
        .execute();

      classified.push(entity);
    });

    return { classified, remaining };
  }
}
