import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { ScriptRunEntity } from '../../database/entities/script-run.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { TraceEntity } from '../../database/entities/trace.entity';
import { DataRoomConnectionEntity } from '../../database/entities/data-room-connection.entity';
import { AnthropicProvider } from './providers/anthropic.provider';
import { ScriptExecutionService } from './services/script-execution.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ConversationsController, CaseConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { AuthModule } from '../auth/auth.module';
import { LabeledEntitiesModule } from '../labeled-entities/labeled-entities.module';
import { ProductionsModule } from '../productions/productions.module';
import { ScriptModule } from '../script/script.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      InvestigationEntity,
      ScriptRunEntity,
      CaseMemberEntity,
      TraceEntity,
      DataRoomConnectionEntity,
    ]),
    AuthModule,
    LabeledEntitiesModule,
    ProductionsModule,
    ScriptModule,
  ],
  controllers: [AiController, ConversationsController, CaseConversationsController],
  providers: [
    AnthropicProvider,
    ScriptExecutionService,
    AiService,
    ConversationsService,
  ],
  exports: [AiService],
})
export class AiModule {}
