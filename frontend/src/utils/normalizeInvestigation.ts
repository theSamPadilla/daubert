import type { Investigation as ApiInvestigation } from '@/lib/api-client';
import type { Investigation } from '@/types/investigation';
import { parseAddressInput, buildExplorerUrl } from '@/utils/addressParser';

/**
 * Converts an API-layer Investigation (where trace graph data lives inside
 * `trace.data` as a JSONB blob) to the client-layer Investigation shape
 * expected by GraphCanvas / cytoscapeSync (where nodes/edges/groups/etc. are
 * top-level fields on each trace).
 *
 * This is the single source of truth for that transform; both the
 * investigations page and ExhibitBuilder use it.
 */
export function normalizeInvestigation(inv: ApiInvestigation): Investigation {
  return {
    id: inv.id,
    name: inv.name,
    description: inv.notes || '',
    createdAt: inv.createdAt,
    traces: (inv.traces || []).map((t) => ({
      id: t.id,
      name: t.name,
      criteria: (t.data as any)?.criteria || { type: 'custom' as const },
      visible: t.visible,
      collapsed: t.collapsed,
      color: t.color || undefined,
      nodes: ((t.data as any)?.nodes || []).map((n: any) => {
        const parsed = parseAddressInput(n.address);
        const address = parsed.chain ? parsed.address : n.address;
        const chain = parsed.chain || n.chain;
        return {
          ...n,
          address,
          chain,
          explorerUrl: n.explorerUrl || parsed.explorerUrl || buildExplorerUrl(chain, address),
          addressType: n.addressType || 'unknown',
        };
      }),
      edges: (t.data as any)?.edges || [],
      groups: (t.data as any)?.groups || [],
      edgeBundles: (t.data as any)?.edgeBundles || [],
      position: (t.data as any)?.position || { x: 0, y: 0 },
    })),
    metadata: {},
  };
}
