import { EncryptionService } from './encryption.service';

const TEST_KEY_A = '00'.repeat(32); // 64 hex chars => 32 bytes
const TEST_KEY_B = '11'.repeat(32);

/**
 * Helper: build a fresh EncryptionService bound to `keyHex`.
 * The service reads the key from `process.env.DATAROOM_ENCRYPTION_KEY` at
 * construction, so we set/clear the env var around each instantiation.
 */
function makeService(keyHex: string | undefined): EncryptionService {
  if (keyHex === undefined) {
    delete process.env.DATAROOM_ENCRYPTION_KEY;
  } else {
    process.env.DATAROOM_ENCRYPTION_KEY = keyHex;
  }
  return new EncryptionService();
}

describe('EncryptionService', () => {
  const originalKey = process.env.DATAROOM_ENCRYPTION_KEY;

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.DATAROOM_ENCRYPTION_KEY;
    } else {
      process.env.DATAROOM_ENCRYPTION_KEY = originalKey;
    }
  });

  // ---------------------------------------------------------------------------
  // Constructor validation
  // ---------------------------------------------------------------------------
  describe('constructor', () => {
    it('throws when DATAROOM_ENCRYPTION_KEY is missing', () => {
      expect(() => makeService(undefined)).toThrow(
        /DATAROOM_ENCRYPTION_KEY is not set/,
      );
    });

    it('throws when DATAROOM_ENCRYPTION_KEY is non-hex', () => {
      expect(() => makeService('not-hex-zzz')).toThrow(/hex-encoded/);
    });

    it('throws when DATAROOM_ENCRYPTION_KEY decodes to wrong length', () => {
      // 16 bytes = 32 hex chars (AES-128 length, not allowed here).
      expect(() => makeService('00'.repeat(16))).toThrow(/32 bytes/);
    });

    it('constructs successfully with a valid 32-byte hex key', () => {
      expect(() => makeService(TEST_KEY_A)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // encrypt / decrypt round-trip
  // ---------------------------------------------------------------------------
  describe('encrypt / decrypt', () => {
    let svc: EncryptionService;
    beforeEach(() => {
      svc = makeService(TEST_KEY_A);
    });

    it('round-trips plaintext through encrypt/decrypt', () => {
      const plaintext = JSON.stringify({
        accessToken: 'ya29.test',
        refreshToken: '1//refresh-token-test',
        expiry: '2030-01-01T00:00:00Z',
      });
      const payload = svc.encrypt(plaintext);
      const decoded = svc.decrypt(payload);
      expect(decoded).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
      const payload = svc.encrypt('');
      expect(svc.decrypt(payload)).toBe('');
    });

    it('round-trips multibyte unicode', () => {
      const plaintext = 'héllo 世界 🚀';
      const payload = svc.encrypt(plaintext);
      expect(svc.decrypt(payload)).toBe(plaintext);
    });

    it('produces different ciphertext + iv on repeated encrypt of the same plaintext', () => {
      const plaintext = 'same-plaintext';
      const a = svc.encrypt(plaintext);
      const b = svc.encrypt(plaintext);

      // IV must differ (random per call).
      expect(a.iv.equals(b.iv)).toBe(false);
      // Ciphertext must differ as a consequence (GCM with random IV).
      expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
      // But both still decrypt to the original.
      expect(svc.decrypt(a)).toBe(plaintext);
      expect(svc.decrypt(b)).toBe(plaintext);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-key + tamper resistance
  // ---------------------------------------------------------------------------
  describe('tamper / wrong-key behaviour', () => {
    it('decrypt throws when the key is different from the one used to encrypt', () => {
      const svcA = makeService(TEST_KEY_A);
      const payload = svcA.encrypt('top-secret');

      const svcB = makeService(TEST_KEY_B);
      expect(() => svcB.decrypt(payload)).toThrow();
    });

    it('decrypt throws when authTag is tampered', () => {
      const svc = makeService(TEST_KEY_A);
      const payload = svc.encrypt('payload');

      const tamperedTag = Buffer.from(payload.authTag);
      tamperedTag[0] = tamperedTag[0] ^ 0xff;

      expect(() =>
        svc.decrypt({ ...payload, authTag: tamperedTag }),
      ).toThrow();
    });

    it('decrypt throws when ciphertext is tampered', () => {
      const svc = makeService(TEST_KEY_A);
      const payload = svc.encrypt('payload');

      const tamperedCipher = Buffer.from(payload.ciphertext);
      tamperedCipher[0] = tamperedCipher[0] ^ 0xff;

      expect(() =>
        svc.decrypt({ ...payload, ciphertext: tamperedCipher }),
      ).toThrow();
    });

    it('decrypt throws when iv is tampered', () => {
      const svc = makeService(TEST_KEY_A);
      const payload = svc.encrypt('payload');

      const tamperedIv = Buffer.from(payload.iv);
      tamperedIv[0] = tamperedIv[0] ^ 0xff;

      expect(() =>
        svc.decrypt({ ...payload, iv: tamperedIv }),
      ).toThrow();
    });
  });
});
