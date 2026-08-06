import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { TraceEntity } from '../../database/entities/trace.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { AccessPrincipal } from '../auth/access-principal';
import { CaseRole } from '../../database/entities/case-member.entity';
import { FetchOptions } from '../blockchain/types';
import { BlockchainService, TransactionResult } from '../blockchain/blockchain.service';
import { explorerAddressUrl, explorerTxUrl } from '../../generated/shared/chains';
import { CreateTraceDto } from './dto/create-trace.dto';
import { UpdateTraceDto } from './dto/update-trace.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { UpdateEdgeDto } from './dto/update-edge.dto';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';
import { CreateEdgeBundleDto, UpdateEdgeBundleDto } from './dto/bundle.dto';
import { ImportTransactionItem, ImportTransactionsDto } from './dto/import-transactions.dto';
import { SearchBetweenDto, WalletSetDto } from './dto/search-between.dto';
import { normalizeAddressForChain } from '../../generated/shared/address';
import { edgeIdentityKey } from '../../generated/shared/edge-identity';
import { planJunction } from '../../generated/shared/utxo';
import { normalizeLabels } from './label-schema';

/**
 * Canonical lookup key for an address.
 *
 * Trimmed AND lowercased. Lowercasing alone is not enough: the PERSISTED value
 * is chain-aware (`normalizeAddressForChain` trims, and preserves case for
 * Bitcoin and Tron), so a key that does not also trim puts `'  bc1q…  '` and
 * `'bc1q…'` under two different keys — and mints two nodes whose stored
 * `address` is byte-identical. Every map key, membership test, and endpoint
 * lookup in the import path must go through this one function; a single site
 * keying differently resolves to `undefined` and silently drops the edge.
 */
function addressKey(addr: string): string {
  return addr.trim().toLowerCase();
}

@Injectable()
export class TracesService {
  private static readonly WALLET_CAP_PER_SIDE = 25;

  constructor(
    @InjectRepository(TraceEntity)
    private readonly repo: Repository<TraceEntity>,
    @InjectRepository(InvestigationEntity)
    private readonly invRepo: Repository<InvestigationEntity>,
    private readonly caseAccess: CaseAccessService,
    private readonly blockchainService: BlockchainService,
  ) {}

  async findAllForInvestigation(investigationId: string, principal: AccessPrincipal) {
    const inv = await this.invRepo.findOneBy({ id: investigationId });
    if (!inv) throw new NotFoundException(`Investigation ${investigationId} not found`);
    await this.caseAccess.assertRole(principal, inv.caseId, 'viewer');
    return this.repo.find({
      where: { investigationId },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(id: string, principal: AccessPrincipal, minRole: CaseRole = 'viewer') {
    const trace = await this.repo.findOneBy({ id });
    if (!trace) throw new NotFoundException(`Trace ${id} not found`);
    const inv = await this.invRepo.findOneBy({ id: trace.investigationId });
    if (!inv) throw new NotFoundException(`Investigation ${trace.investigationId} not found`);
    await this.caseAccess.assertRole(principal, inv.caseId, minRole);
    return trace;
  }

  async create(investigationId: string, dto: CreateTraceDto, principal: AccessPrincipal) {
    const inv = await this.invRepo.findOneBy({ id: investigationId });
    if (!inv) throw new NotFoundException(`Investigation ${investigationId} not found`);
    await this.caseAccess.assertRole(principal, inv.caseId, 'editor');

    let data: any = dto.data || {};
    if ('labels' in data) {
      try {
        data = { ...data, labels: normalizeLabels((data as any).labels) };
      } catch (err) {
        throw new BadRequestException(`Invalid labels: ${(err as Error).message}`);
      }
    }

    const entity = this.repo.create({
      name: dto.name,
      color: dto.color || null,
      visible: dto.visible ?? true,
      collapsed: dto.collapsed ?? false,
      data,
      investigationId,
    });
    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdateTraceDto, principal: AccessPrincipal) {
    const trace = await this.findOne(id, principal, 'editor');
    if (dto.name !== undefined) trace.name = dto.name;
    if (dto.color !== undefined) trace.color = dto.color;
    if (dto.visible !== undefined) trace.visible = dto.visible;
    if (dto.collapsed !== undefined) trace.collapsed = dto.collapsed;
    if (dto.data !== undefined) {
      let data: any = dto.data;
      if ('labels' in data) {
        try {
          data = { ...data, labels: normalizeLabels((data as any).labels) };
        } catch (err) {
          throw new BadRequestException(`Invalid labels: ${(err as Error).message}`);
        }
      }
      trace.data = data;
    }
    return this.repo.save(trace);
  }

  async remove(id: string, principal: AccessPrincipal) {
    const trace = await this.findOne(id, principal, 'editor');
    await this.repo.remove(trace);
  }

  async updateNode(traceId: string, nodeId: string, dto: UpdateNodeDto, principal: AccessPrincipal) {
    const trace = await this.findOne(traceId, principal, 'editor');
    const data = (trace.data || {}) as { nodes?: any[]; edges?: any[] };
    const nodes: any[] = data.nodes || [];
    const idx = nodes.findIndex((n) => n.id === nodeId);
    if (idx === -1) throw new NotFoundException(`Node ${nodeId} not found in trace ${traceId}`);
    nodes[idx] = { ...nodes[idx], ...dto };
    trace.data = { ...data, nodes };
    await this.repo.save(trace);
    return nodes[idx];
  }

  async updateEdge(traceId: string, edgeId: string, dto: UpdateEdgeDto, principal: AccessPrincipal) {
    const trace = await this.findOne(traceId, principal, 'editor');
    const data = (trace.data || {}) as { nodes?: any[]; edges?: any[] };
    const edges: any[] = data.edges || [];
    const idx = edges.findIndex((e) => e.id === edgeId);
    if (idx === -1) throw new NotFoundException(`Edge ${edgeId} not found in trace ${traceId}`);
    const { token, ...rest } = dto;
    const updated = { ...edges[idx], ...rest };
    if (token !== undefined) {
      updated.token = { ...(edges[idx].token || {}), ...token };
    }
    edges[idx] = updated;
    trace.data = { ...data, edges };
    await this.repo.save(trace);
    return edges[idx];
  }

  async deleteNode(traceId: string, nodeId: string, principal: AccessPrincipal) {
    const trace = await this.findOne(traceId, principal, 'editor');
    const data = (trace.data || {}) as { nodes?: any[]; edges?: any[] };
    const nodes: any[] = data.nodes || [];
    const edges: any[] = data.edges || [];
    if (!nodes.some((n) => n.id === nodeId)) throw new NotFoundException(`Node ${nodeId} not found in trace ${traceId}`);
    trace.data = {
      ...data,
      nodes: nodes.filter((n) => n.id !== nodeId),
      edges: edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
    };
    await this.repo.save(trace);
  }

  async deleteEdge(traceId: string, edgeId: string, principal: AccessPrincipal) {
    const trace = await this.findOne(traceId, principal, 'editor');
    const data = (trace.data || {}) as { edges?: any[]; edgeBundles?: any[] };
    const edges: any[] = data.edges || [];
    if (!edges.some((e) => e.id === edgeId)) throw new NotFoundException(`Edge ${edgeId} not found in trace ${traceId}`);
    // Also remove from any edge bundles that reference this edge
    const edgeBundles = (data.edgeBundles || []).map((b: any) => ({
      ...b,
      edgeIds: b.edgeIds.filter((id: string) => id !== edgeId),
    })).filter((b: any) => b.edgeIds.length > 0);
    trace.data = {
      ...data,
      edges: edges.filter((e) => e.id !== edgeId),
      edgeBundles,
    };
    await this.repo.save(trace);
  }

  async createGroup(traceId: string, dto: CreateGroupDto, principal: AccessPrincipal) {
    const trace = await this.findOne(traceId, principal, 'editor');
    const data = (trace.data || {}) as { nodes?: any[]; groups?: any[] };
    const nodes: any[] = data.nodes || [];
    const groups: any[] = data.groups || [];

    const group = {
      id: crypto.randomUUID(),
      name: dto.name,
      color: dto.color || null,
      traceId,
      collapsed: dto.collapsed ?? false,
    };

    // Validate existing nodeIds
    const existingIds = new Set(dto.nodeIds || []);
    const nodeSet = new Set(nodes.map((n) => n.id));
    for (const nid of existingIds) {
      if (!nodeSet.has(nid)) throw new NotFoundException(`Node ${nid} not found in trace ${traceId}`);
    }

    // Create new nodes inline
    const createdIds: string[] = [];
    if (dto.newNodes?.length) {
      const existingAddresses = new Set(nodes.map((n) => n.address?.toLowerCase()));
      const addressToId = new Map(nodes.map((n) => [n.address?.toLowerCase(), n.id]));

      let maxX = nodes.reduce((m, n) => Math.max(m, n.position?.x || 0), 0);
      let placed = 0;

      for (const def of dto.newNodes) {
        const addrKey = def.address.toLowerCase();
        if (existingAddresses.has(addrKey)) {
          // Address already exists — just add to group
          createdIds.push(addressToId.get(addrKey)!);
          continue;
        }

        const explorerUrl = explorerAddressUrl(def.chain, def.address);

        const nodeId = crypto.randomUUID();
        const x = maxX + 150 + Math.floor(placed / 5) * 150;
        const y = 100 + (placed % 5) * 100;
        placed++;

        const defaultLabel = `${def.address.slice(0, 6)}…${def.address.slice(-4)}`;
        nodes.push({
          id: nodeId,
          label: def.label || defaultLabel,
          address: def.address,
          chain: def.chain,
          color: def.color || null,
          notes: def.notes || '',
          tags: [],
          position: { x, y },
          parentTrace: traceId,
          addressType: 'unknown',
          explorerUrl,
        });

        existingAddresses.add(addrKey);
        addressToId.set(addrKey, nodeId);
        createdIds.push(nodeId);
      }
    }

    // Assign groupId on all member nodes (existing + newly created)
    const allMemberIds = new Set([...existingIds, ...createdIds]);
    const updatedNodes = nodes.map((n) =>
      allMemberIds.has(n.id) ? { ...n, groupId: group.id } : n,
    );

    trace.data = { ...data, nodes: updatedNodes, groups: [...groups, group] };
    await this.repo.save(trace);
    return { ...group, nodeIds: [...allMemberIds] };
  }

  async updateGroup(traceId: string, groupId: string, dto: UpdateGroupDto, principal: AccessPrincipal) {
    const trace = await this.findOne(traceId, principal, 'editor');
    const data = (trace.data || {}) as { groups?: any[] };
    const groups: any[] = data.groups || [];
    const idx = groups.findIndex((g) => g.id === groupId);
    if (idx === -1) throw new NotFoundException(`Group ${groupId} not found in trace ${traceId}`);
    groups[idx] = { ...groups[idx], ...dto };
    trace.data = { ...data, groups };
    await this.repo.save(trace);
    return groups[idx];
  }

  async deleteGroup(traceId: string, groupId: string, principal: AccessPrincipal) {
    const trace = await this.findOne(traceId, principal, 'editor');
    const data = (trace.data || {}) as { nodes?: any[]; groups?: any[] };
    const groups: any[] = data.groups || [];
    if (!groups.some((g) => g.id === groupId)) throw new NotFoundException(`Group ${groupId} not found in trace ${traceId}`);

    // Remove groupId from member nodes
    const updatedNodes = (data.nodes || []).map((n) =>
      n.groupId === groupId ? { ...n, groupId: undefined } : n,
    );

    trace.data = { ...data, nodes: updatedNodes, groups: groups.filter((g) => g.id !== groupId) };
    await this.repo.save(trace);
  }

  async listEdgeBundles(traceId: string, principal: AccessPrincipal) {
    const trace = await this.findOne(traceId, principal);
    const data = (trace.data || {}) as { edgeBundles?: any[] };
    return data.edgeBundles || [];
  }

  // Bundles are investigation-scoped, not trace-scoped: a bundle stored in
  // trace X can legitimately reference nodes and edges that live in sibling
  // traces (e.g. a wallet in trace A sending USDC to a wallet in trace B is
  // an edge in trace A but its `to` node is in trace B). Validate identifiers
  // against the union of all nodes/edges across the parent investigation.
  private async loadInvestigationGraphIds(
    investigationId: string,
  ): Promise<{ nodeIds: Set<string>; edgeIds: Set<string> }> {
    const traces = await this.repo.find({ where: { investigationId } });
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const t of traces) {
      const d = (t.data || {}) as { nodes?: any[]; edges?: any[] };
      for (const n of d.nodes || []) nodeIds.add(n.id);
      for (const e of d.edges || []) edgeIds.add(e.id);
    }
    return { nodeIds, edgeIds };
  }

  async createEdgeBundle(traceId: string, dto: CreateEdgeBundleDto, principal: AccessPrincipal) {
    const trace = await this.findOne(traceId, principal, 'editor');
    const data = (trace.data || {}) as { edgeBundles?: any[] };

    const { nodeIds, edgeIds } = await this.loadInvestigationGraphIds(trace.investigationId);
    if (!nodeIds.has(dto.fromNodeId)) {
      throw new NotFoundException(`fromNodeId ${dto.fromNodeId} not found in investigation`);
    }
    if (!nodeIds.has(dto.toNodeId)) {
      throw new NotFoundException(`toNodeId ${dto.toNodeId} not found in investigation`);
    }
    const missingEdges = dto.edgeIds.filter((id) => !edgeIds.has(id));
    if (missingEdges.length > 0) {
      throw new NotFoundException(`Edges not found in investigation: ${missingEdges.join(', ')}`);
    }

    const bundle = {
      id: crypto.randomUUID(),
      traceId,
      fromNodeId: dto.fromNodeId,
      toNodeId: dto.toNodeId,
      token: dto.token,
      edgeIds: dto.edgeIds,
      collapsed: dto.collapsed ?? false,
      ...(dto.color !== undefined ? { color: dto.color } : {}),
      ...(dto.label !== undefined ? { label: dto.label } : {}),
    };

    trace.data = { ...data, edgeBundles: [...(data.edgeBundles || []), bundle] };
    await this.repo.save(trace);
    return bundle;
  }

  async updateEdgeBundle(
    traceId: string,
    bundleId: string,
    dto: UpdateEdgeBundleDto,
    principal: AccessPrincipal,
  ) {
    const trace = await this.findOne(traceId, principal, 'editor');
    const data = (trace.data || {}) as { edgeBundles?: any[] };
    const bundles: any[] = data.edgeBundles || [];
    const idx = bundles.findIndex((b) => b.id === bundleId);
    if (idx === -1) throw new NotFoundException(`Edge bundle ${bundleId} not found in trace ${traceId}`);

    if (
      dto.fromNodeId !== undefined ||
      dto.toNodeId !== undefined ||
      dto.edgeIds !== undefined
    ) {
      const { nodeIds, edgeIds } = await this.loadInvestigationGraphIds(trace.investigationId);
      if (dto.fromNodeId !== undefined && !nodeIds.has(dto.fromNodeId)) {
        throw new NotFoundException(`fromNodeId ${dto.fromNodeId} not found in investigation`);
      }
      if (dto.toNodeId !== undefined && !nodeIds.has(dto.toNodeId)) {
        throw new NotFoundException(`toNodeId ${dto.toNodeId} not found in investigation`);
      }
      if (dto.edgeIds !== undefined) {
        const missingEdges = dto.edgeIds.filter((id) => !edgeIds.has(id));
        if (missingEdges.length > 0) {
          throw new NotFoundException(`Edges not found in investigation: ${missingEdges.join(', ')}`);
        }
      }
    }

    bundles[idx] = { ...bundles[idx], ...dto };
    trace.data = { ...data, edgeBundles: bundles };
    await this.repo.save(trace);
    return bundles[idx];
  }

  async deleteEdgeBundle(traceId: string, bundleId: string, principal: AccessPrincipal) {
    const trace = await this.findOne(traceId, principal, 'editor');
    const data = (trace.data || {}) as { edgeBundles?: any[] };
    const bundles: any[] = data.edgeBundles || [];
    if (!bundles.some((b) => b.id === bundleId)) throw new NotFoundException(`Edge bundle ${bundleId} not found in trace ${traceId}`);
    trace.data = { ...data, edgeBundles: bundles.filter((b) => b.id !== bundleId) };
    await this.repo.save(trace);
  }

  /**
   * Resolves a WalletSetDto to a set of chain-normalized addresses
   * (EVM lowercased, Tron base58 preserved), searching across all traces in the
   * investigation. Exactly one of traceId, groupId, or wallets must be provided.
   * The 25-wallet cap is enforced after resolution by the caller.
   */
  public resolveWalletSet(traces: TraceEntity[], set: WalletSetDto, chain: string): Set<string> {
    const hasTrace = !!set.traceId;
    const hasGroup = !!set.groupId;
    const hasWallets = !!set.wallets && set.wallets.length > 0;
    const setCount = (hasTrace ? 1 : 0) + (hasGroup ? 1 : 0) + (hasWallets ? 1 : 0);

    if (setCount !== 1) {
      throw new BadRequestException('Exactly one of traceId, groupId, or wallets must be provided.');
    }

    if (hasTrace) {
      const trace = traces.find((t) => t.id === set.traceId);
      if (!trace) {
        throw new BadRequestException(`Trace ${set.traceId} not found in this investigation.`);
      }
      const data = (trace.data || {}) as { nodes?: any[] };
      // Filter to nodes on the search chain so we don't pollute the set with
      // (e.g.) EVM nodes when chain='tron'. Use chain-aware normalization —
      // Tron base58 is case-sensitive; lowercasing would corrupt addresses.
      // Junction nodes (kind: 'txJunction') stand for a transaction, not a
      // wallet — their "address" is a txid, so fetching it would burn a
      // wallet-cap slot and land straight in failedAddresses.
      return new Set(
        (data.nodes ?? [])
          .filter((n: any) => n.kind !== 'txJunction')
          .filter((n: any) => !n.chain || n.chain === chain)
          .map((n: any) => normalizeAddressForChain(n.address as string, chain)),
      );
    }

    if (hasGroup) {
      // Search across all traces for the group
      for (const trace of traces) {
        const data = (trace.data || {}) as { groups?: any[]; nodes?: any[] };
        const groupExists = (data.groups ?? []).some((g: any) => g.id === set.groupId);
        if (groupExists) {
          return new Set(
            (data.nodes ?? [])
              .filter((n: any) => n.groupId === set.groupId)
              .filter((n: any) => n.kind !== 'txJunction')
              .filter((n: any) => !n.chain || n.chain === chain)
              .map((n: any) => normalizeAddressForChain(n.address as string, chain)),
          );
        }
      }
      throw new BadRequestException('Group not found in this investigation.');
    }

    // hasWallets branch
    return new Set(set.wallets!.map((w) => normalizeAddressForChain(w, chain)));
  }

  async importTransactions(id: string, dto: ImportTransactionsDto, principal: AccessPrincipal) {
    const trace = await this.findOne(id, principal, 'editor');

    const data = (trace.data || {}) as {
      nodes?: any[];
      edges?: any[];
      criteria?: any;
      position?: any;
    };
    const existingNodes: any[] = data.nodes || [];
    const existingEdges: any[] = data.edges || [];

    const existingAddresses = new Set(
      existingNodes.map((n: any) => (n.address ? addressKey(n.address) : undefined)),
    );

    // Resolve each edge's from/to nodeId to an address via a single-pass map
    // instead of .find()-ing existingNodes per edge — O(nodes+edges) instead
    // of O(nodes×edges). Fall back to the raw value when a node isn't found.
    const nodeAddressById = new Map<string, string>();
    for (const n of existingNodes) {
      if (n.id && n.address) nodeAddressById.set(n.id, n.address);
    }
    const existingTxKeys = new Set(
      existingEdges.map((e: any) => {
        const fromAddr = nodeAddressById.get(e.from) ?? e.from;
        const toAddr = nodeAddressById.get(e.to) ?? e.to;
        return edgeIdentityKey(e, fromAddr, toAddr);
      }),
    );

    const addressToId = new Map<string, string>();
    for (const n of existingNodes) {
      if (n.address) addressToId.set(addressKey(n.address), n.id);
    }

    // Build cross-trace address map from sibling traces in the same investigation
    const siblingTraces = await this.repo.find({ where: { investigationId: trace.investigationId } });
    const crossTraceAddressToId = new Map<string, string>();
    for (const sibling of siblingTraces) {
      if (sibling.id === id) continue;
      const siblingNodes: any[] = (sibling.data as any)?.nodes || [];
      for (const n of siblingNodes) {
        if (n.address && !addressToId.has(addressKey(n.address))) {
          crossTraceAddressToId.set(addressKey(n.address), n.id);
        }
      }
    }

    // Position new nodes in a grid after existing ones
    let maxX = 0;
    let maxY = 0;
    for (const n of existingNodes) {
      if (n.position?.x > maxX) maxX = n.position.x;
      if (n.position?.y > maxY) maxY = n.position.y;
    }
    let nextX = maxX + 150;
    const nextY = 100;
    let placed = 0;

    let addedNodes = 0;
    let addedEdges = 0;

    // Bitcoin amounts ride as satoshis while the DTO's `token` is a bare symbol,
    // so utxo-carrying rows get the structured token a TransactionEdge expects.
    // Built per edge — one shared literal would alias across every BTC edge in
    // the trace, so editing one would silently edit them all.
    const btcToken = () => ({ address: '', symbol: 'BTC', decimals: 8 });

    // Mirrors btcToken(): Solana rows carry the human token symbol as a bare
    // string (item.token) plus mint/decimals context separately on
    // item.solana; rebuild the structured token object a TransactionEdge
    // expects. Native SOL has no mint (address: '') and always 9 decimals —
    // implied by `kind`, not carried on the context.
    const solanaToken = (item: ImportTransactionItem) => ({
      address: item.solana!.mint ?? '',
      symbol: item.token,
      decimals: item.solana!.kind === 'native' ? 9 : (item.solana!.decimals ?? 0),
    });

    /**
     * Create the wallet node for `addr` unless this trace (or a sibling) already
     * has one, and return the id it resolves to.
     *
     * Lookup keys go through `addressKey` on every chain so a differently-cased
     * or whitespace-padded spelling of the same address still matches. Only the
     * PERSISTED value is chain-aware: Bitcoin base58 and bech32 are
     * case-significant, and lowercasing one produces a different (invalid)
     * address.
     */
    const ensureAddressNode = (
      addr: string,
      chain: string,
      customLabel?: string,
    ): string | undefined => {
      const key = addressKey(addr);
      if (!existingAddresses.has(key) && !crossTraceAddressToId.has(key)) {
        // Bitcoin and Solana only. `normalizeAddressForChain` lowercases EVM
        // addresses, and EVM nodes have always persisted the address exactly
        // as imported — applying it there would rewrite every existing
        // import's node value. Solana has no such legacy contract to
        // preserve; routing it through the same trim-only normalization
        // (case survives — Solana base58 is case-significant) keeps a
        // whitespace-padded spelling from persisting unnormalized.
        const address =
          chain === 'bitcoin' || chain === 'solana' ? normalizeAddressForChain(addr, chain) : addr;

        const nodeId = crypto.randomUUID();
        const x = nextX + Math.floor(placed / 5) * 150;
        const y = nextY + (placed % 5) * 100;
        placed++;

        const defaultLabel = `${address.slice(0, 6)}…${address.slice(-4)}`;

        existingNodes.push({
          id: nodeId,
          label: customLabel || defaultLabel,
          address,
          chain,
          notes: '',
          tags: [],
          position: { x, y },
          parentTrace: id,
          addressType: 'unknown',
          explorerUrl: explorerAddressUrl(chain, address),
        });

        addressToId.set(key, nodeId);
        existingAddresses.add(key);
        addedNodes++;
      }
      return addressToId.get(key) ?? crossTraceAddressToId.get(key);
    };

    for (const tx of dto.transactions) {
      const chain = tx.chain || 'ethereum';

      // ── Bitcoin junction rows ───────────────────────────────────────────
      // A junction-flagged row stands for a transaction whose shape (many
      // inputs, CoinJoin, consolidation, coinbase) has no honest
      // address→address rendering — drawing one would require synthesizing a
      // sender. Instead the transaction itself becomes a node, with one leg
      // edge per real participant.
      //
      // Every row derived from such a transaction carries the SAME full
      // context, so planning from any one of them converges on the same node
      // and the same legs; the rows that follow dedup to nothing.
      if (chain === 'bitcoin' && tx.utxo?.junction) {
        const plan = planJunction(tx.txHash, tx.utxo);

        // The junction node dedups through the same address maps as wallets:
        // its "address" is the txid — globally unique lowercase hex, so the
        // lowercase map key is lossless.
        const junctionKey = addressKey(plan.node.address);
        if (!existingAddresses.has(junctionKey) && !crossTraceAddressToId.has(junctionKey)) {
          const nodeId = crypto.randomUUID();
          const x = nextX + Math.floor(placed / 5) * 150;
          const y = nextY + (placed % 5) * 100;
          placed++;

          // vout/legType/legIndex/junction describe the ROW that produced this
          // node, not the transaction — keeping them here would assert that the
          // whole tx is "vout 0".
          const {
            vout: _vout,
            legType: _legType,
            legIndex: _legIndex,
            junction: _junction,
            ...ledger
          } = tx.utxo;

          existingNodes.push({
            id: nodeId,
            label: plan.node.label,
            address: plan.node.address,
            chain: 'bitcoin',
            kind: plan.node.kind,
            // The ledger record lives ONCE, here. Leg edges carry only their own
            // slice, so a 50-input CoinJoin does not copy its inputs/outputs
            // arrays onto 50 edges. The arrays are copied because a fetched
            // row shares them by reference with every sibling row of the same
            // transaction — persisted state must never alias the request.
            utxoTx: { ...ledger, inputs: [...tx.utxo.inputs], outputs: [...tx.utxo.outputs] },
            notes: '',
            tags: [],
            position: { x, y },
            parentTrace: id,
            addressType: 'unknown',
            explorerUrl: explorerTxUrl('bitcoin', tx.txHash),
          });

          addressToId.set(junctionKey, nodeId);
          existingAddresses.add(junctionKey);
          addedNodes++;
        }

        const junctionId =
          addressToId.get(junctionKey) ?? crossTraceAddressToId.get(junctionKey);
        if (!junctionId) continue;

        // Junction rows still name the fetched address in from/to, so an
        // investigator-supplied label for it should land on its leg's node.
        const labelFor = (addr: string): string | undefined => {
          const k = addressKey(addr);
          if (tx.from && k === addressKey(tx.from)) return tx.fromLabel;
          if (tx.to && k === addressKey(tx.to)) return tx.toLabel;
          return undefined;
        };

        const pushLeg = (
          counterpartyAddress: string,
          direction: 'input' | 'output',
          amountSats: string,
          legUtxo: {
            inputs: unknown[];
            outputs: unknown[];
            fee: string;
            legType: 'input' | 'output';
            legIndex?: number;
            vout?: number;
          },
        ) => {
          const counterpartyKey = addressKey(counterpartyAddress);
          const counterpartyId = ensureAddressNode(
            counterpartyAddress,
            'bitcoin',
            labelFor(counterpartyAddress),
          );
          if (!counterpartyId) return;

          // Identity is derived from the txid and the leg's position in the
          // transaction, never from the endpoints — relabeling or re-fetching
          // the same leg is the same fact.
          const key = edgeIdentityKey(
            { chain: 'bitcoin', txHash: tx.txHash, utxo: legUtxo },
            counterpartyAddress,
            plan.node.address,
          );
          if (existingTxKeys.has(key)) return;

          existingEdges.push({
            id: crypto.randomUUID(),
            from: direction === 'input' ? counterpartyId : junctionId,
            to: direction === 'input' ? junctionId : counterpartyId,
            txHash: tx.txHash,
            chain: 'bitcoin',
            timestamp: tx.timestamp,
            amount: amountSats,
            token: btcToken(),
            blockNumber: tx.blockNumber || 0,
            notes: '',
            tags: [],
            crossTrace: !addressToId.has(counterpartyKey) || !addressToId.has(junctionKey),
            utxo: legUtxo,
          });

          existingTxKeys.add(key);
          addedEdges++;
        };

        for (const leg of plan.inputLegs) {
          // Input legs carry no output record of their own, and UtxoInputDto
          // requires prevTxid/prevVout that the plan does not surface — so the
          // arrays stay empty and the junction node holds the detail.
          pushLeg(leg.fromAddress, 'input', leg.amountSats, {
            inputs: [],
            outputs: [],
            fee: '',
            legType: 'input',
            legIndex: leg.legIndex,
          });
        }

        for (const leg of plan.outputLegs) {
          pushLeg(leg.toAddress, 'output', leg.amountSats, {
            inputs: [],
            // A single-entry `outputs` array describing THIS leg's output —
            // not the whole transaction's. It keeps the change verdict on the
            // edge (badges, and the agent summarizer, both read the output whose
            // `index` equals the edge's `vout`) while staying valid against
            // UtxoContextDto, which has no root-level `change` field.
            outputs: [
              {
                address: leg.toAddress,
                value: leg.amountSats,
                index: leg.vout,
                ...(leg.change !== undefined ? { change: leg.change } : {}),
              },
            ],
            fee: '',
            legType: 'output',
            vout: leg.vout,
          });
        }

        continue;
      }

      // Unlike BTC (where an empty endpoint is a legitimate unattributed-incoming
      // row that still gets a dangling-but-tolerated edge — see the per-endpoint
      // guard below), Solana rows always carry a well-defined from/to: native and
      // SPL transfers both name a real sender/receiver, so a missing one means
      // malformed data. Skip the WHOLE row — never author a half-edge, never
      // synthesize an endpoint — rather than just skipping node creation for it.
      // Mirrors the client hook's same-named guard in useWalletTransactionAuthoring.ts.
      if (chain === 'solana' && (!tx.from || !tx.to)) continue;

      // Auto-create wallet nodes for unknown addresses (skip if already in a sibling trace)
      for (const addr of [tx.from, tx.to]) {
        // A BTC row can legitimately have an empty endpoint (the normalizer
        // emits `from: ''` on incoming multi-input rows, which are junctions and
        // handled above) — never mint a node for it.
        if (chain === 'bitcoin' && !addr) continue;
        const isFrom = addressKey(addr) === addressKey(tx.from);
        ensureAddressNode(addr, chain, isFrom ? tx.fromLabel : tx.toLabel);
      }

      // Deduplicate by the same identity key used to build existingTxKeys above.
      const key = edgeIdentityKey(tx, tx.from, tx.to);
      if (existingTxKeys.has(key)) continue;

      const fromKey = addressKey(tx.from);
      const toKey = addressKey(tx.to);
      const fromId = addressToId.get(fromKey) ?? crossTraceAddressToId.get(fromKey);
      const toId = addressToId.get(toKey) ?? crossTraceAddressToId.get(toKey);
      if (!fromId || !toId) continue;

      const isCrossTrace = !addressToId.has(fromKey) || !addressToId.has(toKey);

      // A non-junction BTC row keeps the full ledger record on the edge itself —
      // there is no junction node to hold it — and switches to the structured
      // BTC token because its `amount` is satoshis. Bare BTC rows with no utxo
      // block keep the legacy string token and human-readable amounts.
      const isBtcLedgerRow = chain === 'bitcoin' && !!tx.utxo;
      // Same idea for Solana: a row that carries per-transfer context gets the
      // structured token rebuilt from it (see solanaToken() above) and keeps
      // that context on the edge. Bare Solana rows (no context) keep the
      // legacy string token — unchanged behavior.
      const isSolanaContextRow = chain === 'solana' && !!tx.solana;

      existingEdges.push({
        id: crypto.randomUUID(),
        from: fromId,
        to: toId,
        txHash: tx.txHash,
        chain: tx.chain,
        timestamp: tx.timestamp,
        amount: tx.amount,
        token: isBtcLedgerRow ? btcToken() : isSolanaContextRow ? solanaToken(tx) : tx.token,
        blockNumber: tx.blockNumber || 0,
        notes: '',
        tags: [],
        crossTrace: isCrossTrace,
        // Copied for the same reason as the junction node's: the request's
        // arrays are shared across sibling rows of one transaction.
        ...(isBtcLedgerRow
          ? {
              utxo: {
                ...tx.utxo,
                inputs: [...tx.utxo!.inputs],
                outputs: [...tx.utxo!.outputs],
              },
            }
          : {}),
        ...(isSolanaContextRow ? { solana: tx.solana } : {}),
      });

      existingTxKeys.add(key);
      addedEdges++;
    }

    trace.data = { ...data, nodes: existingNodes, edges: existingEdges };
    await this.repo.save(trace);

    return { added: { nodes: addedNodes, edges: addedEdges } };
  }

  /**
   * Searches for all direct transactions between two wallet sets within an optional time window.
   * Accepts an array of traces (the full investigation) so that wallet sets can reference any trace
   * or group across the investigation. Fetches only the smaller side.
   * Deduplicates using the same key as importTransactions: edgeIdentityKey.
   * When the same (txHash, from, to) appears with different tokens (e.g. native + ERC-20 in one tx),
   * the token symbols are joined into a comma-separated string on the kept row.
   */
  async searchBetween(
    traces: TraceEntity[],
    dto: SearchBetweenDto,
  ): Promise<{ results: ImportTransactionItem[]; fetchedSide: 'A' | 'B'; failedAddresses: string[]; analyzedCount: number }> {
    const setA = this.resolveWalletSet(traces, dto.sideA, dto.chain);
    const setB = this.resolveWalletSet(traces, dto.sideB, dto.chain);

    // Build a display name for the wallet set source for use in the cap error message.
    const sideLabel = (set: WalletSetDto, resolved: Set<string>): string => {
      if (set.traceId) {
        const t = traces.find((tr) => tr.id === set.traceId);
        return t ? `"${t.name}"` : `trace ${set.traceId}`;
      }
      if (set.groupId) return `group ${set.groupId}`;
      return `the wallet list (${resolved.size} wallets)`;
    };

    if (setA.size > TracesService.WALLET_CAP_PER_SIDE) {
      throw new BadRequestException(
        `${sideLabel(dto.sideA, setA)} has ${setA.size} wallets, exceeding the ${TracesService.WALLET_CAP_PER_SIDE}-per-side cap. Narrow your selection.`,
      );
    }
    if (setB.size > TracesService.WALLET_CAP_PER_SIDE) {
      throw new BadRequestException(
        `${sideLabel(dto.sideB, setB)} has ${setB.size} wallets, exceeding the ${TracesService.WALLET_CAP_PER_SIDE}-per-side cap. Narrow your selection.`,
      );
    }

    const fetchedSide: 'A' | 'B' = setA.size <= setB.size ? 'A' : 'B';
    const toFetch = fetchedSide === 'A' ? setA : setB;
    const otherSet = fetchedSide === 'A' ? setB : setA;

    const fetchOptions: FetchOptions = {
      startTimestamp: dto.timeRange?.startTimestamp,
      endTimestamp: dto.timeRange?.endTimestamp,
      // Per-page: Etherscan accepts up to 10 000 (cap at 1 000 for safety);
      // Tron's API caps at ~50 per page in this codebase.
      // Offset is irrelevant to the Bitcoin provider path (it paginates on its
      // own cursor and ignores this field) — leave it falling through to the
      // EVM default rather than special-casing it.
      offset: dto.chain === 'tron' ? 50 : 1000,
      // maxTotal worst-case = ceil(maxTotal / pageSize) provider calls per wallet
      // for *each* of native + token. Keep Tron conservative — 50/page × 40 pages
      // × 2 sources = 80 sequential Tronscan calls/wallet; any more and active
      // wallets hit the rate limiter mid-pagination. EVM is faster per page,
      // so 10× the headroom is fine. Bitcoin and Solana are capped much
      // tighter — a single active address's history can run into the tens of
      // thousands of rows, and searchBetween only needs enough to find
      // cross-set matches.
      maxTotal: dto.chain === 'bitcoin' ? 300 : dto.chain === 'solana' ? 300 : dto.chain === 'tron' ? 2000 : 10000,
    };

    const addrs = [...toFetch];
    const settled = await Promise.allSettled(
      addrs.map((addr) =>
        this.blockchainService.fetchHistory(addr, dto.chain, fetchOptions),
      ),
    );

    const failedAddresses: string[] = [];
    const responses: { transactions: TransactionResult[] }[] = [];
    let analyzedCount = 0;
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      if (outcome.status === 'fulfilled') {
        // analyzedCount is the raw transaction count before the cross-set filter —
        // the "how much we looked at" metric. Use the pre-cap length from the result.
        analyzedCount += outcome.value.transactions.length;
        responses.push(outcome.value);
      } else {
        failedAddresses.push(addrs[i]);
      }
    }

    // Collect cross-set txs. Key matches importTransactions dedup — edgeIdentityKey,
    // the same function used there, so BTC rows collapse on txid:vout (or
    // txid:in:<legIndex>) instead of on endpoint addresses.
    // Collapse duplicates; merge token symbols if multiple tokens move in the same tx.
    const collapsed = new Map<string, ImportTransactionItem>();

    for (const { transactions } of responses) {
      for (const tx of transactions) {
        // BlockchainService.normalizeAddr already returns chain-correct casing
        // (Tron preserved, EVM lowercased). Re-normalize defensively in case
        // the provider hands us something off-spec.
        const from = normalizeAddressForChain(tx.from, dto.chain);
        const to = normalizeAddressForChain(tx.to, dto.chain);
        const crosses =
          (toFetch.has(from) && otherSet.has(to)) ||
          (toFetch.has(to) && otherSet.has(from)) ||
          // Unattributed BTC incoming row: the ledger names no single payer, but it
          // does name every input. A junction import draws the real legs, so a match
          // on any input address is a real link — not a synthesized one.
          (dto.chain === 'bitcoin' && !from && toFetch.has(to) &&
            (tx.utxo?.inputs ?? []).some((i) => i.address && otherSet.has(normalizeAddressForChain(i.address, dto.chain))));
        if (!crosses) continue;

        const key = edgeIdentityKey(tx, from, to);
        const existing = collapsed.get(key);
        if (!existing) {
          collapsed.set(key, this.toImportItem(tx, dto.chain));
        } else {
          // Same (txHash, from, to) with a different token — append symbol if not already present.
          // Use exact-match against the comma-separated set to avoid substring collisions
          // (e.g. "ETH-LP, USDC".includes("ETH") would wrongly suppress a real "ETH" symbol).
          const newSymbol = tx.token.symbol;
          if (newSymbol) {
            const existingTokens = new Set(existing.token.split(/,\s*/));
            if (!existingTokens.has(newSymbol)) {
              existing.token = `${existing.token}, ${newSymbol}`;
            }
          }
        }
      }
    }

    return { results: [...collapsed.values()], fetchedSide, failedAddresses, analyzedCount };
  }

  /**
   * Maps a TransactionResult from BlockchainService to the ImportTransactionItem DTO shape.
   * token is a string (symbol) in ImportTransactionItem; TransactionResult.token is an object.
   * For native transfers the symbol is the chain's native currency (e.g. "ETH").
   * For ERC-20/TRC-20 transfers the symbol is the token symbol (e.g. "USDC").
   * amount is passed through unchanged (satoshis for BTC utxo rows) — reformatting
   * is the import path's job (importTransactions), not this mapping.
   */
  private toImportItem(tx: TransactionResult, chain: string): ImportTransactionItem {
    const item = new ImportTransactionItem();
    item.txHash = tx.txHash;
    item.from = tx.from;
    item.to = tx.to;
    item.chain = chain;
    item.amount = tx.amount;
    item.token = tx.token.symbol;   // string symbol, not the object
    item.timestamp = tx.timestamp;  // already ISO string from BlockchainService
    item.blockNumber = tx.blockNumber;
    // UTXO provenance (Bitcoin only) — carried through so an imported search
    // result retains the payload importTransactions needs to build the
    // structured BTC token/ledger record (see Task 14).
    if (tx.utxo) item.utxo = tx.utxo;
    // Solana provenance — carried through so an imported search result
    // retains the per-transfer context importTransactions needs to rebuild
    // the structured token object and dedup identity (see solanaToken()).
    if (tx.solana) item.solana = tx.solana;
    return item;
  }
}
