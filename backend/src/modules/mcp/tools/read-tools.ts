/**
 * ReadToolsService — four read-only MCP tools for the BYOA MCP session.
 *
 *   - get_case_data           → aggregated case overview (investigations,
 *                               productions summary, data-room manifest).
 *   - read_production         → one or all productions under a case.
 *   - query_labeled_entities  → address lookup or filtered search across the
 *                               shared labeled-entity catalog (no case scope).
 *   - get_skill               → read a skill document by name from the registry.
 *
 * Pattern mirrors NavigateToolsService (Task 12):
 *   - `server.registerTool(name, { description, inputSchema }, handler)`.
 *   - Case-scoped tools call `caseAccess.assertRole(auth.principal, caseId, 'viewer')`
 *     as the FIRST awaited call.
 *   - try/catch → `errorResult(e)`; success → `textResult(data)`.
 *
 * `get_case_data` replicates the aggregation logic from `AiService.executeCaseDataTool`
 * (which is private and not injectable). It reads the same three sources:
 *   1. InvestigationEntity repo — investigation summaries with trace counts.
 *   2. ProductionsService.findAllForCase — production summaries (data field stripped).
 *   3. DataRoomService.getManifest — data-room file list (capped at 25 entries).
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { CaseAccessService } from '../../auth/case-access.service';
import { InvestigationEntity } from '../../../database/entities/investigation.entity';
import { ProductionsService } from '../../productions/productions.service';
import { ProductionType } from '../../../database/entities/production.entity';
import { DataRoomService } from '../../data-room/data-room.service';
import { LabeledEntitiesService } from '../../labeled-entities/labeled-entities.service';
import { EntityCategory } from '../../../database/entities/labeled-entity.entity';
import { getSkillContent } from '../../../skills/skill-registry';
import { AuthSuccess } from '../mcp-auth.helper';
import { errorResult, textResult } from './tool-utils';

const DATA_ROOM_MANIFEST_LIMIT = 25;

@Injectable()
export class ReadToolsService {
  constructor(
    private readonly caseAccess: CaseAccessService,
    @InjectRepository(InvestigationEntity)
    private readonly investigationRepo: Repository<InvestigationEntity>,
    private readonly productionsService: ProductionsService,
    private readonly dataRoomService: DataRoomService,
    private readonly labeledEntitiesService: LabeledEntitiesService,
  ) {}

  /**
   * Register every read-scope tool on `server`. `auth` is captured by closure
   * so handlers never have to re-resolve the principal.
   */
  registerAll(server: McpServer, auth: AuthSuccess): void {
    const { principal } = auth;

    // -----------------------------------------------------------------------
    // get_case_data — aggregated case overview.
    //
    // Returns investigation summaries (id, name, traceCount, totalNodes,
    // totalEdges), production summaries (id, name, type — data field omitted),
    // and the data-room manifest. Mirrors AiService.executeCaseDataTool.
    // -----------------------------------------------------------------------
    server.registerTool(
      'get_case_data',
      {
        description:
          'Get an aggregated overview of a case: investigations (with trace counts), productions (name + type, no data payload), and the data-room file manifest.',
        inputSchema: { caseId: z.string().uuid() },
      },
      async ({ caseId }) => {
        try {
          await this.caseAccess.assertRole(principal, caseId, 'viewer');

          const investigations = await this.investigationRepo.find({
            where: { caseId },
            relations: ['traces'],
            order: { createdAt: 'ASC' },
          });

          const investigationSummaries = investigations.map((inv) => ({
            id: inv.id,
            name: inv.name,
            traceCount: inv.traces.length,
            totalNodes: inv.traces.reduce(
              (sum, t) => sum + ((t.data as any)?.nodes?.length || 0),
              0,
            ),
            totalEdges: inv.traces.reduce(
              (sum, t) => sum + ((t.data as any)?.edges?.length || 0),
              0,
            ),
          }));

          const productions = await this.productionsService.findAllForCase(
            caseId,
            principal,
          );
          const productionSummaries = (productions as any[]).map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
          }));

          const manifest = await this.dataRoomService.getManifest(
            caseId,
            DATA_ROOM_MANIFEST_LIMIT,
          );
          const dataRoom = {
            available: true,
            fileCount: manifest.total,
            truncated: manifest.truncated,
            files: manifest.files,
          };

          return textResult({ investigations: investigationSummaries, productions: productionSummaries, dataRoom });
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    // -----------------------------------------------------------------------
    // read_production — one or all productions under a case.
    //
    // If productionId is provided → ProductionsService.findOne (returns the
    // full production including data).
    // Otherwise → ProductionsService.findAllForCase (optionally filtered by
    // type). Both paths are guarded by assertRole first.
    // -----------------------------------------------------------------------
    server.registerTool(
      'read_production',
      {
        description:
          'Read one production by id, or list all productions for a case (optionally filtered by type). Requires viewer access.',
        inputSchema: {
          caseId: z.string().uuid(),
          productionId: z.string().uuid().optional(),
          type: z.nativeEnum(ProductionType).optional(),
        },
      },
      async ({ caseId, productionId, type }) => {
        try {
          await this.caseAccess.assertRole(principal, caseId, 'viewer');

          if (productionId) {
            const result = await this.productionsService.findOne(
              productionId,
              principal,
            );
            return textResult(result);
          }

          const results = await this.productionsService.findAllForCase(
            caseId,
            principal,
            type,
          );
          return textResult(results);
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    // -----------------------------------------------------------------------
    // query_labeled_entities — search the shared labeled-entity catalog.
    //
    // No case scope — the catalog is org-wide (no per-case isolation).
    // If address is provided → lookupByAddress.
    // Otherwise → findAll with optional category + search filters.
    // -----------------------------------------------------------------------
    server.registerTool(
      'query_labeled_entities',
      {
        description:
          'Look up labeled entities (exchanges, contracts, known wallets, etc.) by wallet address, or search by name and category.',
        inputSchema: {
          address: z.string().optional(),
          search: z.string().optional(),
          category: z.nativeEnum(EntityCategory).optional(),
        },
      },
      async ({ address, search, category }) => {
        try {
          if (address) {
            const result = await this.labeledEntitiesService.lookupByAddress(address);
            return textResult(result);
          }

          const validCategories = new Set(Object.values(EntityCategory));
          const safeCategory =
            category && validCategories.has(category as EntityCategory)
              ? (category as EntityCategory)
              : undefined;

          const result = await this.labeledEntitiesService.findAll({
            category: safeCategory,
            search,
          });
          return textResult(result);
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    // -----------------------------------------------------------------------
    // get_skill — read a skill document from the registry by name.
    //
    // Returns the skill's markdown content (frontmatter stripped) or
    // `{ error }` for unknown names. Never crashes.
    // -----------------------------------------------------------------------
    server.registerTool(
      'get_skill',
      {
        description:
          'Read a skill document by name. Valid names include: etherscan-apis, graph-mutations, product-knowledge, productions, tronscan-apis.',
        inputSchema: { name: z.string() },
      },
      async ({ name }) => {
        try {
          const content = getSkillContent(name);
          if (content === null) {
            return textResult({ error: `Unknown skill: "${name}". Use query_skills or check the skill registry for valid names.` });
          }
          return textResult(content);
        } catch (e) {
          return errorResult(e);
        }
      },
    );
  }
}
