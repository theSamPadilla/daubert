import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, type LabeledEntity } from '@/lib/api-client';

// Module-level cache shared across all component instances.
// Avoids duplicate fetches when multiple components call useLabeledEntities().
let cachedEntities: LabeledEntity[] = [];
let cachedWalletMap = new Map<string, LabeledEntity>();
let fetchPromise: Promise<void> | null = null;

async function loadEntities() {
  const data = await apiClient.listLabeledEntities();
  cachedEntities = data;
  const map = new Map<string, LabeledEntity>();
  for (const entity of data) {
    for (const wallet of entity.wallets) {
      map.set(wallet.toLowerCase(), entity);
    }
  }
  cachedWalletMap = map;
}

/**
 * Provides access to the labeled entities registry with a module-level cache.
 * The first mount triggers a fetch; subsequent mounts reuse the cached data.
 * Call `refresh()` to force a re-fetch (e.g., after admin creates a new entity).
 */
export function useLabeledEntities() {
  const [entities, setEntities] = useState<LabeledEntity[]>(cachedEntities);
  const [loading, setLoading] = useState(cachedEntities.length === 0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      fetchPromise = loadEntities();
      await fetchPromise;
      fetchPromise = null;
      if (mountedRef.current) {
        setEntities(cachedEntities);
      }
    } catch (err) {
      console.error('Failed to fetch labeled entities:', err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (cachedEntities.length > 0) {
      setEntities(cachedEntities);
      setLoading(false);
    } else if (fetchPromise) {
      fetchPromise.then(() => {
        if (mountedRef.current) {
          setEntities(cachedEntities);
          setLoading(false);
        }
      });
    } else {
      refresh();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const lookupAddress = useCallback(
    (address: string): LabeledEntity | undefined => {
      return cachedWalletMap.get(address.toLowerCase());
    },
    [],
  );

  return { entities, loading, lookupAddress, refresh };
}
