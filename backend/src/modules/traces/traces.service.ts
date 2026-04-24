import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { TraceEntity } from '../../database/entities/trace.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CHAIN_CONFIGS } from '../blockchain/types';
import { CreateTraceDto } from './dto/create-trace.dto';
import { UpdateTraceDto } from './dto/update-trace.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { UpdateEdgeDto } from './dto/update-edge.dto';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';
import { ImportTransactionsDto } from './dto/import-transactions.dto';

@Injectable()
export class TracesService {
  constructor(
    @InjectRepository(TraceEntity)
    private readonly repo: Repository<TraceEntity>,
    @InjectRepository(InvestigationEntity)
    private readonly invRepo: Repository<InvestigationEntity>,
  ) {}

  async findAllForInvestigation(investigationId: string) {
    const inv = await this.invRepo.findOneBy({ id: investigationId });
    if (!inv) throw new NotFoundException(`Investigation ${investigationId} not found`);
    return this.repo.find({
      where: { investigationId },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(id: string) {
    const trace = await this.repo.findOneBy({ id });
    if (!trace) throw new NotFoundException(`Trace ${id} not found`);
    return trace;
  }

  async create(investigationId: string, dto: CreateTraceDto) {
    const inv = await this.invRepo.findOneBy({ id: investigationId });
    if (!inv) throw new NotFoundException(`Investigation ${investigationId} not found`);

    const entity = this.repo.create({
      name: dto.name,
      color: dto.color || null,
      visible: dto.visible ?? true,
      collapsed: dto.collapsed ?? false,
      data: dto.data || {},
      investigationId,
    });
    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdateTraceDto) {
    const trace = await this.findOne(id);
    if (dto.name !== undefined) trace.name = dto.name;
    if (dto.color !== undefined) trace.color = dto.color;
    if (dto.visible !== undefined) trace.visible = dto.visible;
    if (dto.collapsed !== undefined) trace.collapsed = dto.collapsed;
    if (dto.data !== undefined) trace.data = dto.data;
    return this.repo.save(trace);
  }

  async remove(id: string) {
    const trace = await this.findOne(id);
    await this.repo.remove(trace);
  }

  async updateNode(traceId: string, nodeId: string, dto: UpdateNodeDto) {
    const trace = await this.findOne(traceId);
    const data = (trace.data || {}) as { nodes?: any[]; edges?: any[] };
    const nodes: any[] = data.nodes || [];
    const idx = nodes.findIndex((n) => n.id === nodeId);
    if (idx === -1) throw new NotFoundException(`Node ${nodeId} not found in trace ${traceId}`);
    nodes[idx] = { ...nodes[idx], ...dto };
    trace.data = { ...data, nodes };
    await this.repo.save(trace);
    return nodes[idx];
  }

  async updateEdge(traceId: string, edgeId: string, dto: UpdateEdgeDto) {
    const trace = await this.findOne(traceId);
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

  async deleteNode(traceId: string, nodeId: string) {
    const trace = await this.findOne(traceId);
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

  async deleteEdge(traceId: string, edgeId: string) {
    const trace = await this.findOne(traceId);
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

  async createGroup(traceId: string, dto: CreateGroupDto) {
    const trace = await this.findOne(traceId);
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

        const config = CHAIN_CONFIGS[def.chain];
        const explorerUrl = config
          ? def.chain === 'tron'
            ? `${config.explorerUrl}/#/address/${def.address}`
            : `${config.explorerUrl}/address/${def.address}`
          : '';

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

  async updateGroup(traceId: string, groupId: string, dto: UpdateGroupDto) {
    const trace = await this.findOne(traceId);
    const data = (trace.data || {}) as { groups?: any[] };
    const groups: any[] = data.groups || [];
    const idx = groups.findIndex((g) => g.id === groupId);
    if (idx === -1) throw new NotFoundException(`Group ${groupId} not found in trace ${traceId}`);
    groups[idx] = { ...groups[idx], ...dto };
    trace.data = { ...data, groups };
    await this.repo.save(trace);
    return groups[idx];
  }

  async deleteGroup(traceId: string, groupId: string) {
    const trace = await this.findOne(traceId);
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

  async listEdgeBundles(traceId: string) {
    const trace = await this.findOne(traceId);
    const data = (trace.data || {}) as { edgeBundles?: any[] };
    return data.edgeBundles || [];
  }

  async deleteEdgeBundle(traceId: string, bundleId: string) {
    const trace = await this.findOne(traceId);
    const data = (trace.data || {}) as { edgeBundles?: any[] };
    const bundles: any[] = data.edgeBundles || [];
    if (!bundles.some((b) => b.id === bundleId)) throw new NotFoundException(`Edge bundle ${bundleId} not found in trace ${traceId}`);
    trace.data = { ...data, edgeBundles: bundles.filter((b) => b.id !== bundleId) };
    await this.repo.save(trace);
  }

  async importTransactions(id: string, dto: ImportTransactionsDto) {
    const trace = await this.findOne(id);

    const data = (trace.data || {}) as {
      nodes?: any[];
      edges?: any[];
      criteria?: any;
      position?: any;
    };
    const existingNodes: any[] = data.nodes || [];
    const existingEdges: any[] = data.edges || [];

    const existingAddresses = new Set(
      existingNodes.map((n: any) => n.address?.toLowerCase()),
    );
    const existingTxKeys = new Set(
      existingEdges.map((e: any) => {
        const fromNode = existingNodes.find((n: any) => n.id === e.from);
        const toNode = existingNodes.find((n: any) => n.id === e.to);
        return `${e.txHash}-${fromNode?.address?.toLowerCase()}-${toNode?.address?.toLowerCase()}`;
      }),
    );

    const addressToId = new Map<string, string>();
    for (const n of existingNodes) {
      if (n.address) addressToId.set(n.address.toLowerCase(), n.id);
    }

    // Build cross-trace address map from sibling traces in the same investigation
    const siblingTraces = await this.repo.find({ where: { investigationId: trace.investigationId } });
    const crossTraceAddressToId = new Map<string, string>();
    for (const sibling of siblingTraces) {
      if (sibling.id === id) continue;
      const siblingNodes: any[] = (sibling.data as any)?.nodes || [];
      for (const n of siblingNodes) {
        if (n.address && !addressToId.has(n.address.toLowerCase())) {
          crossTraceAddressToId.set(n.address.toLowerCase(), n.id);
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

    for (const tx of dto.transactions) {
      // Auto-create wallet nodes for unknown addresses (skip if already in a sibling trace)
      for (const addr of [tx.from, tx.to]) {
        if (existingAddresses.has(addr.toLowerCase())) continue;
        if (crossTraceAddressToId.has(addr.toLowerCase())) continue;

        const chain = tx.chain || 'ethereum';
        const config = CHAIN_CONFIGS[chain];
        let explorerUrl = '';
        if (config) {
          explorerUrl = chain === 'tron'
            ? `${config.explorerUrl}/#/address/${addr}`
            : `${config.explorerUrl}/address/${addr}`;
        }

        const nodeId = crypto.randomUUID();
        const x = nextX + Math.floor(placed / 5) * 150;
        const y = nextY + (placed % 5) * 100;
        placed++;

        const isFrom = addr.toLowerCase() === tx.from.toLowerCase();
        const customLabel = isFrom ? tx.fromLabel : tx.toLabel;
        const defaultLabel = `${addr.slice(0, 6)}…${addr.slice(-4)}`;

        existingNodes.push({
          id: nodeId,
          label: customLabel || defaultLabel,
          address: addr,
          chain,
          notes: '',
          tags: [],
          position: { x, y },
          parentTrace: id,
          addressType: 'unknown',
          explorerUrl,
        });

        addressToId.set(addr.toLowerCase(), nodeId);
        existingAddresses.add(addr.toLowerCase());
        addedNodes++;
      }

      // Deduplicate by txHash-fromAddr-toAddr
      const key = `${tx.txHash}-${tx.from.toLowerCase()}-${tx.to.toLowerCase()}`;
      if (existingTxKeys.has(key)) continue;

      const fromId = addressToId.get(tx.from.toLowerCase()) ?? crossTraceAddressToId.get(tx.from.toLowerCase());
      const toId = addressToId.get(tx.to.toLowerCase()) ?? crossTraceAddressToId.get(tx.to.toLowerCase());
      if (!fromId || !toId) continue;

      const isCrossTrace = !addressToId.has(tx.from.toLowerCase()) || !addressToId.has(tx.to.toLowerCase());

      existingEdges.push({
        id: crypto.randomUUID(),
        from: fromId,
        to: toId,
        txHash: tx.txHash,
        chain: tx.chain,
        timestamp: tx.timestamp,
        amount: tx.amount,
        token: tx.token,
        blockNumber: tx.blockNumber || 0,
        notes: '',
        tags: [],
        crossTrace: isCrossTrace,
      });

      existingTxKeys.add(key);
      addedEdges++;
    }

    trace.data = { ...data, nodes: existingNodes, edges: existingEdges };
    await this.repo.save(trace);

    return { added: { nodes: addedNodes, edges: addedEdges } };
  }
}
