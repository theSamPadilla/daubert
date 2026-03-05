import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { TraceEntity } from '../../database/entities/trace.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CHAIN_CONFIGS } from '../blockchain/types';
import { CreateTraceDto } from './dto/create-trace.dto';
import { UpdateTraceDto } from './dto/update-trace.dto';
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
      // Auto-create wallet nodes for unknown addresses
      for (const addr of [tx.from, tx.to]) {
        if (existingAddresses.has(addr.toLowerCase())) continue;

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

        existingNodes.push({
          id: nodeId,
          label: `${addr.slice(0, 6)}…${addr.slice(-4)}`,
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

      const fromId = addressToId.get(tx.from.toLowerCase());
      const toId = addressToId.get(tx.to.toLowerCase());
      if (!fromId || !toId) continue;

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
        crossTrace: false,
      });

      existingTxKeys.add(key);
      addedEdges++;
    }

    trace.data = { ...data, nodes: existingNodes, edges: existingEdges };
    await this.repo.save(trace);

    return { added: { nodes: addedNodes, edges: addedEdges } };
  }
}
