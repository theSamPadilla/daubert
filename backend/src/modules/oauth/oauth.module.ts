/**
 * OAuthModule — Nest module for the OAuth 2.1 Authorization Server.
 *
 * Wires:
 *   - TypeORM entities consumed by providers/controllers:
 *       OAuthClientEntity     — OAuthService (registerDynamicClient, exchangeCode)
 *                             + AuthorizeController (client lookup)
 *       OAuthSessionEntity    — OAuthService (session CRUD) + OAuthConnectController
 *       OAuthCodeEntity       — OAuthService (issueCode, exchangeCode)
 *       OAuthConsumedStateEntity — StateBagService (replay protection)
 *       OrganizationMemberEntity — OAuthService (refresh-time eligibility re-check)
 *                               + AuthorizeController (eligibility gate)
 *       UserEntity            — not injected by repo here, but UserEntity is
 *                               already registered by AuthModule's TypeOrmModule
 *                               export; UsersService (from UsersModule) provides
 *                               the query used by AuthorizeController.
 *
 *   - Providers: OAuthService, StateBagService, McpThrottleService,
 *     McpIpThrottlerGuard (guard is Injectable; must be provided so that
 *     @UseGuards(McpIpThrottlerGuard) on OAuthController.register works without
 *     relying on DI fallback).
 *
 *   - Controllers: OAuthController, AuthorizeController, OAuthConnectController.
 *
 * Imports:
 *   - AuthModule: exports `firebaseAdminProvider` (FIREBASE_ADMIN token) needed
 *     by AuthorizeController, and TypeOrmModule (with UserEntity) needed by
 *     AuthModule's re-export for UserEntity resolution. UsersService is NOT
 *     exported by AuthModule — it's available via UsersModule.
 *   - UsersModule: exports UsersService, which AuthorizeController injects for
 *     Firebase UID → UserEntity lookups.
 *   - ConfigModule is global (isGlobal: true) — no import needed here.
 *
 * Exports:
 *   - OAuthService: consumed by the future McpModule for access-token validation.
 *   - McpThrottleService: consumed by the future McpModule for per-session
 *     sliding-window rate limiting.
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { McpIpThrottlerGuard } from '../../common/guards/mcp-ip-throttler.guard';
import { McpThrottleService } from '../../common/throttle/mcp-throttle';
import { OAuthClientEntity } from '../../database/entities/oauth-client.entity';
import { OAuthCodeEntity } from '../../database/entities/oauth-code.entity';
import { OAuthConsumedStateEntity } from '../../database/entities/oauth-consumed-state.entity';
import { OAuthSessionEntity } from '../../database/entities/oauth-session.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AuthorizeController } from './authorize.controller';
import { OAuthConnectController } from './connect.controller';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { StateBagService } from './state-bag.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OAuthClientEntity,
      OAuthSessionEntity,
      OAuthCodeEntity,
      OAuthConsumedStateEntity,
      OrganizationMemberEntity,
    ]),
    AuthModule,
    UsersModule,
  ],
  controllers: [OAuthController, AuthorizeController, OAuthConnectController],
  providers: [
    OAuthService,
    StateBagService,
    McpThrottleService,
    McpIpThrottlerGuard,
  ],
  exports: [OAuthService, McpThrottleService],
})
export class OAuthModule {}
