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
import { OAuthService } from '../oauth/oauth.service';
import { McpAuthHelper, isAuthSuccess, type AuthSuccess } from './mcp-auth.helper';
import { McpToolsService } from './mcp.tools';

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly mcpAuth: McpAuthHelper,
    private readonly mcpTools: McpToolsService,
    private readonly oauthService: OAuthService,
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
    // 1b. First-initialize surfaceLabel augmentation.
    //     Fire-and-forget: failure is non-fatal (coarse "Claude Desktop"
    //     label is acceptable; enrichment is UX polish, not security).
    // ------------------------------------------------------------------
    void this.maybeAugmentSurfaceLabel(req, auth);

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

  // -------------------------------------------------------------------------
  // surfaceLabel augmentation on first MCP initialize
  // -------------------------------------------------------------------------

  /**
   * If this is an `initialize` request, enrich the session's coarse
   * `surfaceLabel` (set at consent time, e.g. "Claude Desktop") with the
   * agent's self-reported `clientInfo.name + version` and a UA-derived OS
   * string. Idempotent via the conditional UPDATE in
   * `OAuthService.augmentSurfaceLabel`. Always fire-and-forget.
   */
  private async maybeAugmentSurfaceLabel(
    req: Request,
    auth: AuthSuccess,
  ): Promise<void> {
    try {
      const body = req.body as
        | { method?: unknown; params?: { clientInfo?: unknown } }
        | undefined;
      if (!body || body.method !== 'initialize') return;

      const clientInfo = body.params?.clientInfo as
        | { name?: unknown; version?: unknown }
        | undefined;

      const name =
        typeof clientInfo?.name === 'string' && clientInfo.name.length > 0
          ? clientInfo.name
          : null;
      const version =
        typeof clientInfo?.version === 'string' && clientInfo.version.length > 0
          ? clientInfo.version
          : null;
      const os = parseOsFromUserAgent(req.headers['user-agent']);

      // Build "<Name> <Version> · <OS>" with graceful omission of any missing
      // piece. If nothing useful is available, keep the coarse label as-is.
      const parts: string[] = [];
      if (name) parts.push(version ? `${name} ${version}` : name);
      else if (auth.session.surfaceLabel) parts.push(auth.session.surfaceLabel);
      if (os) parts.push(os);

      const augmentedLabel = parts.join(' · ');
      if (!augmentedLabel) return;

      await this.oauthService.augmentSurfaceLabel(
        auth.session.id,
        auth.session.surfaceLabel,
        augmentedLabel,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `surfaceLabel augmentation failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// UA parsing — narrow heuristic, OS-only. Good enough for surface labels;
// not exhaustive analytics. Returns null when no obvious OS is detectable.
// ---------------------------------------------------------------------------

function parseOsFromUserAgent(
  ua: string | string[] | undefined,
): string | null {
  const value = Array.isArray(ua) ? ua[0] : ua;
  if (!value) return null;
  if (/Mac OS X|Macintosh|macOS/i.test(value)) return 'macOS';
  if (/Windows/i.test(value)) return 'Windows';
  if (/Android/i.test(value)) return 'Android';
  if (/iPhone|iPad|iPod|iOS/i.test(value)) return 'iOS';
  if (/Linux/i.test(value)) return 'Linux';
  return null;
}
