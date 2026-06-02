import { Test, TestingModule } from '@nestjs/testing';
import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthEmailService } from './auth-email.service';
import { EmailService } from '../email/email.service';
import { FIREBASE_ADMIN } from '../auth/firebase-admin.provider';
import { OtpEntity } from '../../database/entities/otp.entity';
import { UsersService } from '../users/users.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOtp(overrides: Partial<OtpEntity> = {}): OtpEntity {
  const otp = new OtpEntity();
  otp.id = 'otp-id-1';
  otp.email = 'user@example.com';
  otp.code = '123456';
  otp.expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  otp.verified = false;
  otp.createdAt = new Date();
  otp.updatedAt = new Date();
  return Object.assign(otp, overrides);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('AuthEmailService', () => {
  let service: AuthEmailService;

  let otpRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };

  let emailService: { sendOtpEmail: jest.Mock };

  let usersService: { findByEmail: jest.Mock };

  let getUserByEmail: jest.Mock;
  let createUser: jest.Mock;
  let createCustomToken: jest.Mock;
  let firebaseAdmin: { auth: jest.Mock };

  beforeEach(async () => {
    otpRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };

    emailService = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };

    // Default: user exists. Individual tests override for the "no account" case.
    usersService = {
      findByEmail: jest.fn().mockResolvedValue({ id: 'user-id-1', email: 'user@example.com' }),
    };

    getUserByEmail = jest.fn();
    createUser = jest.fn();
    createCustomToken = jest.fn().mockResolvedValue('custom-token-abc');
    firebaseAdmin = {
      auth: jest.fn(() => ({ getUserByEmail, createUser, createCustomToken })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthEmailService,
        { provide: getRepositoryToken(OtpEntity), useValue: otpRepo },
        { provide: EmailService, useValue: emailService },
        { provide: FIREBASE_ADMIN, useValue: firebaseAdmin },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get(AuthEmailService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── sendOtp: no Daubert account ───────────────────────────────────────────

  it('throws NotFoundException without generating/sending an OTP when no Daubert user exists for the email', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(service.sendOtp('stranger@example.com')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(otpRepo.findOne).not.toHaveBeenCalled();
    expect(otpRepo.create).not.toHaveBeenCalled();
    expect(otpRepo.save).not.toHaveBeenCalled();
    expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
  });

  it('looks up the user by lowercase email', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(service.sendOtp('Stranger@Example.COM')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(usersService.findByEmail).toHaveBeenCalledWith('stranger@example.com');
  });

  // ── sendOtp: code generation ──────────────────────────────────────────────

  it('generates a 6-digit numeric code', async () => {
    const capturedCodes: string[] = [];
    otpRepo.findOne.mockResolvedValue(null);
    otpRepo.create.mockImplementation((data: Partial<OtpEntity>) => {
      capturedCodes.push(data.code!);
      return { ...makeOtp(), ...data };
    });
    otpRepo.save.mockImplementation((e: OtpEntity) => Promise.resolve(e));

    await service.sendOtp('user@example.com');

    expect(capturedCodes).toHaveLength(1);
    expect(capturedCodes[0]).toMatch(/^\d{6}$/);
  });

  // ── sendOtp: email lowercasing ────────────────────────────────────────────

  it('normalizes email to lowercase before persisting', async () => {
    otpRepo.findOne.mockResolvedValue(null);
    const created = makeOtp({ email: 'foo@bar.com' });
    otpRepo.create.mockReturnValue(created);
    otpRepo.save.mockResolvedValue(created);

    await service.sendOtp('FOO@BAR.COM');

    expect(otpRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: 'foo@bar.com' }) }),
    );
  });

  // ── sendOtp: refresh existing row ─────────────────────────────────────────

  it('updates the existing row on a second call instead of inserting a new one', async () => {
    const existing = makeOtp({ id: 'existing-id' });
    otpRepo.findOne.mockResolvedValue(existing);
    otpRepo.save.mockImplementation((e: OtpEntity) => Promise.resolve(e));

    await service.sendOtp('user@example.com');

    // save was called once, create was NOT called
    expect(otpRepo.save).toHaveBeenCalledTimes(1);
    expect(otpRepo.create).not.toHaveBeenCalled();

    // The saved object is the same entity (same id), just with an updated code
    const saved = otpRepo.save.mock.calls[0][0] as OtpEntity;
    expect(saved.id).toBe('existing-id');
    expect(saved.code).toMatch(/^\d{6}$/);
  });

  // ── sendOtp: send-failure rollback ────────────────────────────────────────

  it('deletes the saved OTP row and throws BadGatewayException when email send fails', async () => {
    otpRepo.findOne.mockResolvedValue(null);
    const otp = makeOtp({ id: 'new-otp-id' });
    otpRepo.create.mockReturnValue(otp);
    otpRepo.save.mockResolvedValue(otp);
    emailService.sendOtpEmail.mockRejectedValue(new Error('Resend API error'));

    await expect(service.sendOtp('user@example.com')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(otpRepo.delete).toHaveBeenCalledWith('new-otp-id');
  });

  // ── verifyOtp: expired code ───────────────────────────────────────────────

  it('rejects an expired OTP with the generic BadRequestException', async () => {
    const expired = makeOtp({ expiresAt: new Date(Date.now() - 1000) });
    otpRepo.findOne.mockResolvedValue(expired);

    await expect(service.verifyOtp('user@example.com', '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Message must stay generic (no "expired" hint that leaks code state)
    await expect(service.verifyOtp('user@example.com', '123456')).rejects.toThrow(
      'Invalid or expired code',
    );
  });

  // ── verifyOtp: no row found ───────────────────────────────────────────────

  it('rejects when no pending OTP row exists', async () => {
    otpRepo.findOne.mockResolvedValue(null);

    await expect(service.verifyOtp('user@example.com', '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // ── verifyOtp: wrong code ─────────────────────────────────────────────────

  it('rejects a mismatched code with the generic error', async () => {
    const otp = makeOtp({ code: '654321' });
    otpRepo.findOne.mockResolvedValue(otp);

    await expect(service.verifyOtp('user@example.com', '111111')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // ── verifyOtp: token mint on success ─────────────────────────────────────

  it('returns { success: true, token } on a correct code', async () => {
    const otp = makeOtp({ code: '123456' });
    otpRepo.findOne.mockResolvedValue(otp);
    otpRepo.save.mockResolvedValue({ ...otp, verified: true });
    getUserByEmail.mockResolvedValue({ uid: 'fb-uid-1' });
    createCustomToken.mockResolvedValue('firebase-custom-token');

    const result = await service.verifyOtp('user@example.com', '123456');

    expect(result).toEqual({ success: true, token: 'firebase-custom-token' });
    expect(createCustomToken).toHaveBeenCalledWith('fb-uid-1');
  });

  // ── verifyOtp: Firebase user creation on first verify ────────────────────

  it('creates a Firebase user when getUserByEmail throws auth/user-not-found', async () => {
    const otp = makeOtp({ code: '123456', email: 'new@example.com' });
    otpRepo.findOne.mockResolvedValue(otp);
    otpRepo.save.mockResolvedValue({ ...otp, verified: true });

    getUserByEmail.mockRejectedValue({ errorInfo: { code: 'auth/user-not-found' } });
    createUser.mockResolvedValue({ uid: 'fb-new-uid' });
    createCustomToken.mockResolvedValue('new-user-token');

    const result = await service.verifyOtp('new@example.com', '123456');

    expect(createUser).toHaveBeenCalledWith({ email: 'new@example.com', emailVerified: true });
    expect(createCustomToken).toHaveBeenCalledWith('fb-new-uid');
    expect(result).toEqual({ success: true, token: 'new-user-token' });
  });

  it('re-throws unexpected Firebase errors (not auth/user-not-found)', async () => {
    const otp = makeOtp({ code: '123456' });
    otpRepo.findOne.mockResolvedValue(otp);
    otpRepo.save.mockResolvedValue({ ...otp, verified: true });

    getUserByEmail.mockRejectedValue(new Error('Firebase quota exceeded'));

    await expect(service.verifyOtp('user@example.com', '123456')).rejects.toThrow(
      'Firebase quota exceeded',
    );
    expect(createUser).not.toHaveBeenCalled();
  });

  // ── verifyOtp: email lowercasing ──────────────────────────────────────────

  it('matches a row created with uppercase email when verifying with mixed case', async () => {
    // Simulate: sendOtp stored as 'foo@bar.com', verifyOtp called with 'Foo@Bar.Com'
    const otp = makeOtp({ email: 'foo@bar.com', code: '999888' });
    otpRepo.findOne.mockResolvedValue(otp);
    otpRepo.save.mockResolvedValue({ ...otp, verified: true });
    getUserByEmail.mockResolvedValue({ uid: 'fb-uid-2' });
    createCustomToken.mockResolvedValue('tok');

    const result = await service.verifyOtp('Foo@Bar.Com', '999888');

    expect(otpRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ email: 'foo@bar.com' }) }),
    );
    expect(result.success).toBe(true);
  });
});
