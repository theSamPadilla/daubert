import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
  ) {}

  async create(): Promise<ConversationEntity> {
    const conversation = this.conversationRepo.create({ title: null });
    return this.conversationRepo.save(conversation);
  }

  async findAll(): Promise<ConversationEntity[]> {
    return this.conversationRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<ConversationEntity> {
    const conv = await this.conversationRepo.findOneBy({ id });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  async getMessages(conversationId: string): Promise<MessageEntity[]> {
    await this.findOne(conversationId);
    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  async updateTitle(id: string, title: string): Promise<void> {
    await this.conversationRepo.update(id, { title });
  }

  async delete(id: string): Promise<void> {
    const conv = await this.findOne(id);
    await this.conversationRepo.remove(conv);
  }
}
