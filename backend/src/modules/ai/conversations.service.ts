import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
  ) {}

  /** Throws if the user is not a member of the case. */
  private async assertCaseMembership(userId: string, caseId: string): Promise<void> {
    const membership = await this.memberRepo.findOneBy({ userId, caseId });
    if (!membership) throw new ForbiddenException('You do not have access to this case');
  }

  async create(caseId: string, userId: string): Promise<ConversationEntity> {
    await this.assertCaseMembership(userId, caseId);
    return this.conversationRepo.save(
      this.conversationRepo.create({ caseId, userId, title: null }),
    );
  }

  async findAllForUserInCase(caseId: string, userId: string): Promise<ConversationEntity[]> {
    await this.assertCaseMembership(userId, caseId);
    return this.conversationRepo.find({
      where: { caseId, userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<ConversationEntity> {
    const conv = await this.conversationRepo.findOneBy({ id });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    if (conv.userId !== userId) throw new ForbiddenException('Not your conversation');
    // User owns the conversation, but they may have been removed from the
    // case since creating it — re-check membership here as defense-in-depth.
    await this.assertCaseMembership(userId, conv.caseId);
    return conv;
  }

  async getMessages(conversationId: string, userId: string): Promise<MessageEntity[]> {
    await this.findOne(conversationId, userId);
    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  async updateTitle(id: string, userId: string, title: string): Promise<void> {
    await this.findOne(id, userId);
    await this.conversationRepo.update(id, { title });
  }

  async delete(id: string, userId: string): Promise<void> {
    const conv = await this.findOne(id, userId);
    await this.conversationRepo.remove(conv);
  }
}
