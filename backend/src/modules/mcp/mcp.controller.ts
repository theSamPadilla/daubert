/**
 * McpController — OAuth-MCP Task 11 (stateless Streamable-HTTP transport).
 *
 * Single POST /mcp endpoint. Auth runs once at the controller body; the result
 * flows into McpTools.registerForScope via closure so tool handlers never
 * re-auth per-call.
 *
 * Decisions (from plan):
 *   - @Public() so AuthGuard skips this route.
 *   - @UseGuards(McpIpThrottlerGuard) fires as a route-level guard regardless
 *     of @Public() — throttles anonymous callers before auth runs.
 *   - Stateless StreamableHTTPServerTransport (sessionIdGenerator: undefined).
 *   - Auth failure → HTTP 401 + WWW-Authenticate per RFC 9728 (OAuth-only;
 *     no bmc_* key path in Daubert).
 */

import { Controller, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';

import { Public } from '../auth/public.decorator';
import { McpIpThrottlerGuard } from '../../common/guards/mcp-ip-throttler.guard';
import { McpAuthHelper, isAuthSuccess } from './mcp-auth.helper';
import { McpToolsService } from './mcp.tools';

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly mcpAuth: McpAuthHelper,
    private readonly mcpTools: McpToolsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * POST /mcp — MCP Streamable HTTP endpoint.
   *
   * @Public() ensures AuthGuard skips this route.
   * @UseGuards(McpIpThrottlerGuard) fires as a route-level guard regardless of
   *   @Public() — throttles anonymous callers before auth runs.
   *
   * On auth failure: HTTP 401 + WWW-Authenticate header per RFC 9728. Empty body.
   * On success: builds a fresh McpServer + stateless StreamableHTTPServerTransport,
   * registers scope-specific tools and prompts, then hands off to the transport.
   */
  @Public()
  @UseGuards(McpIpThrottlerGuard)
  @Post()
  async handleMcp(@Req() req: Request, @Res() res: Response): Promise<void> {
    // ------------------------------------------------------------------
    // 1. Authenticate. Returns AuthSuccess | AuthFailure.
    // ------------------------------------------------------------------
    const auth = await this.mcpAuth.authenticate(req);

    if (!isAuthSuccess(auth)) {
      // OAuth failure (or no credentials): HTTP 401 + WWW-Authenticate per RFC 9728.
      // Empty body — the header is what OAuth-aware clients read.
      res.status(401).header('WWW-Authenticate', auth.wwwAuthenticate).send();
      return;
    }

    // ------------------------------------------------------------------
    // 2. Build McpServer + stateless transport.
    // ------------------------------------------------------------------
    const server = new McpServer({
      name: 'daubert',
      version: '1.0.0',
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    // ------------------------------------------------------------------
    // 3. Register scope-specific tools and prompts.
    //    auth flows into each handler via closure.
    // ------------------------------------------------------------------
    this.mcpTools.registerForScope(server, auth);

    const baseUrl = this.config.getOrThrow<string>('OAUTH_ISSUER_URL');
    this.mcpTools.registerPromptsForScope(server, auth, baseUrl);

    // ------------------------------------------------------------------
    // 4. Connect server to transport and handle the request.
    //    Tear down on response close to release SDK resources.
    // ------------------------------------------------------------------
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body as unknown);
  }
}
