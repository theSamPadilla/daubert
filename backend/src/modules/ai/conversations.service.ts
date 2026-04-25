import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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

  async create(caseId: string, userId?: string): Promise<ConversationEntity> {
    // Verify user has access to the case
    if (userId) {
      const membership = await this.memberRepo.findOneBy({ userId, caseId });
      if (!membership) throw new ForbiddenException('You do not have access to this case');
    }

    const conversation = this.conversationRepo.create({
      title: null,
      caseId,
    });
    return this.conversationRepo.save(conversation);
  }

  async findAllForUser(userId: string): Promise<ConversationEntity[]> {
    const memberships = await this.memberRepo.find({
      where: { userId },
      select: ['caseId'],
    });
    const caseIds = memberships.map((m) => m.caseId);

    if (caseIds.length === 0) return [];

    return this.conversationRepo.find({
      where: { caseId: In(caseIds) },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId?: string): Promise<ConversationEntity> {
    const conv = await this.conversationRepo.findOneBy({ id });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);

    // Verify user has access to the conversation's case
    if (userId && conv.caseId) {
      const membership = await this.memberRepo.findOneBy({ userId, caseId: conv.caseId });
      if (!membership) throw new ForbiddenException('You do not have access to this conversation');
    }

    return conv;
  }

  async getMessages(conversationId: string, userId?: string): Promise<MessageEntity[]> {
    await this.findOne(conversationId, userId);
    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  async updateTitle(id: string, title: string): Promise<void> {
    await this.conversationRepo.update(id, { title });
  }

  async delete(id: string, userId?: string): Promise<void> {
    const conv = await this.findOne(id, userId);
    await this.conversationRepo.remove(conv);
  }
}
