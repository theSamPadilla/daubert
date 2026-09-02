import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { normalizeAddressForChain } from '@/generated/shared/address';
import type { components } from '@/generated/api-types';
import type { Investigation } from '@/types/investigation';

export type AddressClassification = components['schemas']['AddressClassification'];
type ChainAddressPair = components['schemas']['ChainAddressPair'];

/**
 * Cache key for one (chain, address) pair.
 *
 * The address half MUST go through `normalizeAddressForChain` — the server
 * keys its rows the same way (EVM lowercased, base58 case-preserved), so a
 * client that keys on the raw string will miss every EVM address a user typed
 * in checksummed form.
 */
function pairKey(chain: string, address: string): string {
  return `${chain}:${normalizeAddressForChain(address, chain)}`;
}

/** Inverse of `pairKey`. Chains and addresses never contain ':'. */
function parsePairKey(key: string): ChainAddressPair {
  const i = key.indexOf(':');
  return { chain: key.slice(0, i), address: key.slice(i + 1) };
}

/**
 * Session-scoped record of pairs we already sent to `/addresses/classify`.
 *
 * A pair the chain cannot answer for gets no row, so `lookup` keeps reporting
 * it as missing forever. Without this set, every re-mount (or every change to
 * the address set) would queue those same hopeless pairs again and burn the
 * shared rate limiter. Module-level so it survives component re-mounts, which
 * is exactly when the re-ask loop would otherwise restart.
 */
const askedThisSession = new Set<string>();

/** Test hook: clears the session-scoped "already asked" set. */
export function __resetAddressClassificationSession(): void {
  askedThisSession.clear();
}

/** Bounds the drain loop in case the server keeps reporting progress forever. */
const MAX_CLASSIFY_ROUNDS = 20;

interface ClassificationState {
  map: Map<string, AddressClassification>;
  /** Bumped on every merge. See the invalidation note on the return value. */
  version: number;
}

export interface UseAddressClassificationsResult {
  /** The row on file for a (chain, address) pair, or undefined if none. */
  lookup: (chain: string, address: string) => AddressClassification | undefined;
  /** Every row currently known, keyed by `chain:canonicalAddress`. */
  classifications: Map<string, AddressClassification>;
  /** Increments whenever rows land. Cheap dependency for consumer effects. */
  version: number;
}

/**
 * Resolves on-chain classifications (wallet vs. contract, token standard,
 * symbol/decimals) for every address in an investigation.
 *
 * Reads what is already on file in one `/addresses/lookup`, then drains the
 * misses through `/addresses/classify` — sequentially, because the server caps
 * each call and reports the shortfall as `remaining`.
 */
export function useAddressClassifications(
  investigation: Investigation | null,
): UseAddressClassificationsResult {
  const [state, setState] = useState<ClassificationState>(() => ({
    map: new Map(),
    version: 0,
  }));

  /**
   * Stable, sorted join of the canonical keys for every address in the
   * investigation.
   *
   * TRAP: do NOT key the fetch effect on `investigation` (or on any array
   * derived from it). `investigation`'s identity changes on every mutation —
   * including a node drag — so an effect keyed on it re-POSTs the whole batch
   * each time the user nudges a node. This string only changes when the actual
   * set of addresses changes.
   */
  const pairsKey = useMemo(() => {
    if (!investigation) return '';
    const keys = new Set<string>();
    for (const trace of investigation.traces ?? []) {
      for (const node of trace.nodes ?? []) {
        // txJunction nodes carry a Bitcoin transaction id in `address`, not an
        // address — classifying one is meaningless and wastes a chain call.
        if (node.kind === 'txJunction') continue;
        const address = node.address?.trim();
        if (!address) continue;
        keys.add(pairKey(node.chain, address));
      }
    }
    return Array.from(keys).sort().join(',');
  }, [investigation]);

  useEffect(() => {
    if (!pairsKey) return;

    // Rebuild the pairs from the key string rather than closing over an array
    // derived from `investigation`, so this effect's only dependency really is
    // the address set (see the TRAP note on `pairsKey`).
    const pairs = pairsKey.split(',').map(parsePairKey);

    let cancelled = false;

    const merge = (rows: AddressClassification[]) => {
      if (cancelled || rows.length === 0) return;
      setState((prev) => {
        const map = new Map(prev.map);
        for (const row of rows) {
          map.set(pairKey(row.chain, row.address), row);
        }
        return { map, version: prev.version + 1 };
      });
    };

    const run = async () => {
      let known: Set<string>;
      try {
        const existing = await apiClient.lookupAddressClassifications(pairs);
        if (cancelled) return;
        merge(existing);
        known = new Set(existing.map((row) => pairKey(row.chain, row.address)));
      } catch (err) {
        console.error('Failed to look up address classifications:', err);
        return;
      }

      let pending = pairs.filter((pair) => {
        const key = pairKey(pair.chain, pair.address);
        return !known.has(key) && !askedThisSession.has(key);
      });

      // Sequential, never parallel: every request queues behind one shared
      // 5 req/s limiter whose queue is unbounded and untimed, so N parallel
      // batches would hold N requests open for minutes.
      for (let round = 0; pending.length > 0 && round < MAX_CLASSIFY_ROUNDS; round++) {
        let result;
        try {
          result = await apiClient.classifyAddresses(pending);
        } catch (err) {
          console.error('Failed to classify addresses:', err);
          return;
        }
        if (cancelled) return;

        merge(result.classified);
        const done = new Set(result.classified.map((row) => pairKey(row.chain, row.address)));
        const next = pending.filter((pair) => !done.has(pairKey(pair.chain, pair.address)));

        // Stop when the round made no progress, or when the server says it
        // attempted everything it was given. Whatever is still missing at that
        // point is something the chain cannot answer for — record it so a
        // later pass over a superset of these addresses does not ask again.
        if (result.classified.length === 0 || result.remaining === 0) {
          for (const pair of next) askedThisSession.add(pairKey(pair.chain, pair.address));
          return;
        }

        pending = next;
      }

      for (const pair of pending) askedThisSession.add(pairKey(pair.chain, pair.address));
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [pairsKey]);

  /**
   * TRAP: `lookup`'s identity MUST change when rows land. The neighbouring
   * `useLabeledEntities` returns its `lookupAddress` as `useCallback(..., [])`
   * over a module-level Map — a permanently stable identity that never
   * invalidates a consumer. That is deliberately NOT copied here: the consumer
   * is `useCytoscape`, whose graph-sync effect keys on the identities it is
   * handed. With a `[]` dependency list nothing would re-run when
   * classifications arrive and the graph would never fill in. Keep `state` in
   * the dependency list; do not "optimise" it back to `[]`.
   */
  const lookup = useCallback(
    (chain: string, address: string): AddressClassification | undefined =>
      state.map.get(pairKey(chain, address)),
    [state],
  );

  return { lookup, classifications: state.map, version: state.version };
}
