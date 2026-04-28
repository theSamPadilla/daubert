import { IsString, MinLength, IsOptional, IsUUID, IsArray, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export const ALLOWED_MEDIA_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // CSV — broader set on purpose; the helper checks the file extension to disambiguate.
  'text/csv', 'application/csv', 'application/vnd.ms-excel',
  // Plain text / markdown — extension-gated server-side.
  'application/octet-stream', 'text/plain', 'text/markdown', '',
];

export class AttachmentDto {
  @IsString()
  name: string;

  @IsString()
  @IsIn(ALLOWED_MEDIA_TYPES)
  mediaType: string;

  @IsString()
  data: string; // base64-encoded
}

export class ChatMessageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  message?: string;

  @IsOptional()
  @IsUUID()
  caseId?: string;

  @IsOptional()
  @IsUUID()
  investigationId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  @IsOptional()
  @IsString()
  model?: string;
}
