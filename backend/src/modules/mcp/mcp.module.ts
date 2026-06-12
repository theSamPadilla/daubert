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
 *   - NavigateToolsService — navigate tool group (Task 12).
 *   - ReadToolsService — read tool group (Task 13).
 *   - BlockchainToolsService — blockchain tool group (Task 14). Later
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
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { AgentAuditLogEntity } from '../../database/entities/agent-audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { CasesModule } from '../cases/cases.module';
import { InvestigationsModule } from '../investigations/investigations.module';
import { TracesModule } from '../traces/traces.module';
import { ProductionsModule } from '../productions/productions.module';
import { DataRoomModule } from '../data-room/data-room.module';
import { LabeledEntitiesModule } from '../labeled-entities/labeled-entities.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { OAuthModule } from '../oauth/oauth.module';
import { McpAuthHelper } from './mcp-auth.helper';
import { McpController } from './mcp.controller';
import { McpToolsService } from './mcp.tools';
import { NavigateToolsService } from './tools/navigate-tools';
import { ReadToolsService } from './tools/read-tools';
import { BlockchainToolsService } from './tools/blockchain-tools';
import { WriteToolsService } from './tools/write-tools';
import { AgentAuditService } from './agent-audit.service';

@Module({
  imports: [
    OAuthModule,          // exports OAuthService + McpThrottleService
    TypeOrmModule.forFeature([OrganizationMemberEntity, InvestigationEntity, AgentAuditLogEntity]),
    AuthModule,           // exports CaseAccessService
    CasesModule,          // exports CasesService
    InvestigationsModule, // exports InvestigationsService
    TracesModule,         // exports TracesService (for WriteToolsService)
    ProductionsModule,    // exports ProductionsService
    DataRoomModule,       // exports DataRoomService
    LabeledEntitiesModule, // exports LabeledEntitiesService
    BlockchainModule,      // exports BlockchainService
  ],
  controllers: [McpController],
  providers: [
    McpAuthHelper,
    McpToolsService,
    NavigateToolsService,
    ReadToolsService,
    BlockchainToolsService,
    WriteToolsService,
    AgentAuditService,
    McpIpThrottlerGuard,
  ],
})
export class McpModule {}
