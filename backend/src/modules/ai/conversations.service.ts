import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadGatewayException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { AgentRunEntity, ACTIVE_RUN_STATUSES } from '../../database/entities/agent-run.entity';
import { ConversationSummaryService } from './conversation-summary.service';
import { CaseAccessService } from '../auth/case-access.service';
import { TOOL_RESULT_TERMINATOR } from './runs/run-abort';
import { DATA_ROOM_ATTACHED_PREFIX, FILE_CONTENT_MARKER } from './data-room-rehydrate';
import { ExportService } from '../export/export.service';
import { buildTranscript } from './conversation-transcript';
import { conversationFilenameSlug } from './conversation-filename';
import { renderConversation, CONVERSATION_PDF_OPTIONS } from '../export/templates/conversation';
import type { ConversationExportFormat } from './dto/export-conversation.dto';

/** A conversation as the API returns it (the generated Conversation type). */
export type ConversationView = Omit<ConversationEntity, 'continuedFrom' | 'messages' | 'case' | 'user'> & {
  oldestMessageAt: string | null;
  continuedFromTitle: string | null;
};

function toView(
  c: ConversationEntity,
  extra: { oldestMessageAt: string | null; continuedFromTitle: string | null },
): ConversationView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { continuedFrom, messages, case: _case, user, ...rest } = c;
  return {
    ...rest,
    contextTokens: c.contextTokens ?? 0,
    seedSummary: c.seedSummary ?? null,
    continuedFromConversationId: c.continuedFromConversationId ?? null,
    ...extra,
  };
}

/** The synthetic assistant row saved before a file read's pointer row. It
 *  exists for API role alternation; the tool chip already shows the read. */
function isFileContentMarker(m: MessageEntity): boolean {
  const blocks = Array.isArray(m.content) ? (m.content as Array<{ type?: string; text?: string }>) : [];
  return (
    m.role === 'assistant' &&
    blocks.length > 0 &&
    blocks.every((b) => b?.type === 'text' && b.text === FILE_CONTENT_MARKER)
  );
}

/** A user row with chat attachments carries an agent-facing note listing the
 *  saved files (see AiService.persistUserMessage); the chips already show them. */
function withoutAttachedNote(m: MessageEntity): MessageEntity {
  if (m.role !== 'user' || !Array.isArray(m.content)) return m;
  const blocks = m.content as Array<{ type?: string; text?: string; origin?: string }>;
  // Only a row that really carries an upload pointer has the agent-written note;
  // a user who typed the same words keeps their text.
  if (!blocks.some((b) => b?.type === 'data_room_ref' && b.origin === 'upload')) return m;
  const isNote = (b: { type?: string; text?: string }) =>
    b?.type === 'text' && typeof b.text === 'string' && b.text.startsWith(DATA_ROOM_ATTACHED_PREFIX);
  if (!blocks.some(isNote)) return m;
  return { ...m, content: blocks.filter((b) => !isNote(b)) } as MessageEntity;
}

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @InjectRepository(CaseMemberEntity)
    private readonly memberRepo: Repository<CaseMemberEntity>,
    private readonly caseAccess: CaseAccessService,
    private readonly exportService: ExportService,
    @InjectRepository(AgentRunEntity)
    private readonly runRepo: Repository<AgentRunEntity>,
    private readonly summaryService: ConversationSummaryService,
  ) {}

  private readonly logger = new Logger(ConversationsService.name);

  /** Throws if the user has no access to the case (member OR implicit org admin). */
  private async assertCaseMembership(userId: string, caseId: string): Promise<void> {
    await this.caseAccess.assertAccess({ kind: 'user', userId }, caseId);
  }

  async create(caseId: string, userId: string): Promise<ConversationView> {
    await this.assertCaseMembership(userId, caseId);
    const saved = await this.conversationRepo.save(
      this.conversationRepo.create({ caseId, userId, title: null }),
    );
    return toView(saved, { oldestMessageAt: null, continuedFromTitle: null });
  }

  /**
   * "Continue in a new conversation": summarize the owner's conversation and
   * start a new one in the same case seeded with that summary. Nothing is
   * created when the summary fails. The caller sweeps stale runs first.
   */
  async continue(id: string, userId: string): Promise<ConversationView> {
    const source = await this.findOne(id, userId); // owner + case membership
    const active = await this.runRepo.findOne({
      where: { conversationId: id, status: In(ACTIVE_RUN_STATUSES) },
    });
    if (active) {
      throw new ConflictException(
        'The assistant is still working in this conversation. Wait for it to finish or stop it, then try again.',
      );
    }

    let summary: string;
    try {
      summary = await this.summaryService.summarize(id);
    } catch (err) {
      this.logger.error(
        `conversation_summary_failed conversationId=${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadGatewayException(
        'Could not summarize this conversation, so no new conversation was created. Please try again.',
      );
    }

    const saved = await this.conversationRepo.save(
      this.conversationRepo.create({
        caseId: source.caseId,
        userId,
        title: `${source.title?.trim() || 'Untitled conversation'} (continued)`,
        seedSummary: summary,
        continuedFromConversationId: source.id,
      }),
    );
    return toView(saved, { oldestMessageAt: null, continuedFromTitle: source.title ?? null });
  }

  async findAllForUserInCase(caseId: string, userId: string): Promise<ConversationView[]> {
    await this.assertCaseMembership(userId, caseId);
    // One left join selecting only the source title, not the whole source row.
    const convs = await this.conversationRepo
      .createQueryBuilder('c')
      .leftJoin('c.continuedFrom', 'cf')
      .addSelect(['cf.id', 'cf.title']) // TypeORM hydrates a partial join only when its primary key is selected
      .where('c.caseId = :caseId', { caseId })
      .andWhere('c.userId = :userId', { userId })
      .orderBy('c.createdAt', 'DESC')
      .getMany();
    if (convs.length === 0) return [];
    // One grouped MIN over the (conversation_id, created_at) index, not one query per row.
    const rows: Array<{ conversationId: string; oldest: Date | string | null }> = await this.messageRepo
      .createQueryBuilder('m')
      .select('m.conversation_id', 'conversationId')
      .addSelect('MIN(m.created_at)', 'oldest')
      .where('m.conversation_id IN (:...ids)', { ids: convs.map((c) => c.id) })
      .groupBy('m.conversation_id')
      .getRawMany();
    const oldestById = new Map(
      rows.filter((r) => r.oldest != null).map((r) => [r.conversationId, new Date(r.oldest as Date | string).toISOString()]),
    );
    return convs.map((c) =>
      toView(c, {
        oldestMessageAt: oldestById.get(c.id) ?? null,
        continuedFromTitle: c.continuedFrom?.title ?? null,
      }),
    );
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

  /** Messages as the chat UI shows them: agent-loop bookkeeping rows removed.
   *  Use {@link getMessages} for the full history sent to the model. */
  async getMessagesForDisplay(conversationId: string, userId: string): Promise<MessageEntity[]> {
    const rows = await this.getMessages(conversationId, userId);
    return rows.filter((m) => !isFileContentMarker(m)).map(withoutAttachedNote);
  }

  async updateTitle(id: string, userId: string, title: string): Promise<void> {
    await this.findOne(id, userId);
    await this.conversationRepo.update(id, { title });
  }

  async delete(id: string, userId: string): Promise<void> {
    const conv = await this.findOne(id, userId);
    await this.conversationRepo.remove(conv);
  }

  /**
   * Append the synthetic assistant terminator if the conversation ends in a
   * user turn made only of tool_result blocks. AiService.runTurn does this
   * itself when it exits cleanly; this covers runs that died without running
   * their finally block (see AgentRunsService.sweepStale).
   */
  async appendTerminatorIfToolResultTail(conversationId: string): Promise<void> {
    const last = await this.messageRepo.findOne({
      where: { conversationId },
      order: { createdAt: 'DESC' },
    });
    if (!last || last.role !== 'user') return;
    const blocks = last.content as Array<{ type?: string }>;
    if (blocks.length === 0 || !blocks.every((b) => b?.type === 'tool_result')) return;
    await this.messageRepo.save(
      this.messageRepo.create({
        conversationId,
        role: 'assistant',
        content: [{ type: 'text', text: TOOL_RESULT_TERMINATOR }],
      }),
    );
  }

  /** Remove one message. Used to roll back a run that could not be dispatched. */
  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    await this.messageRepo.delete({ id: messageId, conversationId });
  }

  /** Render the owner's conversation as a PDF or DOCX transcript. */
  async export(
    id: string,
    userId: string,
    format: ConversationExportFormat,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    await this.findOne(id, userId); // owner + case membership
    const conv = await this.conversationRepo.findOne({
      where: { id },
      relations: { case: true, user: true },
    });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    const rows = await this.messageRepo.find({
      where: { conversationId: id },
      order: { createdAt: 'ASC' },
    });
    const html = renderConversation({
      title: conv.title,
      caseName: conv.case?.name ?? '',
      ownerName: conv.user?.name || conv.user?.email || '',
      exportedAt: new Date().toISOString(),
      firstMessageAt: rows.length ? new Date(rows[0].createdAt).toISOString() : null,
      entries: buildTranscript(rows),
      truncatedByRetention: conv.historyTruncatedAt != null,
      format,
    });
    const stem = conversationFilenameSlug(conv.title, new Date(conv.createdAt));
    if (format === 'docx') {
      return {
        buffer: await this.exportService.htmlToDocx(html),
        filename: `${stem}.docx`,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    }
    return {
      buffer: await this.exportService.htmlToPdf(html, { ...CONVERSATION_PDF_OPTIONS }),
      filename: `${stem}.pdf`,
      contentType: 'application/pdf',
    };
  }
}
