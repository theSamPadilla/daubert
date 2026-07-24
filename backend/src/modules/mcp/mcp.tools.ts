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
import { ReadToolsService } from './tools/read-tools';
import { BlockchainToolsService } from './tools/blockchain-tools';
import { WriteToolsService } from './tools/write-tools';
import { getSkillContent, SKILL_REGISTRY } from '../../skills/skill-registry';

/**
 * Skill handles registered as MCP prompts for every authenticated session.
 * Order determines the order they appear in the MCP prompt list.
 */
const PROMPT_SKILL_HANDLES = [
  'daubert-overview',
  'graph-mutations',
  'etherscan-apis',
  'tronscan-apis',
  'productions',
  'declarations',
  'redlining',
] as const;

@Injectable()
export class McpToolsService {
  constructor(
    private readonly navigate: NavigateToolsService,
    private readonly read: ReadToolsService,
    private readonly blockchain: BlockchainToolsService,
    private readonly write: WriteToolsService,
  ) {}

  /**
   * Register all MCP tools appropriate for the authenticated session on `server`.
   * Called once per MCP request, after auth succeeds.
   *
   * Add new tool groups here as additional `registerAll(server, auth)` calls.
   */
  registerForScope(server: McpServer, auth: AuthSuccess): void {
    this.navigate.registerAll(server, auth);
    this.read.registerAll(server, auth);
    this.blockchain.registerAll(server, auth);
    this.write.registerAll(server, auth);
  }

  /**
   * Register MCP prompts for the authenticated session on `server`.
   * Called once per MCP request, after registerForScope.
   *
   * Each skill in PROMPT_SKILL_HANDLES becomes one MCP prompt:
   *   - name        = skill handle (filename without .md)
   *   - description = skill frontmatter `description` field
   *   - callback    = returns messages:[{ role:'user', content:{ type:'text', text } }]
   *
   * Skills whose file is missing (getSkillContent returns null) are skipped
   * silently — the session continues without that prompt rather than crashing.
   *
   * V1: no argsSchema — prompts are informational only, no parameters.
   *
   * @param server  The McpServer instance for this request.
   * @param _auth   The authenticated session (unused in V1 — all prompts are
   *                scope-independent; kept for future role-gated prompt filtering).
   * @param _baseUrl Reserved for future {BASE_URL} interpolation (not used in
   *                 current skill bodies).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  registerPromptsForScope(server: McpServer, _auth: AuthSuccess, _baseUrl: string): void {
    for (const handle of PROMPT_SKILL_HANDLES) {
      const content = getSkillContent(handle);
      if (content === null) {
        // Skill file missing — skip silently rather than crashing the session.
        continue;
      }
      // getSkillContent confirmed the skill exists, so its registry entry is
      // guaranteed present here. Fall back to the handle if somehow missing.
      const description =
        SKILL_REGISTRY.find((s) => s.name === handle)?.description ?? handle;

      server.registerPrompt(
        handle,
        { description },
        () => ({
          messages: [
            {
              role: 'user' as const,
              content: { type: 'text' as const, text: content },
            },
          ],
        }),
      );
    }
  }
}
