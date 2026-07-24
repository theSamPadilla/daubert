/**
 * ReadToolsService — nine read-only MCP tools for the BYOA MCP session.
 *
 *   - get_case_data           → aggregated case overview (investigations,
 *                               productions summary, data-room manifest).
 *   - read_production         → one or all productions under a case.
 *   - get_investigation       → investigation graph data — summaries across
 *                               every investigation without investigationId,
 *                               or the full slimmed graph (nodes, edges,
 *                               groups, bundles) for one, with optional
 *                               address/token filters.
 *   - query_labeled_entities  → address lookup or filtered search across the
 *                               shared labeled-entity catalog (no case scope).
 *   - get_skill               → read a skill document by name from the registry.
 *   - get_declarants          → org-wide list of saved declarants (no case scope).
 *   - get_declaration_library → org-wide list of boilerplate declaration
 *                               blocks, optionally filtered by kind (no case scope).
 *   - list_data_room_files    → flat data-room file manifest for a case (id,
 *                               name, mimeType, size, folder path).
 *   - read_data_room_file     → read one data-room file's contents (extracted
 *                               text/image blocks), or a size-note if too large.
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
import { extractFileForMcp } from '../../data-room/file-text';
import { AuthSuccess } from '../mcp-auth.helper';
import { errorResult, textResult } from './tool-utils';
import { stripTraceForAgent, filterTraceData } from '../../ai/investigation-data.utils';

const DATA_ROOM_MANIFEST_LIMIT = 25;
const MCP_AGENT_READ_BYTES = 5 * 1024 * 1024;
const LIST_FILES_LIMIT = 500;

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
    // get_investigation — investigation graph data.
    //
    // Without investigationId → summary of every investigation in the case
    // (id, name, notes, per-trace node/edge counts).
    // With investigationId → full graph per trace (nodes, edges denormalized
    // with from/to addresses, groups, bundles), visual metadata stripped via
    // stripTraceForAgent, optionally narrowed via filterTraceData. Mirrors
    // AiService.executeInvestigationTool. Bypasses textResult's 8 KB cap —
    // a slimmed graph routinely exceeds it.
    // -----------------------------------------------------------------------
    server.registerTool(
      'get_investigation',
      {
        description:
          "Read an investigation's graph. With only caseId: returns a summary of every investigation in the case (id, name, notes, and per-trace node/edge counts). With investigationId: returns the full graph per trace — nodes, edges (denormalized with from/to addresses), groups, and bundles, with visual metadata stripped. Optional address and token filters narrow to matching nodes/edges. Requires viewer access.",
        inputSchema: {
          caseId: z.string().uuid(),
          investigationId: z.string().uuid().optional(),
          address: z.string().optional(),
          token: z.string().optional(),
        },
      },
      async ({ caseId, investigationId, address, token }) => {
        try {
          await this.caseAccess.assertRole(principal, caseId, 'viewer');

          if (!investigationId) {
            const rows = await this.investigationRepo.find({
              where: { caseId },
              relations: ['traces'],
              order: { createdAt: 'ASC' },
            });
            const summaries = rows.map((inv) => ({
              id: inv.id,
              name: inv.name,
              notes: inv.notes,
              traces: inv.traces.map((t) => ({
                id: t.id,
                name: t.name,
                nodeCount: ((t.data as any)?.nodes?.length) || 0,
                edgeCount: ((t.data as any)?.edges?.length) || 0,
              })),
            }));
            return { content: [{ type: 'text' as const, text: JSON.stringify(summaries) }] };
          }

          const inv = await this.investigationRepo.findOne({
            where: { id: investigationId, caseId },
            relations: ['traces'],
          });
          if (!inv) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ error: `Investigation ${investigationId} not found` }),
                },
              ],
            };
          }

          const traces = inv.traces.map((t) => {
            const stripped = stripTraceForAgent(t.data);
            const filtered = filterTraceData(stripped, address, token);
            return { id: t.id, name: t.name, ...filtered };
          });
          const result = { id: inv.id, name: inv.name, notes: inv.notes, traces };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
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

    // -----------------------------------------------------------------------
    // list_data_room_files / read_data_room_file — data-room reads.
    //
    // Both bypass `textResult`: a document read or a large file manifest
    // would be gutted by the 8 KB result cap, so they return the MCP content
    // envelope directly. Only the catch path (`errorResult`) stays capped.
    // -----------------------------------------------------------------------
    server.registerTool(
      'list_data_room_files',
      {
        description:
          'List every data-room file for a case: id, name, mimeType, size, and folder path. Use a file id with read_data_room_file. Returns up to 500 files — check `truncated`. Requires viewer access.',
        inputSchema: { caseId: z.string().uuid() },
      },
      async ({ caseId }) => {
        try {
          await this.caseAccess.assertRole(principal, caseId, 'viewer');
          const manifest = await this.dataRoomService.getManifest(caseId, LIST_FILES_LIMIT);
          return { content: [{ type: 'text' as const, text: JSON.stringify(manifest) }] };
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    server.registerTool(
      'read_data_room_file',
      {
        description:
          'Read a data-room file\'s contents. Pass a fileId from list_data_room_files or the get_case_data manifest. docx/pdf/xlsx/csv/txt are returned as extracted text; images as an image block; oversized files return a note (PDFs up to 32 MB, others up to 5 MB). Requires viewer access.',
        inputSchema: { caseId: z.string().uuid(), fileId: z.string().uuid() },
      },
      async ({ caseId, fileId }) => {
        try {
          await this.caseAccess.assertRole(principal, caseId, 'viewer');
          const actorUserId = 'userId' in principal ? principal.userId : 'system';
          const read = await this.dataRoomService.getFileBufferForAgent(
            caseId,
            actorUserId,
            fileId,
            MCP_AGENT_READ_BYTES,
          );
          if (read.tooLarge) {
            const mb = (read.size / (1024 * 1024)).toFixed(1);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `[File "${read.name}" is ${mb} MB — too large to read inline. PDFs are read up to 32 MB; other types up to 5 MB. Ask the user for the relevant excerpt.]`,
                },
              ],
            };
          }
          const blocks = await extractFileForMcp(read.buffer, read.mimeType, read.name);
          return { content: blocks };
        } catch (e) {
          return errorResult(e);
        }
      },
    );
  }
}
