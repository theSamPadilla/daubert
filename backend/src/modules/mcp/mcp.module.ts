/**
 * McpModule — Task 11.
 *
 * Wires the MCP Streamable-HTTP endpoint:
 *   - OAuthModule exports OAuthService + McpThrottleService (consumed by McpAuthHelper).
 *   - TypeOrmModule.forFeature([OrganizationMemberEntity]) for McpAuthHelper's
 *     per-call eligibility check (re-loads the owner's membership row on every
 *     MCP request to close the gap inside the access-token TTL).
 *   - McpAuthHelper, McpToolsService, McpIpThrottlerGuard as providers.
 *   - McpController as the sole controller.
 *
 * Note: McpIpThrottlerGuard is already provided in OAuthModule; it is also
 * declared here so @UseGuards(McpIpThrottlerGuard) on McpController resolves
 * correctly via McpModule's own DI context without relying on OAuthModule's
 * provider list.
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { McpIpThrottlerGuard } from '../../common/guards/mcp-ip-throttler.guard';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { OAuthModule } from '../oauth/oauth.module';
import { McpAuthHelper } from './mcp-auth.helper';
import { McpController } from './mcp.controller';
import { McpToolsService } from './mcp.tools';

@Module({
  imports: [
    OAuthModule, // exports OAuthService + McpThrottleService
    TypeOrmModule.forFeature([OrganizationMemberEntity]),
  ],
  controllers: [McpController],
  providers: [McpAuthHelper, McpToolsService, McpIpThrottlerGuard],
})
export class McpModule {}
