import { IsString, MinLength, IsOptional, IsUUID } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @MinLength(1)
  message: string;

  @IsOptional()
  @IsUUID()
  caseId?: string;

  @IsOptional()
  @IsUUID()
  investigationId?: string;
}
