import { IsIn } from 'class-validator';

export const CONVERSATION_EXPORT_FORMATS = ['pdf', 'docx'] as const;
export type ConversationExportFormat = (typeof CONVERSATION_EXPORT_FORMATS)[number];

export class ExportConversationDto {
  @IsIn(CONVERSATION_EXPORT_FORMATS)
  format: ConversationExportFormat;
}
