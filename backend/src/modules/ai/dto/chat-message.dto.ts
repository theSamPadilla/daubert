import { IsString, MinLength, IsOptional, IsUUID, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AttachmentDto {
  @IsString()
  name: string;

  @IsString()
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
