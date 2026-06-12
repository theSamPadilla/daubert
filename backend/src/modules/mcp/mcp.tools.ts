/**
 * McpToolsService — top-level MCP tool dispatcher.
 *
 * Responsibility: own the dispatch from the controller to the per-domain
 * tool services. Each domain (navigate, graph, members, etc.) gets its own
 * `*ToolsService` provider that registers a handful of cohesive tools on
 * the McpServer; this class is a thin coordinator that calls every one of
 * them in turn with the same (server, auth) pair.
 *
 * Why split it this way:
 *   - Each tool group lives next to its dependencies (CasesService,
 *     InvestigationsService, etc.) and is independently unit-testable.
 *   - This file becomes a roll-up — the only thing that changes here as the
 *     tool catalog grows is one extra `service.registerAll(...)` call.
 *   - Method signatures match belong-mc's `McpToolsService` so the
 *     controller (Task 11) wires unchanged.
 *
 * Task 12 brings the first three tools online via NavigateToolsService:
 *   - list_cases
 *   - get_case
 *   - list_investigations
 * Later tasks register additional services here.
 */

import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AuthSuccess } from './mcp-auth.helper';
import { NavigateToolsService } from './tools/navigate-tools';

@Injectable()
export class McpToolsService {
  constructor(private readonly navigate: NavigateToolsService) {}

  /**
   * Register all MCP tools appropriate for the authenticated session on `server`.
   * Called once per MCP request, after auth succeeds.
   *
   * Add new tool groups here as additional `registerAll(server, auth)` calls.
   */
  registerForScope(server: McpServer, auth: AuthSuccess): void {
    this.navigate.registerAll(server, auth);
  }

  /**
   * Register MCP prompts for the authenticated session on `server`.
   * Called once per MCP request, after registerForScope.
   *
   * @param _baseUrl The OAUTH_ISSUER_URL from config — used for {BASE_URL}
   *   interpolation in prompt bodies. Passed through from the controller.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  registerPromptsForScope(
    _server: McpServer,
    _auth: AuthSuccess,
    _baseUrl: string,
  ): void {
    // Stub — real prompt registrations added in later tasks.
  }
}
