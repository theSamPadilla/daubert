/**
 * McpModule — wires the MCP Streamable-HTTP endpoint.
 *
 * Imports:
 *   - OAuthModule           exports OAuthService + McpThrottleService (consumed by McpAuthHelper).
 *   - TypeOrmModule.forFeature([OrganizationMemberEntity])
 *                          for McpAuthHelper's per-call eligibility check
 *                          (re-loads the owner's membership row on every MCP
 *                          request to close the gap inside the access-token TTL).
 *   - AuthModule            exports CaseAccessService — the shared auth gate
 *                          every case-scoped tool calls before touching a
 *                          case resource. MUST be imported here so the tool
 *                          services can inject it.
 *   - CasesModule           exports CasesService for navigate tools.
 *   - InvestigationsModule  exports InvestigationsService for navigate tools.
 *
 * Providers:
 *   - McpAuthHelper, McpToolsService — top-level controllers/dispatchers.
 *   - NavigateToolsService — first per-domain tool group (Task 12). Later
 *     tasks add additional `*ToolsService` providers here and have
 *     `McpToolsService.registerForScope` call into them.
 *   - McpIpThrottlerGuard — declared here so the route-level
 *     @UseGuards(McpIpThrottlerGuard) on McpController resolves through
 *     this module's DI context.
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { McpIpThrottlerGuard } from '../../common/guards/mcp-ip-throttler.guard';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { AuthModule } from '../auth/auth.module';
import { CasesModule } from '../cases/cases.module';
import { InvestigationsModule } from '../investigations/investigations.module';
import { OAuthModule } from '../oauth/oauth.module';
import { McpAuthHelper } from './mcp-auth.helper';
import { McpController } from './mcp.controller';
import { McpToolsService } from './mcp.tools';
import { NavigateToolsService } from './tools/navigate-tools';

@Module({
  imports: [
    OAuthModule, // exports OAuthService + McpThrottleService
    TypeOrmModule.forFeature([OrganizationMemberEntity]),
    AuthModule, // exports CaseAccessService
    CasesModule, // exports CasesService
    InvestigationsModule, // exports InvestigationsService
  ],
  controllers: [McpController],
  providers: [
    McpAuthHelper,
    McpToolsService,
    NavigateToolsService,
    McpIpThrottlerGuard,
  ],
})
export class McpModule {}
