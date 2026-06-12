/**
 * NavigateToolsService — three read-only MCP tools that let an OAuth-bound
 * MCP session enumerate the resources visible inside its bound organization:
 *
 *   - list_cases             → cases the user can see, scoped to bound org.
 *   - get_case               → one case by id, role-gated at viewer.
 *   - list_investigations    → investigations under a case, role-gated at viewer.
 *
 * Tool pattern established here (later tool tasks MUST copy this):
 *   1. Closure-captured `auth: AuthSuccess`. No per-call re-auth.
 *   2. For every CASE-scoped tool, the FIRST awaited call is
 *      `caseAccess.assertRole(auth.principal, caseId, minRole)`.
 *      - This passes the cross-org gate (CaseAccessService rejects with
 *        `cross_org_access` when caseId belongs to a different org than the
 *        principal's bound org), then enforces the role hierarchy.
 *      - The principal flowing in is the MCP principal — downstream services
 *        that accept an AccessPrincipal MUST receive the SAME principal
 *        (defense-in-depth: the org gate is re-enforced if the service does
 *        its own assertRole).
 *   3. Handlers wrap their body in try / catch and translate the thrown
 *      error into `errorResult(e)` via tool-utils so ForbiddenException etc.
 *      surface as MCP `{ isError: true }` results rather than crashing the
 *      stateless transport.
 *   4. All successful results go through `textResult(value)` which JSON-
 *      stringifies and caps at RESULT_CAP_BYTES (~8 KB) with a truncation
 *      suffix. Tools NEVER hand raw JSON of arbitrary size to the model.
 *   5. Projections: tools return only the fields the model needs. `list_cases`
 *      drops summary/orgId/timestamps and yields `{ id, name, role }` rows.
 *      Detail tools (e.g. get_case) lean on the service's own role-aware
 *      projection (CasesService.findOne strips members for viewers).
 *
 * Input schemas use zod raw shapes per the SDK's `registerTool` config form
 * (the SDK derives the input zod object from the shape). zod is allowed in
 * tool files; outside of mcp/ Daubert uses class-validator / DTOs.
 */

import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { CaseAccessService } from '../../auth/case-access.service';
import { CasesService } from '../../cases/cases.service';
import { InvestigationsService } from '../../investigations/investigations.service';
import { AuthSuccess } from '../mcp-auth.helper';
import { errorResult, textResult } from './tool-utils';

@Injectable()
export class NavigateToolsService {
  constructor(
    private readonly cases: CasesService,
    private readonly investigations: InvestigationsService,
    private readonly caseAccess: CaseAccessService,
  ) {}

  /**
   * Register every navigate-scope tool on `server`. `auth` is captured by
   * closure so handler implementations never have to re-resolve the principal.
   */
  registerAll(server: McpServer, auth: AuthSuccess): void {
    const { principal, user } = auth;

    // -----------------------------------------------------------------------
    // list_cases — cases visible to the bound user within the bound org.
    //
    // No input. The (userId, organizationId) pair is sourced from the auth
    // closure — the model cannot smuggle in a different org.
    // -----------------------------------------------------------------------
    server.registerTool(
      'list_cases',
      {
        description:
          'List the cases you can see in this organization. Returns id, name, and your effective role on each case.',
        inputSchema: {},
      },
      async () => {
        try {
          const rows = await this.cases.findAllForUserInOrg(
            user,
            principal.organizationId,
          );
          const projected = rows.map((c) => ({
            id: c.id,
            name: c.name,
            role: c.role,
          }));
          return textResult(projected);
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    // -----------------------------------------------------------------------
    // get_case — one case by id, role-gated at viewer.
    //
    // assertRole runs first: cross-org gate, opaque case_not_found, role
    // hierarchy check. The returned membership carries the effective role,
    // which is passed to findOne so its role-aware projection (members
    // hidden from viewers) is consistent with the gate.
    // -----------------------------------------------------------------------
    server.registerTool(
      'get_case',
      {
        description:
          'Get one case by id, including its investigations. Requires at least viewer access.',
        inputSchema: { caseId: z.string().uuid() },
      },
      async ({ caseId }) => {
        try {
          const membership = await this.caseAccess.assertRole(
            principal,
            caseId,
            'viewer',
          );
          // assertRole for an mcp principal always returns a membership when
          // it does not throw — the role flows into findOne for projection.
          const result = await this.cases.findOne(caseId, membership?.role);
          return textResult(result);
        } catch (e) {
          return errorResult(e);
        }
      },
    );

    // -----------------------------------------------------------------------
    // list_investigations — investigations under a case, role-gated at viewer.
    //
    // InvestigationsService.findAllForCase does not do its own role check —
    // assertRole IS the gate. Calling assertRole first also guarantees the
    // cross-org rejection happens before any investigation query runs.
    // -----------------------------------------------------------------------
    server.registerTool(
      'list_investigations',
      {
        description:
          'List the investigations under a case. Requires at least viewer access on the case.',
        inputSchema: { caseId: z.string().uuid() },
      },
      async ({ caseId }) => {
        try {
          await this.caseAccess.assertRole(principal, caseId, 'viewer');
          const rows = await this.investigations.findAllForCase(caseId);
          return textResult(rows);
        } catch (e) {
          return errorResult(e);
        }
      },
    );
  }
}
