import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const TOKEN_TTL_MS = 60_000; // scripts timeout at 30s, give 60s slack

@Injectable()
export class ScriptTokenService {
  private readonly key = crypto.randomBytes(32);

  sign(caseId: string): string {
    const ts = Date.now();
    const hmac = crypto
      .createHmac('sha256', this.key)
      .update(`${caseId}|${ts}`)
      .digest('hex');
    return Buffer.from(`${caseId}.${ts}.${hmac}`, 'utf8').toString('base64url');
  }

  verify(token: string): { caseId: string } | null {
    let decoded: string;
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const parts = decoded.split('.');
    if (parts.length !== 3) return null;
    const [caseId, tsStr, hmacHex] = parts;
    const ts = Number(tsStr);
    if (!caseId || !Number.isFinite(ts) || !hmacHex) return null;

    const expected = crypto
      .createHmac('sha256', this.key)
      .update(`${caseId}|${ts}`)
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
    return { caseId };
  }
}
