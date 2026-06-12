import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentAuditLogEntity } from '../../database/entities/agent-audit-log.entity';

export interface AgentAuditLogParams {
  sessionId: string;
  userId: string;
  organizationId: string;
  action: string;
  status: 'ok' | 'error';
  targetRef?: string | null;
  detail?: Record<string, unknown> | null;
}

@Injectable()
export class AgentAuditService {
  constructor(
    @InjectRepository(AgentAuditLogEntity)
    private readonly repo: Repository<AgentAuditLogEntity>,
  ) {}

  async log(params: AgentAuditLogParams): Promise<void> {
    const entity = this.repo.create({
      sessionId: params.sessionId,
      userId: params.userId,
      organizationId: params.organizationId,
      action: params.action,
      status: params.status,
      targetRef: params.targetRef ?? null,
      detail: params.detail ?? null,
    });
    await this.repo.save(entity);
  }
}
