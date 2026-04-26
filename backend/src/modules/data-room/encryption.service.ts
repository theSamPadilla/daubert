import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const KEY_BYTES = 32; // AES-256

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * AES-256-GCM encryption for credentials at rest (Google Drive OAuth tokens).
 *
 * Reads `DATAROOM_ENCRYPTION_KEY` lazily on first use — not at construction.
 * This matches env-validation's behavior of warning-in-dev for the data-room
 * vars: the backend can boot without the key set, but any actual data-room
 * operation throws a clear error pointing the operator at the env var.
 *
 * The key must be a 32-byte value encoded as 64 hex chars (generate with
 * `openssl rand -hex 32`). Per-call random IV (12 bytes) ensures ciphertext
 * uniqueness across rows.
 *
 * TODO: key versioning for rotation. Add a `keyId` column to encrypted rows
 * and accept a key map keyed by id; rotate by re-encrypting under a new id.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private cachedKey: Buffer | null = null;

  /** Resolve the key on demand. Throws with a clear message if unset/invalid. */
  private getKey(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    const hex = process.env.DATAROOM_ENCRYPTION_KEY;
    if (!hex) {
      throw new Error(
        'DATAROOM_ENCRYPTION_KEY is not set. Generate with `openssl rand -hex 32` and add it to backend/.env.development (or your prod env).',
      );
    }
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error('DATAROOM_ENCRYPTION_KEY must be hex-encoded.');
    }
    const buf = Buffer.from(hex, 'hex');
    if (buf.length !== KEY_BYTES) {
      throw new Error(
        `DATAROOM_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length}). Use \`openssl rand -hex 32\`.`,
      );
    }
    this.cachedKey = buf;
    return buf;
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.getKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return { ciphertext, iv, authTag };
  }

  decrypt({ ciphertext, iv, authTag }: EncryptedPayload): string {
    const decipher = crypto.createDecipheriv(ALGORITHM, this.getKey(), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
