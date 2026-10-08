import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { ScriptRunEntity } from '../../database/entities/script-run.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { AgentRunEntity } from '../../database/entities/agent-run.entity';
import { AgentRunEventEntity } from '../../database/entities/agent-run-event.entity';
import { TraceEntity } from '../../database/entities/trace.entity';
import { AnthropicProvider } from './providers/anthropic.provider';
import { ScriptExecutionService } from './services/script-execution.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ConversationsController, CaseConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { AgentRunsController } from './runs/agent-runs.controller';
import { AgentRunsInternalController } from './runs/agent-runs-internal.controller';
import { AgentRunsService } from './runs/agent-runs.service';
import { AgentRunExecutor } from './runs/agent-run-executor.service';
import { AgentRunLauncher } from './runs/agent-run-launcher.service';
import { AgentRunEventsStreamer } from './runs/agent-run-events.streamer';
import { agentRunDispatcherProvider } from './runs/dispatch/dispatcher.factory';
import { AuthModule } from '../auth/auth.module';
import { LabeledEntitiesModule } from '../labeled-entities/labeled-entities.module';
import { ProductionsModule } from '../productions/productions.module';
import { ScriptModule } from '../script/script.module';
import { TracesModule } from '../traces/traces.module';
import { TokenUsageModule } from '../superadmin/token-usage/token-usage.module';
import { DataRoomModule } from '../data-room/data-room.module';
import { DeclarationLibraryModule } from '../declaration-library/declaration-library.module';
import { DeclarantsModule } from '../declarants/declarants.module';
import { AddressClassificationsModule } from '../address-classifications/address-classifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      InvestigationEntity,
      ScriptRunEntity,
      CaseMemberEntity,
      CaseEntity,
      TraceEntity,
      AgentRunEntity,
      AgentRunEventEntity,
    ]),
    AuthModule,
    LabeledEntitiesModule,
    ProductionsModule,
    ScriptModule,
    TracesModule,
    TokenUsageModule,
    DataRoomModule,
    DeclarationLibraryModule,
    DeclarantsModule,
    AddressClassificationsModule,
  ],
  controllers: [AiController, ConversationsController, CaseConversationsController,
    AgentRunsController, AgentRunsInternalController],
  providers: [
    AnthropicProvider,
    ScriptExecutionService,
    AiService,
    ConversationsService,
    AgentRunsService,
    AgentRunExecutor,
    AgentRunLauncher,
    AgentRunEventsStreamer,
    agentRunDispatcherProvider,
  ],
  exports: [AiService],
})
export class AiModule {}
