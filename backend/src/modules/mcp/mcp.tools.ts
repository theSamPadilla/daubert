/**
 * McpToolsService — scope-gated tool registrar stub (Task 11).
 *
 * Real tool implementations are added in later tasks. This stub provides
 * the class/method contract that McpController depends on so the module
 * wires correctly and tests can mock it without coupling to real domain services.
 *
 * Method signatures match belong-mc's McpToolsService so later tasks slot in
 * without renaming anything.
 */

import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AuthSuccess } from './mcp-auth.helper';

@Injectable()
export class McpToolsService {
  /**
   * Register all MCP tools appropriate for the authenticated session on `server`.
   * Called once per MCP request, after auth succeeds.
   *
   * Task 11: stub — registers nothing. Real tools are added in later tasks.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  registerForScope(_server: McpServer, _auth: AuthSuccess): void {
    // Stub — real tool registrations added in later tasks.
  }

  /**
   * Register MCP prompts for the authenticated session on `server`.
   * Called once per MCP request, after registerForScope.
   *
   * Task 11: stub — registers nothing. Real prompts added in later tasks.
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
