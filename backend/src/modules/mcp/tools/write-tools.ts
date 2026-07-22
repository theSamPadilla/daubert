/**
 * WriteToolsService — four mutation MCP tools for the BYOA MCP session.
 *
 *   - create_investigation   → InvestigationsService.create
 *   - import_transactions    → TracesService.importTransactions
 *   - create_production      → ProductionsService.create
 *   - update_production      → ProductionsService.update
 *
 * Pattern mirrors NavigateToolsService / ReadToolsService (Tasks 12 + 13) but
 * with the **audit obligation** that defines BYOA security criterion #4:
 *
 *   every agent mutation is audited with (session, user, org) attribution.
 *
 * Per tool:
 *   1. (Where the downstream service has NO role check, e.g.
 *      `InvestigationsService.create`) call
 *      `caseAccess.assertRole(auth.principal, caseId, 'editor')` first.
 *      assertRole IS the gate. The same mcp principal threads through to the
 *      service so any service-side `assertRole` re-runs the cross-org gate
 *      (defense in depth — never re-derive a principal mid-flight).
 *   2. Perform the write.
 *   3. `agentAudit.log({ sessionId, userId, organizationId, action, targetRef,
 *      status, detail? })` — capturing the SAME (auth.session.id,
 *      auth.principal.userId, auth.principal.organizationId) on both
 *      success AND failure paths. Audit BEFORE assertRole is irrelevant —
 *      we audit the OUTCOME, so we must run the assertion first, observe the
 *      result, then log. The failure-path test asserts an audit row is still
 *      written when the gate denies the call.
 *
 * Audit-ordering decision:
 *   - On the success path we audit AFTER `await` on the service has resolved
 *     (so the detail reflects what actually happened).
 *   - On the error path we audit BEFORE returning the `errorResult` envelope.
 *   - If the audit write itself throws, we MUST NOT mask the underlying tool
 *     outcome. We swallow the audit failure (best-effort logging) and return
 *     the tool's real result. The audit table is append-only and lossy by
 *     design — a transient DB hiccup should not turn a successful write into
 *     a 500, and it should not hide an editor-denied error from the model.
 *
 * Role assertions:
 *   - `create_investigation`: the service has no role check, so we must
 *     assertRole('editor') ourselves before calling create.
 *   - `import_transactions`, `create_production`, `update_production`: the
 *     respective services already call `assertRole(principal, caseId, 'editor')`
 *     internally and resolve the case from their primary key. We do NOT
 *     re-assert here — there is no caseId in our input for two of them, and
 *     adding our own lookup would duplicate the service's resolution path
 *     for no gain. The mcp principal we pass in is what makes the gate fire.
 */

import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { CaseAccessService } from '../../auth/case-access.service';
import { InvestigationsService } from '../../investigations/investigations.service';
import { TracesService } from '../../traces/traces.service';
import { ProductionsService } from '../../productions/productions.service';
import { ProductionType } from '../../../database/entities/production.entity';
import { ImportTransactionItem } from '../../traces/dto/import-transactions.dto';
import { AgentAuditService } from '../agent-audit.service';
import { AuthSuccess } from '../mcp-auth.helper';
import { errorResult, textResult } from './tool-utils';

// ---------------------------------------------------------------------------
// Input schemas (zod raw shapes — see NavigateToolsService docstring for why).
//
// Note `token` on the transaction item is a SYMBOL STRING (e.g. "USDT"), not
// an object — TracesService.importTransactions writes it straight into the
// edge's `token` field. The frontend DTO `ImportTransactionItem` also types
// it as a string; matching that here keeps the mcp surface in lock-step with
// the REST surface.
// ---------------------------------------------------------------------------

const importTxItemSchema = z.object({
  from: z.string(),
  to: z.string(),
  txHash: z.string(),
  chain: z.string(),
  timestamp: z.string(),
  amount: z.string(),
  token: z.string(),
  blockNumber: z.number().optional(),
  fromLabel: z.string().optional(),
  toLabel: z.string().optional(),
});

@Injectable()
export class WriteToolsService {
  constructor(
    private readonly caseAccess: CaseAccessService,
    private readonly investigationsService: InvestigationsService,
    private readonly tracesService: TracesService,
    private readonly productionsService: ProductionsService,
    private readonly agentAudit: AgentAuditService,
  ) {}

  /**
   * Best-effort audit write. A failing audit must NEVER mask the real tool
   * outcome — operators can grep server logs for the silent failure. We log
   * to stderr so a regression is visible but the tool response is honest.
   */
  private async safeAudit(params: {
    sessionId: string;
    userId: string;
    organizationId: string;
    action: string;
    targetRef: string;
    status: 'ok' | 'error';
    detail?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.agentAudit.log(params);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(
        `[mcp][audit] failed to persist audit row for action=${params.action} target=${params.targetRef}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  /**
   * Register every write-scope tool on `server`. `auth` is captured by closure
   * so the (session, user, org) audit tuple is fixed at handler-build time —
   * a tool handler cannot substitute a different principal.
   */
  registerAll(server: McpServer, auth: AuthSuccess): void {
    const { principal, session } = auth;

    const audit = (
      action: string,
      targetRef: string,
      status: 'ok' | 'error',
      detail?: Record<string, unknown>,
    ) =>
      this.safeAudit({
        sessionId: session.id,
        userId: principal.userId,
        organizationId: principal.organizationId,
        action,
        targetRef,
        status,
        detail,
      });

    // -----------------------------------------------------------------------
    // create_investigation — create an investigation under a case.
    //
    // InvestigationsService.create has NO role check, so assertRole('editor')
    // here IS the gate. assertRole also enforces the cross-org rejection that
    // protects against caseId smuggling.
    // -----------------------------------------------------------------------
    server.registerTool(
      'create_investigation',
      {
        description:
          'Create a new investigation under a case. Requires editor access.',
        inputSchema: {
          caseId: z.string().uuid(),
          name: z.string(),
          notes: z.string().optional(),
        },
      },
      async ({ caseId, name, notes }) => {
        const targetRef = `case:${caseId}`;
        try {
          await this.caseAccess.assertRole(principal, caseId, 'editor');
          const dto = { name, ...(notes !== undefined ? { notes } : {}) };
          const created = await this.investigationsService.create(caseId, dto);
          await audit('create_investigation', targetRef, 'ok', {
            investigationId: (created as { id: string }).id,
          });
          return textResult(created);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await audit('create_investigation', targetRef, 'error', { message });
          return errorResult(e);
        }
      },
    );

    // -----------------------------------------------------------------------
    // import_transactions — add parsed transactions to a trace.
    //
    // TracesService.importTransactions resolves the trace's case and asserts
    // editor internally — we pass the mcp principal straight through so its
    // assertRole branch re-validates the cross-org gate.
    // -----------------------------------------------------------------------
    server.registerTool(
      'import_transactions',
      {
        description:
          'Import parsed transactions into a trace. Auto-creates nodes for unknown addresses, deduplicates by (txHash, from, to). Requires editor access on the trace\'s case.',
        inputSchema: {
          traceId: z.string().uuid(),
          transactions: z.array(importTxItemSchema),
        },
      },
      async ({ traceId, transactions }) => {
        const targetRef = `trace:${traceId}`;
        try {
          // Map zod-parsed plain objects to the class-validator DTO shape
          // TracesService expects. `token` is a string symbol — copied through.
          const items: ImportTransactionItem[] = transactions.map((t) => {
            const item = new ImportTransactionItem();
            item.from = t.from;
            item.to = t.to;
            item.txHash = t.txHash;
            item.chain = t.chain;
            item.timestamp = t.timestamp;
            item.amount = t.amount;
            item.token = t.token;
            if (t.blockNumber !== undefined) item.blockNumber = t.blockNumber;
            if (t.fromLabel !== undefined) item.fromLabel = t.fromLabel;
            if (t.toLabel !== undefined) item.toLabel = t.toLabel;
            return item;
          });

          const result = await this.tracesService.importTransactions(
            traceId,
            { transactions: items },
            principal,
          );
          await audit('import_transactions', targetRef, 'ok', {
            added: (result as { added: unknown }).added,
          });
          return textResult(result);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await audit('import_transactions', targetRef, 'error', { message });
          return errorResult(e);
        }
      },
    );

    // -----------------------------------------------------------------------
    // create_production — create a production under a case.
    //
    // ProductionsService.create asserts editor internally — but we ALSO call
    // assertRole up-front to give the audit row a clean, uniform shape on the
    // denial path: when access fails we want the audit row to read
    // `status='error'` with the role-violation message, NOT a confusing
    // service-side trace. Engineering choice: pay one extra DB round-trip on
    // the happy path for a much clearer audit trail.
    // -----------------------------------------------------------------------
    server.registerTool(
      'create_production',
      {
        description:
          'Create a new production (report, chart, chronology, or declaration) under a case. Requires editor access. For declarations pass `data: { formatId, caption?, declarantName?, declarantDateOfBirth?, declarantAddress? }` — `formatId` is one of `ca-declaration`, `ny-affirmation`, `federal-1746`, `tx-declaration`, `fl-declaration`; the server seeds the section skeleton and renders the jurisdiction\'s oath, caption chrome, and numbering automatically. `tx-declaration` additionally requires `declarantDateOfBirth` and `declarantAddress`. Build declaration content afterwards with `update_production` declaration ops — read the `declarations` skill first.',
        inputSchema: {
          caseId: z.string().uuid(),
          name: z.string(),
          type: z.nativeEnum(ProductionType),
          data: z.record(z.string(), z.unknown()),
        },
      },
      async ({ caseId, name, type, data }) => {
        const targetRef = `case:${caseId}`;
        try {
          await this.caseAccess.assertRole(principal, caseId, 'editor');
          const dto = {
            name,
            type,
            data: data as Record<string, unknown>,
          };
          const created = await this.productionsService.create(
            caseId,
            dto,
            principal,
          );
          await audit('create_production', targetRef, 'ok', {
            productionId: (created as { id: string }).id,
            type,
          });
          return textResult(created);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await audit('create_production', targetRef, 'error', { message });
          return errorResult(e);
        }
      },
    );

    // -----------------------------------------------------------------------
    // update_production — patch a production (name, full data, or atomic ops).
    //
    // ProductionsService.update asserts editor internally and enforces the
    // `data` / `ops` mutual-exclusion contract. We accept either (or just
    // `name`) and forward.
    // -----------------------------------------------------------------------
    server.registerTool(
      'update_production',
      {
        description:
          'Update a production: rename, replace its `data` payload, or apply atomic `ops`. `data` and `ops` are mutually exclusive. Requires editor access. Chronology/chart ops are documented in the `productions` skill; declaration ops (declaration_set_caption, declaration_add_section, declaration_add_paragraph, declaration_add_exhibit, …) in the `declarations` skill — read the relevant skill before applying ops.',
        inputSchema: {
          productionId: z.string().uuid(),
          name: z.string().optional(),
          data: z.record(z.string(), z.unknown()).optional(),
          ops: z.array(z.record(z.string(), z.unknown())).optional(),
        },
      },
      async ({ productionId, name, data, ops }) => {
        const targetRef = `production:${productionId}`;
        try {
          const dto: {
            name?: string;
            data?: Record<string, unknown>;
            ops?: Record<string, unknown>[];
          } = {};
          if (name !== undefined) dto.name = name;
          if (data !== undefined) dto.data = data as Record<string, unknown>;
          if (ops !== undefined) dto.ops = ops as Record<string, unknown>[];

          const updated = await this.productionsService.update(
            productionId,
            dto,
            principal,
          );
          await audit('update_production', targetRef, 'ok', {
            fields: Object.keys(dto),
          });
          return textResult(updated);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await audit('update_production', targetRef, 'error', { message });
          return errorResult(e);
        }
      },
    );
  }
}
