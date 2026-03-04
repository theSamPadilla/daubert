// backend/src/modules/ai/ai.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      CaseEntity,
      InvestigationEntity,
    ]),
  ],
  controllers: [AiController, ConversationsController],
  providers: [AiService, ConversationsService],
  exports: [AiService],
})
export class AiModule {}
