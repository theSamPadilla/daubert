import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient, ApiError } from '@/lib/api-client';
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
 * Every (chain, address) pair worth asking about in an investigation, deduped
 * and canonically keyed. Shared by the hook's `pairsKey` memo and by
 * `resolveAddressClassifications` (used by exhibit export, which has no live
 * hook instance to read from — see that function's doc comment).
 */
export function collectAddressPairs(investigation: Investigation): ChainAddressPair[] {
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
  return Array.from(keys).sort().map(parsePairKey);
}

/**
 * Session-scoped record of pairs we already sent to `/addresses/classify`.
 *
 * A pair the chain cannot answer for gets no row, so `lookup` keeps reporting
 * it as missing forever. Without this set, every re-mount (or every change to
 * the address set) would queue those same hopeless pairs again and burn the
 * shared rate limiter. Module-level so it survives component re-mounts, which
 * is exactly when the re-ask loop would otherwise restart.
 *
 * TRAP: only add a pair here once the server has actually looked at it (see
 * the `remaining === 0` branch in the drain loop below). A pair truncated by
 * the per-call cap, or one abandoned because the loop hit its round budget or
 * a 429, was NEVER looked at — marking it asked would starve it for the rest
 * of the session even though the chain was never given the chance to answer.
 */
const askedThisSession = new Set<string>();

/**
 * Timestamp (`Date.now()`) before which `/addresses/classify` must not be
 * called again, set after the server's shared per-IP throttle 429s us (see
 * `RATE_LIMIT_COOLDOWN_MS`). Module-level for the same reason as
 * `askedThisSession`: a remount during the cooldown must not immediately
 * retry and 429 again before the server's window has reset.
 */
let classifyCooldownUntil = 0;

/** Test hook: clears session-scoped state ("already asked" pairs and any rate-limit cooldown). */
export function __resetAddressClassificationSession(): void {
  askedThisSession.clear();
  classifyCooldownUntil = 0;
}

/**
 * Bounds the drain loop to what the server's own throttle actually permits in
 * one window (`@Throttle({ default: { limit: 10, ttl: 60_000 } })` on
 * `POST /addresses/classify`). Rounds beyond this always 429, and two
 * analysts sharing an office IP share this same budget — so this must not
 * exceed the server limit, and there is no headroom to spare.
 */
const MAX_CLASSIFY_ROUNDS = 10;

/** Mirrors the server throttle's `ttl`. After a 429, back off for a full
 * window rather than retrying instantly on the next remount — the per-IP
 * limiter has not reset yet and an immediate retry just 429s again. */
const RATE_LIMIT_COOLDOWN_MS = 60_000;

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
    return collectAddressPairs(investigation)
      .map((p) => pairKey(p.chain, p.address))
      .join(',');
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

      if (pending.length === 0) return;

      // Respect a cooldown left by a previous 429 (see RATE_LIMIT_COOLDOWN_MS)
      // — a remount within the window would just 429 again immediately, and
      // the server's per-IP throttle is shared with every other analyst and
      // tab behind the same office IP.
      if (Date.now() < classifyCooldownUntil) return;

      // Sequential, never parallel: every request queues behind one shared
      // 5 req/s limiter whose queue is unbounded and untimed, so N parallel
      // batches would hold N requests open for minutes.
      for (let round = 0; pending.length > 0 && round < MAX_CLASSIFY_ROUNDS; round++) {
        let result;
        try {
          result = await apiClient.classifyAddresses(pending);
        } catch (err) {
          if (err instanceof ApiError && err.status === 429) {
            // The server's own throttle cut us off. Stop cleanly — nothing
            // here was actually looked at, so nothing gets marked asked —
            // and remember not to hammer it again until the window resets.
            classifyCooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
            return;
          }
          console.error('Failed to classify addresses:', err);
          return;
        }
        if (cancelled) return;

        merge(result.classified);
        const done = new Set(result.classified.map((row) => pairKey(row.chain, row.address)));
        const next = pending.filter((pair) => !done.has(pairKey(pair.chain, pair.address)));

        // `remaining === 0` means the server accounted for every pair sent
        // this round — each one is now either landed (and thus in
        // `classified`) or was actually probed. So whatever's left in `next`
        // is something the chain was asked about and had nothing to say for
        // — safe to shelve for the rest of the session. A nonzero `remaining`
        // means some pairs were truncated by the per-call cap and never
        // looked at at all; those must stay eligible, so the loop keeps
        // draining instead of marking anything asked.
        if (result.remaining === 0) {
          for (const pair of next) askedThisSession.add(pairKey(pair.chain, pair.address));
          return;
        }

        pending = next;
      }

      // Round budget exhausted (a very large batch, or the throttle limit —
      // see MAX_CLASSIFY_ROUNDS) without the server ever reporting
      // `remaining === 0`. Whatever's left in `pending` was never looked at —
      // leave it alone rather than marking it asked; a later mount, or the
      // cooldown lifting, gets to pick up where this left off.
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

/** What `resolveAddressClassifications` hands back — same shape as this hook's `lookup`. */
export type AddressClassificationLookup = (
  chain: string,
  address: string,
) => AddressClassification | undefined;

/**
 * One-shot classification resolver for a single investigation, used by
 * `useGraphSnapshot` to rasterize exhibit exports whose shapes/badges must
 * agree with what the analyst sees on screen (see cytoscapeSync.ts).
 *
 * Deliberately NOT a call into the page-level `useAddressClassifications`
 * instance: that hook only ever holds data for the ONE investigation
 * currently open in the workspace, whereas an exhibit can reference ANY
 * investigation in the case — the page's instance would have nothing for the
 * others. Reaching into it would also mean calling a hook from inside an
 * async export loop, which React disallows. Instead this runs the same
 * lookup-then-drain sequence as the hook, once, and returns a plain lookup
 * function once it settles (or once it gives up — this never rejects; a
 * best-effort partial result is better than blocking the whole export).
 */
export async function resolveAddressClassifications(
  investigation: Investigation,
): Promise<AddressClassificationLookup> {
  const pairs = collectAddressPairs(investigation);
  const map = new Map<string, AddressClassification>();
  const lookup: AddressClassificationLookup = (chain, address) => map.get(pairKey(chain, address));
  if (pairs.length === 0) return lookup;

  try {
    const existing = await apiClient.lookupAddressClassifications(pairs);
    for (const row of existing) map.set(pairKey(row.chain, row.address), row);
  } catch (err) {
    console.error('Failed to look up address classifications for export:', err);
    return lookup;
  }

  let pending = pairs.filter((pair) => !map.has(pairKey(pair.chain, pair.address)));

  for (let round = 0; pending.length > 0 && round < MAX_CLASSIFY_ROUNDS; round++) {
    let result;
    try {
      result = await apiClient.classifyAddresses(pending);
    } catch (err) {
      // Best-effort: export with whatever was resolved so far rather than
      // failing the whole exhibit over a rate-limited/failed probe.
      console.error('Failed to classify addresses for export:', err);
      break;
    }
    for (const row of result.classified) map.set(pairKey(row.chain, row.address), row);
    if (result.remaining === 0) break;
    const done = new Set(result.classified.map((row) => pairKey(row.chain, row.address)));
    pending = pending.filter((pair) => !done.has(pairKey(pair.chain, pair.address)));
  }

  return lookup;
}
