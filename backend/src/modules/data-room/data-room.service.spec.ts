import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataRoomConnectionEntity } from '../../database/entities/data-room-connection.entity';
import { DataRoomService } from './data-room.service';
import { EncryptionService } from './encryption.service';
import { GoogleDriveService } from './google-drive.service';

const TEST_KEY = '00'.repeat(32);
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Minimal DataRoomService harness: just the dependencies needed to construct
 * the service and exercise the HMAC `state` paths. Drive + DB are not touched.
 */
async function buildService(): Promise<DataRoomService> {
  const mockRepo = {
    findOneBy: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
  const mockEncryption = {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  };
  const mockGoogleDrive = {
    getAuthUrl: jest.fn(),
    exchangeCode: jest.fn(),
    refreshAccessToken: jest.fn(),
    revokeToken: jest.fn(),
    getFolder: jest.fn(),
    listFiles: jest.fn(),
    getFileMetadata: jest.fn(),
    downloadFile: jest.fn(),
    uploadFile: jest.fn(),
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      DataRoomService,
      {
        provide: getRepositoryToken(DataRoomConnectionEntity),
        useValue: mockRepo,
      },
      { provide: EncryptionService, useValue: mockEncryption },
      { provide: GoogleDriveService, useValue: mockGoogleDrive },
    ],
  }).compile();

  return moduleRef.get<DataRoomService>(DataRoomService);
}

describe('DataRoomService — HMAC state', () => {
  const originalKey = process.env.DATAROOM_ENCRYPTION_KEY;
  let service: DataRoomService;

  beforeAll(() => {
    process.env.DATAROOM_ENCRYPTION_KEY = TEST_KEY;
  });

  beforeEach(async () => {
    service = await buildService();
  });

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.DATAROOM_ENCRYPTION_KEY;
    } else {
      process.env.DATAROOM_ENCRYPTION_KEY = originalKey;
    }
  });

  // ---------------------------------------------------------------------------
  // signState
  // ---------------------------------------------------------------------------
  describe('signState', () => {
    it('produces a deterministic value for fixed inputs', () => {
      const args = { caseId: 'case-123', nonce: 'nonce-abc', ts: 1_700_000_000_000 };
      const a = service.signState(args);
      const b = service.signState(args);
      expect(a).toBe(b);
      expect(typeof a).toBe('string');
      expect(a.length).toBeGreaterThan(0);
    });

    it('produces different output when caseId differs', () => {
      const ts = Date.now();
      const a = service.signState({ caseId: 'case-1', nonce: 'n', ts });
      const b = service.signState({ caseId: 'case-2', nonce: 'n', ts });
      expect(a).not.toBe(b);
    });

    it('produces different output when nonce differs', () => {
      const ts = Date.now();
      const a = service.signState({ caseId: 'c', nonce: 'n1', ts });
      const b = service.signState({ caseId: 'c', nonce: 'n2', ts });
      expect(a).not.toBe(b);
    });
  });

  // ---------------------------------------------------------------------------
  // verifyState — happy path
  // ---------------------------------------------------------------------------
  describe('verifyState — round-trip', () => {
    it('returns the caseId when state is freshly signed', () => {
      const caseId = 'case-abc';
      const state = service.signState({
        caseId,
        nonce: 'nonce-xyz',
        ts: Date.now(),
      });
      expect(service.verifyState(state)).toEqual({ caseId });
    });
  });

  // ---------------------------------------------------------------------------
  // verifyState — tamper / shape
  // ---------------------------------------------------------------------------
  describe('verifyState — tamper detection', () => {
    function decode(state: string): string {
      return Buffer.from(state, 'base64url').toString('utf8');
    }
    function encode(payload: string): string {
      return Buffer.from(payload, 'utf8').toString('base64url');
    }

    it('throws BadRequestException when HMAC portion is tampered', () => {
      const state = service.signState({
        caseId: 'case-1',
        nonce: 'n',
        ts: Date.now(),
      });
      const decoded = decode(state);
      const parts = decoded.split('.');
      // Flip the first hex char of the HMAC.
      const hmac = parts[3];
      const flipped =
        (hmac[0] === '0' ? '1' : '0') + hmac.slice(1);
      const tampered = encode([parts[0], parts[1], parts[2], flipped].join('.'));

      expect(() => service.verifyState(tampered)).toThrow(BadRequestException);
    });

    it('throws BadRequestException when caseId portion is changed but HMAC kept', () => {
      const state = service.signState({
        caseId: 'case-1',
        nonce: 'n',
        ts: Date.now(),
      });
      const decoded = decode(state);
      const parts = decoded.split('.');
      const tampered = encode(['case-2', parts[1], parts[2], parts[3]].join('.'));

      expect(() => service.verifyState(tampered)).toThrow(BadRequestException);
    });

    it('throws BadRequestException for wrong-shape (not enough dots) input', () => {
      const bad = Buffer.from('only.three.parts', 'utf8').toString('base64url');
      expect(() => service.verifyState(bad)).toThrow(BadRequestException);
    });

    it('throws BadRequestException for non-base64url garbage that decodes wrong', () => {
      // Random non-state input — base64url-decodes to junk that won't have 4 dot-parts.
      expect(() => service.verifyState('!!!not.a.valid.state!!!')).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when ts is non-numeric', () => {
      const tampered = encode(['c', 'n', 'not-a-number', 'deadbeef'].join('.'));
      expect(() => service.verifyState(tampered)).toThrow(BadRequestException);
    });

    it('throws BadRequestException when hmac is not valid hex', () => {
      const tampered = encode(['c', 'n', String(Date.now()), 'zzz'].join('.'));
      expect(() => service.verifyState(tampered)).toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // verifyState — timing window
  // ---------------------------------------------------------------------------
  describe('verifyState — timestamp window', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('throws when ts is older than the 10-minute TTL', () => {
      const stale = service.signState({
        caseId: 'c',
        nonce: 'n',
        ts: Date.now() - STATE_TTL_MS - 1_000,
      });
      expect(() => service.verifyState(stale)).toThrow(BadRequestException);
    });

    it('throws when ts is in the future beyond clock skew', () => {
      const future = service.signState({
        caseId: 'c',
        nonce: 'n',
        ts: Date.now() + 60_000, // 1 minute in the future
      });
      expect(() => service.verifyState(future)).toThrow(BadRequestException);
    });

    it('boundary: ts exactly STATE_TTL_MS old is still valid (inclusive on recent side)', () => {
      // Freeze time so signing-ts and verifying-ts are reasoned about precisely.
      const now = 1_700_000_000_000;
      jest.useFakeTimers().setSystemTime(now);

      const state = service.signState({
        caseId: 'c',
        nonce: 'n',
        ts: now - STATE_TTL_MS,
      });
      // Still at `now`, age = STATE_TTL_MS exactly => valid.
      expect(() => service.verifyState(state)).not.toThrow();
    });

    it('boundary: ts STATE_TTL_MS + 1ms old is invalid (exclusive on stale side)', () => {
      const now = 1_700_000_000_000;
      jest.useFakeTimers().setSystemTime(now);

      const state = service.signState({
        caseId: 'c',
        nonce: 'n',
        ts: now - STATE_TTL_MS - 1,
      });
      expect(() => service.verifyState(state)).toThrow(BadRequestException);
    });
  });
});
