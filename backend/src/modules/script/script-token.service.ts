import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { CaseRole } from '../../database/entities/case-member.entity';

const TOKEN_TTL_MS = 60_000; // scripts timeout at 30s, give 60s slack
const VALID_ROLES: ReadonlySet<CaseRole> = new Set(['viewer', 'editor', 'owner']);

@Injectable()
export class ScriptTokenService {
  private readonly key = crypto.randomBytes(32);

  sign(caseId: string, role: CaseRole): string {
    const ts = Date.now();
    const hmac = crypto
      .createHmac('sha256', this.key)
      .update(`${caseId}|${role}|${ts}`)
      .digest('hex');
    return Buffer.from(`${caseId}.${role}.${ts}.${hmac}`, 'utf8').toString('base64url');
  }

  verify(token: string): { caseId: string; role: CaseRole } | null {
    let decoded: string;
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const parts = decoded.split('.');
    if (parts.length !== 4) return null;
    const [caseId, role, tsStr, hmacHex] = parts;
    const ts = Number(tsStr);
    if (!caseId || !role || !Number.isFinite(ts) || !hmacHex) return null;
    if (!VALID_ROLES.has(role as CaseRole)) return null;

    const expected = crypto
      .createHmac('sha256', this.key)
      .update(`${caseId}|${role}|${ts}`)
      .digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(hmacHex, 'hex');
    } catch {
      return null;
    }
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      return null;
    }
    if (Date.now() - ts > TOKEN_TTL_MS) return null;
    return { caseId, role: role as CaseRole };
  }
}
