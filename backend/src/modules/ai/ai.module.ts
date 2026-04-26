import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { ScriptRunEntity } from '../../database/entities/script-run.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { AnthropicProvider } from './providers/anthropic.provider';
import { ScriptExecutionService } from './services/script-execution.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { AuthModule } from '../auth/auth.module';
import { LabeledEntitiesModule } from '../labeled-entities/labeled-entities.module';
import { ProductionsModule } from '../productions/productions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      InvestigationEntity,
      ScriptRunEntity,
      CaseMemberEntity,
    ]),
    AuthModule,
    LabeledEntitiesModule,
    ProductionsModule,
  ],
  controllers: [AiController, ConversationsController],
  providers: [
    AnthropicProvider,
    ScriptExecutionService,
    AiService,
    ConversationsService,
  ],
  exports: [AiService],
})
export class AiModule {}
