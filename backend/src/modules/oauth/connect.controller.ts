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
import { IsNull, Repository } from 'typeorm';

import { OAuthSessionEntity } from '../../database/entities/oauth-session.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { OAuthService } from './oauth.service';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface PerSurfaceInstructions {
  /** Setup instructions for Claude Desktop, claude.ai, and Cowork. */
  claudeApps: string;
  /** Copyable terminal command for Claude Code. */
  claudeCode: string;
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
        claudeApps:
          'In Claude (Desktop, claude.ai, or Cowork), open Settings → Connectors. Scroll past the partner Directory and click the "+" button, then choose "Add custom connector". Give it a name (e.g. "Daubert"), paste the URL above, leave Advanced settings empty (Daubert supports Dynamic Client Registration), and click Add. Claude will open a browser tab for sign-in. If your Claude account is on a Team or Enterprise plan, your workspace admin needs to register Daubert from Organization settings → Connectors first; you\'ll then see a "Connect" button on the org-registered entry.',
        claudeCode: `Run this in your terminal: \`claude mcp add --transport http daubert ${mcpUrl}\``,
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
