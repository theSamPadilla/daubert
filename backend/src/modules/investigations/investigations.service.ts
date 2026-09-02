import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { ScriptRunEntity } from '../../database/entities/script-run.entity';
import { TraceEntity } from '../../database/entities/trace.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { AccessPrincipal } from '../auth/access-principal';
import { CaseRole } from '../../database/entities/case-member.entity';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { UpdateInvestigationDto } from './dto/update-investigation.dto';
import { traceColorForIndex } from '../../generated/shared/trace-colors';

const DEFAULT_TRACE_NAME = 'Trace 1';

@Injectable()
export class InvestigationsService {
  constructor(
    @InjectRepository(InvestigationEntity)
    private readonly repo: Repository<InvestigationEntity>,
    @InjectRepository(CaseEntity)
    private readonly caseRepo: Repository<CaseEntity>,
    @InjectRepository(ScriptRunEntity)
    private readonly scriptRunRepo: Repository<ScriptRunEntity>,
    @InjectRepository(TraceEntity)
    private readonly traceRepo: Repository<TraceEntity>,
    private readonly caseAccess: CaseAccessService,
    private readonly dataSource: DataSource,
  ) {}

  async findAllForCase(caseId: string) {
    const c = await this.caseRepo.findOneBy({ id: caseId });
    if (!c) throw new NotFoundException(`Case ${caseId} not found`);
    return this.repo.find({
      where: { caseId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, principal: AccessPrincipal, minRole: CaseRole = 'viewer') {
    const inv = await this.repo.findOne({
      where: { id },
      relations: ['traces'],
    });
    if (!inv) throw new NotFoundException(`Investigation ${id} not found`);
    await this.caseAccess.assertRole(principal, inv.caseId, minRole);
    return inv;
  }

  /**
   * Creates an investigation together with its first trace.
   *
   * The trace is not optional. A trace is the only container the graph can write
   * into: nodes, edges, groups and bundles all live inside `trace.data`, and every
   * authoring path resolves a target trace id before it writes. An investigation
   * with zero traces is therefore a state in which the workspace exists but cannot
   * accept any input, which is what this guarantees away.
   *
   * Written through `traceRepo` rather than `TracesService.create` deliberately:
   * the access check already ran (`@RequireRole('editor')` on the REST route,
   * `assertRole` in the MCP write tool), and going through the service would add a
   * circular module dependency for a second, redundant gate.
   *
   * The investigation save and the trace save run inside one transaction: a
   * committed investigation whose trace insert then failed would leave exactly
   * the invalid, trace-less state this method exists to prevent.
   */
  async create(caseId: string, dto: CreateInvestigationDto): Promise<InvestigationEntity> {
    return this.dataSource.transaction(async (manager) => {
      const c = await manager.findOneBy(CaseEntity, { id: caseId });
      if (!c) throw new NotFoundException(`Case ${caseId} not found`);

      const entity = manager.create(InvestigationEntity, {
        name: dto.name,
        notes: dto.notes || null,
        caseId,
      });
      const saved = await manager.save(entity);

      await manager.save(
        manager.create(TraceEntity, {
          name: dto.initialTraceName?.trim() || DEFAULT_TRACE_NAME,
          color: traceColorForIndex(0),
          visible: true,
          collapsed: false,
          data: { nodes: [], edges: [] },
          investigationId: saved.id,
        }),
      );

      const withTrace = await manager.findOne(InvestigationEntity, {
        where: { id: saved.id },
        relations: ['traces'],
      });
      return withTrace!;
    });
  }

  async update(id: string, dto: UpdateInvestigationDto, principal: AccessPrincipal) {
    const inv = await this.findOne(id, principal, 'editor');
    if (dto.name !== undefined) inv.name = dto.name;
    if (dto.notes !== undefined) inv.notes = dto.notes;
    return this.repo.save(inv);
  }

  async remove(id: string, principal: AccessPrincipal) {
    const inv = await this.findOne(id, principal, 'editor');
    await this.repo.remove(inv);
  }

  // Deep-clones an investigation and all its traces. Node/edge/group/bundle
  // UUIDs live inside each trace's JSONB `data` blob; edges and bundles
  // reference them by id, so every entity gets a fresh UUID and all internal
  // references are remapped. Script runs, conversations, and productions are
  // intentionally not copied — they belong to the original.
  async duplicate(id: string, principal: AccessPrincipal) {
    const source = await this.findOne(id, principal, 'editor'); // loads traces relation

    const newInv = await this.repo.save(
      this.repo.create({
        name: `${source.name} (Copy)`,
        notes: source.notes,
        caseId: source.caseId,
      }),
    );

    const sourceTraces = source.traces || [];
    if (sourceTraces.length === 0) {
      return this.repo.findOne({ where: { id: newInv.id }, relations: ['traces'] });
    }

    // Pre-allocate all new UUIDs so cross-references (cross-trace bundles,
    // node.parentTrace, etc.) can be resolved during the remap pass.
    const traceIdMap = new Map<string, string>();
    const nodeIdMap = new Map<string, string>();
    const edgeIdMap = new Map<string, string>();
    const groupIdMap = new Map<string, string>();
    const bundleIdMap = new Map<string, string>();

    for (const trace of sourceTraces) {
      traceIdMap.set(trace.id, crypto.randomUUID());
      const data = (trace.data || {}) as any;
      for (const n of data.nodes || []) nodeIdMap.set(n.id, crypto.randomUUID());
      for (const e of data.edges || []) edgeIdMap.set(e.id, crypto.randomUUID());
      for (const g of data.groups || []) groupIdMap.set(g.id, crypto.randomUUID());
      for (const b of data.edgeBundles || []) bundleIdMap.set(b.id, crypto.randomUUID());
    }

    const newTraces: TraceEntity[] = sourceTraces.map((trace) => {
      const newTraceId = traceIdMap.get(trace.id)!;
      const data = (trace.data || {}) as any;

      const nodes = (data.nodes || []).map((n: any) => ({
        ...n,
        id: nodeIdMap.get(n.id) ?? n.id,
        parentTrace: n.parentTrace
          ? traceIdMap.get(n.parentTrace) ?? newTraceId
          : newTraceId,
        ...(n.groupId !== undefined
          ? { groupId: groupIdMap.get(n.groupId) ?? n.groupId }
          : {}),
      }));

      const edges = (data.edges || []).map((e: any) => ({
        ...e,
        id: edgeIdMap.get(e.id) ?? e.id,
        from: nodeIdMap.get(e.from) ?? e.from,
        to: nodeIdMap.get(e.to) ?? e.to,
      }));

      const groups = (data.groups || []).map((g: any) => ({
        ...g,
        id: groupIdMap.get(g.id) ?? g.id,
        traceId: g.traceId ? traceIdMap.get(g.traceId) ?? newTraceId : newTraceId,
      }));

      const edgeBundles = (data.edgeBundles || []).map((b: any) => ({
        ...b,
        id: bundleIdMap.get(b.id) ?? b.id,
        traceId: b.traceId ? traceIdMap.get(b.traceId) ?? newTraceId : newTraceId,
        fromNodeId: nodeIdMap.get(b.fromNodeId) ?? b.fromNodeId,
        toNodeId: nodeIdMap.get(b.toNodeId) ?? b.toNodeId,
        edgeIds: (b.edgeIds || []).map((eid: string) => edgeIdMap.get(eid) ?? eid),
      }));

      const newData: Record<string, unknown> = {
        ...data,
        nodes,
        edges,
        ...(data.groups !== undefined ? { groups } : {}),
        ...(data.edgeBundles !== undefined ? { edgeBundles } : {}),
      };

      return this.traceRepo.create({
        id: newTraceId,
        name: trace.name,
        color: trace.color,
        visible: trace.visible,
        collapsed: trace.collapsed,
        data: newData,
        investigationId: newInv.id,
      });
    });

    await this.traceRepo.save(newTraces);

    return this.repo.findOne({ where: { id: newInv.id }, relations: ['traces'] });
  }

  async listScriptRuns(investigationId: string, principal: AccessPrincipal) {
    await this.findOne(investigationId, principal);
    return this.scriptRunRepo.find({
      where: { investigationId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}
