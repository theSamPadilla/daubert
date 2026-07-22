/**
 * ReadToolsService — six read-only MCP tools for the BYOA MCP session.
 *
 *   - get_case_data           → aggregated case overview (investigations,
 *                               productions summary, data-room manifest).
 *   - read_production         → one or all productions under a case.
 *   - query_labeled_entities  → address lookup or filtered search across the
 *                               shared labeled-entity catalog (no case scope).
 *   - get_skill               → read a skill document by name from the registry.
 *   - get_declarants          → org-wide list of saved declarants (no case scope).
 *   - get_declaration_library → org-wide list of boilerplate declaration
 *                               blocks, optionally filtered by kind (no case scope).
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
import { DeclarantsService } from '../../declarants/declarants.service';
import { DeclarationLibraryService } from '../../declaration-library/declaration-library.service';
import { DeclarationLibraryBlockKind } from '../../../database/entities/declaration-library-block.entity';
import { getSkillContent, SKILL_REGISTRY } from '../../../skills/skill-registry';
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
    private readonly declarantsService: DeclarantsService,
    private readonly declarationLibraryService: DeclarationLibraryService,
  ) {}

  /**
   * Register every read-scope tool on `server`. `auth` is captured by closure
   * so handlers never have to re-resolve the principal.
   */
  registerAll(server: McpServer, auth: AuthSuccess): void {
    const { principal } = auth;
    const skillNames = SKILL_REGISTRY.map((s) => s.name).join(', ');

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
        description: `Read a skill document by name. Valid names: ${skillNames}.`,
        inputSchema: { name: z.string() },
      },
      async ({ name }) => {
        try {
          const content = getSkillContent(name);
          if (content === null) {
            return textResult({
              error: `Unknown skill: "${name}". Valid names: ${skillNames}.`,
            });
          }
          return textResult(content);
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    // -----------------------------------------------------------------------
    // get_declarants / get_declaration_library — org-wide declaration reads.
    //
    // The MCP session is bound to exactly one organization
    // (principal.organizationId, re-verified per request by McpAuthHelper),
    // so these are pure org reads: no case scope, no assertRole — same
    // access model as query_labeled_entities. Projections mirror the
    // built-in agent's dispatches in ai.service.ts for parity; the
    // organizationId column is dropped from row shapes. Reads don't audit.
    // -----------------------------------------------------------------------
    server.registerTool(
      'get_declarants',
      {
        description:
          "List the organization's saved declarants (expert witnesses / affiants) with their profile fields — display name, title, firm, qualifications paragraphs, prior testimony, CV exhibit, rate, and disclosures. Use before drafting a declaration to fill the declarant's qualifications and background (see the `declarations` skill).",
        inputSchema: {},
      },
      async () => {
        try {
          const declarants = await this.declarantsService.listForOrg(
            principal.organizationId,
          );
          return textResult({
            declarants: declarants.map((d) => ({
              id: d.id,
              displayName: d.displayName,
              title: d.title,
              firm: d.firm,
              qualifications: d.qualifications,
              cvExhibit: d.cvExhibit,
              priorTestimony: d.priorTestimony,
              hourlyRate: d.hourlyRate,
              nonContingencyDisclosure: d.nonContingencyDisclosure,
              dateOfBirth: d.dateOfBirth,
              address: d.address,
              userId: d.userId,
            })),
          });
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    server.registerTool(
      'get_declaration_library',
      {
        description:
          "List the organization's reusable boilerplate declaration blocks (technical chain primers, authentication language) with their paragraph content. Use before drafting background/authentication sections. For a declarant's qualifications, use `get_declarants` instead.",
        inputSchema: {
          kind: z.enum(['boilerplate']).optional(),
        },
      },
      async ({ kind }) => {
        try {
          const blocks = await this.declarationLibraryService.listForOrg(
            principal.organizationId,
            kind as DeclarationLibraryBlockKind | undefined,
          );
          return textResult({
            blocks: blocks.map((b) => ({
              id: b.id,
              kind: b.kind,
              name: b.name,
              category: b.category,
              content: b.content,
            })),
          });
        } catch (e) {
          return errorResult(e);
        }
      },
    );
  }
}
