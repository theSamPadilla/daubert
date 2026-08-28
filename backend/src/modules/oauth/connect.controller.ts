/**
 * OAuthConnectController — Connected-session management for Daubert MCP.
 *
 * These routes are protected by the global AuthGuard (Firebase). They are NOT
 * marked @Public() — the global guard enforces Firebase authentication before
 * any handler runs.
 *
 * Routes:
 *   - POST /me/oauth/start-connect       — returns MCP URL + setup instructions.
 *   - GET  /me/oauth-sessions            — lists the caller's non-revoked sessions.
 *   - GET  /me/agent-actions             — caller's recent agent audit rows.
 *   - POST /me/oauth-sessions/:id/revoke — ownership-checked per-session revoke.
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { In, IsNull, Repository } from 'typeorm';

import { AgentAuditLogEntity } from '../../database/entities/agent-audit-log.entity';
import { OAuthSessionEntity } from '../../database/entities/oauth-session.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { OAuthService } from './oauth.service';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface SurfaceInstructions {
  /** Ordered setup steps, rendered as a numbered list. */
  steps: string[];
  /** Optional prominent warning shown above the note (e.g. a costly default). */
  warning?: string;
  /** Optional caveat shown below the steps (e.g. Team/Enterprise plans). */
  note?: string;
}

export interface PerSurfaceInstructions {
  /** Setup instructions for Claude Desktop, claude.ai, and Cowork. */
  claudeApps: SurfaceInstructions;
  /** Setup instructions for ChatGPT. */
  chatgpt: SurfaceInstructions;
  /**
   * Setup instructions for Perplexity's custom remote connectors.
   *
   * Grouped under "Other agents" in the FE — unlike Claude and ChatGPT this
   * path is unverified. Perplexity's Dynamic Client Registration rejects
   * responses without a `client_secret`, and Daubert is a PKCE-only public
   * client that (correctly, per RFC 7591 §3.2.1) issues none, so connecting
   * may fail on their side until that is fixed.
   */
  perplexity: SurfaceInstructions;
}

export interface StartConnectResponse {
  mcpUrl: string;
  perSurfaceInstructions: PerSurfaceInstructions;
}

export interface OAuthSessionSummaryDto {
  id: string;
  organizationId: string;
  surfaceLabel: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface AgentActionDto {
  id: string;
  sessionId: string;
  /** Surface label of the session that performed the action ('Unknown agent' if the session row is gone). */
  agentLabel: string;
  organizationId: string;
  action: string;
  targetRef: string | null;
  status: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller()
export class OAuthConnectController {
  constructor(
    private readonly config: ConfigService,
    private readonly oauthService: OAuthService,
    @InjectRepository(OAuthSessionEntity)
    private readonly sessionRepo: Repository<OAuthSessionEntity>,
    @InjectRepository(AgentAuditLogEntity)
    private readonly auditRepo: Repository<AgentAuditLogEntity>,
  ) {}

  // -------------------------------------------------------------------------
  // POST /me/oauth/start-connect
  // -------------------------------------------------------------------------

  /**
   * Returns the MCP server URL and per-surface paste instructions.
   *
   * POST rather than GET to leave room for future telemetry rows.
   * Protected by the global Firebase AuthGuard — no additional guards needed.
   */
  @Post('me/oauth/start-connect')
  @HttpCode(HttpStatus.OK)
  startConnect(): StartConnectResponse {
    const issuer = this.config.getOrThrow<string>('OAUTH_ISSUER_URL');
    const mcpUrl = `${issuer}/mcp`;

    return {
      mcpUrl,
      perSurfaceInstructions: {
        claudeApps: {
          steps: [
            'Open your connectors: in Claude Desktop, claude.ai, or Cowork, go to Settings → Customize → Connectors. The old claude.ai/settings/connectors address is retired.',
            'Add a custom connector: scroll past the partner Directory, click the "+", then "Add custom connector", and fill in the two fields above. Leave Advanced settings empty, since Daubert supports Dynamic Client Registration and there is no client ID to enter.',
            'Sign in and pick your organization: Claude opens a browser tab where you sign in and choose which organization the agent may act on behalf of.',
            'Allow the tools once, not every time: reopen the connector, find Tool permissions, and set them to "Always allow".',
          ],
          note:
            'Claude only. On a Team or Enterprise plan, your workspace admin must first register Daubert under Organization settings → Connectors; you will then see a "Connect" button on the org-registered entry.',
        },
        chatgpt: {
          steps: [
            'Turn on developer mode: Settings → Plugins → Advanced, then enable developer mode. Custom MCP connectors do not appear until it is on, and the panel is called Plugins, not Connectors.',
            'Create a connector: click Create and fill in the two fields above.',
            'Sign in and pick your organization: ChatGPT opens a browser tab where you sign in and choose which organization the agent may act on behalf of.',
            'Approve the tools as they come up: ChatGPT asks before each write, and its "remember" option only holds for the current conversation.',
          ],
        },
        perplexity: {
          steps: [
            'Open your connectors: click "Customize" in the left sidebar, then the "Connectors" tab, at perplexity.ai/computer/connectors. On an Enterprise plan an admin must first turn on "Allow members to add custom connectors" under Enterprise settings → Connectors; it is off by default.',
            'Add a custom connector: click "+ Custom connector" in the top-right, choose "Remote" in the pop-up, and fill in the two fields above. On a Free plan that button is not there: the page lists first-party connectors only, and the "+" on each card adds that service rather than a custom one.',
            'Set Transport to "Streamable HTTP" and Authentication to "OAuth 2.0". Leave Client ID and Client Secret blank, since Daubert publishes OAuth discovery at /.well-known/oauth-authorization-server and Perplexity detects the endpoints itself. Leave Network access unset; Daubert is not behind Cloudflare Access.',
            'Tick the acknowledgement box and click Add, then click the connector card to start the sign-in flow and choose which organization the agent may act on behalf of. Let the sign-in tab finish on its own; closing it early can leave the connector unauthorized.',
            'Select Daubert in each new thread: Perplexity does not keep custom connectors switched on between chats the way Claude and ChatGPT do.',
          ],
          note:
            'Custom connectors need Perplexity Pro, Max, or Enterprise.',
        },
      },
    };
  }

  // -------------------------------------------------------------------------
  // GET /me/oauth-sessions
  // -------------------------------------------------------------------------

  /**
   * Returns the caller's active (non-revoked) OAuth sessions.
   *
   * Token hashes are never included in the DTO shape.
   * Only sessions where `revokedAt IS NULL` are returned.
   */
  @Get('me/oauth-sessions')
  async listSessions(
    @Req() req: Request,
  ): Promise<OAuthSessionSummaryDto[]> {
    const user = (req as unknown as { user?: UserEntity }).user;
    if (!user?.id) {
      throw new UnauthorizedException('No authenticated user on request');
    }

    const sessions = await this.sessionRepo.find({
      where: { ownerUserId: user.id, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    return sessions.map((s) => ({
      id: s.id,
      organizationId: s.organizationId,
      surfaceLabel: s.surfaceLabel,
      lastUsedAt: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  // -------------------------------------------------------------------------
  // GET /me/agent-actions
  // -------------------------------------------------------------------------

  /**
   * Returns the caller's recent agent-driven actions (mutations) from the
   * audit log, newest first, capped at 50. Each row is resolved to the
   * surface label of the session that performed it — including revoked
   * sessions, since audit history outlives the session.
   */
  @Get('me/agent-actions')
  async listAgentActions(@Req() req: Request): Promise<AgentActionDto[]> {
    const user = (req as unknown as { user?: UserEntity }).user;
    if (!user?.id) {
      throw new UnauthorizedException('No authenticated user on request');
    }

    const rows = await this.auditRepo.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    const sessionIds = [...new Set(rows.map((r) => r.sessionId))];
    const sessions = sessionIds.length
      ? await this.sessionRepo.find({ where: { id: In(sessionIds) } })
      : [];
    const labelById = new Map(sessions.map((s) => [s.id, s.surfaceLabel]));

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      agentLabel: labelById.get(r.sessionId) ?? 'Unknown agent',
      organizationId: r.organizationId,
      action: r.action,
      targetRef: r.targetRef,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // -------------------------------------------------------------------------
  // POST /me/oauth-sessions/:id/revoke
  // -------------------------------------------------------------------------

  /**
   * Revokes a single OAuth session by id (per-device disconnect).
   *
   * Ownership is asserted before revocation. Returns 404 if the session does
   * not exist OR belongs to a different user — no existence leak.
   * Idempotent: already-revoked sessions return 200 without calling the service.
   */
  @Post('me/oauth-sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    const user = (req as unknown as { user?: UserEntity }).user;
    if (!user?.id) {
      throw new UnauthorizedException('No authenticated user on request');
    }

    // Ownership check — load without filtering revokedAt so already-revoked
    // sessions still return 200 (idempotent) rather than 404.
    const session = await this.sessionRepo.findOne({
      where: { id, ownerUserId: user.id },
    });

    if (!session) {
      // 404 regardless of whether the session belongs to a different user —
      // don't leak existence information.
      throw new NotFoundException('Session not found');
    }

    if (session.revokedAt !== null) {
      // Already revoked — idempotent 200.
      return;
    }

    await this.oauthService.revokeSession(id, 'user');
  }
}
