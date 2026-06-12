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
  /** Optional caveat shown below the steps (e.g. Team/Enterprise plans). */
  note?: string;
  /** Optional copyable terminal command. */
  command?: string;
}

export interface PerSurfaceInstructions {
  /** Setup instructions for Claude Desktop, claude.ai, and Cowork. */
  claudeApps: SurfaceInstructions;
  /** Setup instructions for Claude Code (terminal). */
  claudeCode: SurfaceInstructions;
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
            'Open Settings, then Connectors, in Claude Desktop, claude.ai, or Cowork.',
            'Scroll past the partner Directory and click the "+" (Add custom connector) button.',
            'Name it "Daubert" and paste the MCP server URL above.',
            'Leave Advanced settings empty. Daubert supports Dynamic Client Registration, so no client ID is needed.',
            'Click Add. Claude opens a browser tab where you sign in and approve access.',
          ],
          note:
            'On a Team or Enterprise plan? Your workspace admin must first register Daubert under Organization settings → Connectors; you\'ll then see a "Connect" button on the org-registered entry.',
        },
        claudeCode: {
          steps: [
            'Run the command below in your terminal.',
            'Then run /mcp inside Claude Code and pick "daubert" to sign in via your browser.',
          ],
          command: `claude mcp add --transport http daubert ${mcpUrl}`,
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
