import 'reflect-metadata';
import { validate } from 'class-validator';
import { Test, TestingModule } from '@nestjs/testing';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthEmailController } from './auth-email.controller';
import { AuthEmailService } from './auth-email.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

// ── DTO validation helpers ────────────────────────────────────────────────────

async function validateSendOtp(data: object) {
  const dto = Object.assign(new SendOtpDto(), data);
  return validate(dto);
}

async function validateVerifyOtp(data: object) {
  const dto = Object.assign(new VerifyOtpDto(), data);
  return validate(dto);
}

// ── Throttle metadata constants (from @nestjs/throttler internals) ────────────
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';

// ── Controller unit tests ─────────────────────────────────────────────────────

describe('AuthEmailController', () => {
  let controller: AuthEmailController;
  let service: jest.Mocked<AuthEmailService>;

  beforeEach(async () => {
    const mockService: Partial<jest.Mocked<AuthEmailService>> = {
      sendOtp: jest.fn(),
      verifyOtp: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthEmailController],
      providers: [
        { provide: AuthEmailService, useValue: mockService },
      ],
    })
      // Override ThrottlerGuard so it doesn't need the throttler module wired up
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AuthEmailController);
    service = module.get(AuthEmailService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── sendOtp endpoint ──────────────────────────────────────────────────────

  it('sendOtp: delegates to service and returns { success: true }', async () => {
    service.sendOtp.mockResolvedValue({ success: true });
    const dto = Object.assign(new SendOtpDto(), { email: 'alice@example.com' });

    const result = await controller.sendOtp(dto);

    expect(service.sendOtp).toHaveBeenCalledWith('alice@example.com');
    expect(result).toEqual({ success: true });
  });

  it('sendOtp: propagates BadGatewayException from service', async () => {
    service.sendOtp.mockRejectedValue(new BadGatewayException('send failed'));
    const dto = Object.assign(new SendOtpDto(), { email: 'alice@example.com' });

    await expect(controller.sendOtp(dto)).rejects.toBeInstanceOf(BadGatewayException);
  });

  // ── verifyOtp endpoint ────────────────────────────────────────────────────

  it('verifyOtp: delegates to service and returns { success: true, token }', async () => {
    service.verifyOtp.mockResolvedValue({ success: true, token: 'tok-xyz' });
    const dto = Object.assign(new VerifyOtpDto(), { email: 'alice@example.com', code: '123456' });

    const result = await controller.verifyOtp(dto);

    expect(service.verifyOtp).toHaveBeenCalledWith('alice@example.com', '123456');
    expect(result).toEqual({ success: true, token: 'tok-xyz' });
  });

  it('verifyOtp: propagates BadRequestException from service', async () => {
    service.verifyOtp.mockRejectedValue(new BadRequestException('Invalid or expired code'));
    const dto = Object.assign(new VerifyOtpDto(), { email: 'alice@example.com', code: '000000' });

    await expect(controller.verifyOtp(dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── Throttle metadata ─────────────────────────────────────────────────────

  it('sendOtp handler has @Throttle limit=3, ttl=60000', () => {
    const handler = controller.sendOtp;
    const limit = Reflect.getMetadata(THROTTLER_LIMIT + 'default', handler);
    const ttl = Reflect.getMetadata(THROTTLER_TTL + 'default', handler);

    expect(limit).toBe(3);
    expect(ttl).toBe(60000);
  });

  it('verifyOtp handler has @Throttle limit=10, ttl=60000', () => {
    const handler = controller.verifyOtp;
    const limit = Reflect.getMetadata(THROTTLER_LIMIT + 'default', handler);
    const ttl = Reflect.getMetadata(THROTTLER_TTL + 'default', handler);

    expect(limit).toBe(10);
    expect(ttl).toBe(60000);
  });
});

// ── DTO validation tests ──────────────────────────────────────────────────────

describe('SendOtpDto validation', () => {
  it('passes with a valid email', async () => {
    const errors = await validateSendOtp({ email: 'user@example.com' });
    expect(errors).toHaveLength(0);
  });

  it('fails with a non-email string', async () => {
    const errors = await validateSendOtp({ email: 'not-an-email' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('email');
  });

  it('fails when email is missing', async () => {
    const errors = await validateSendOtp({});
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails with an empty string', async () => {
    const errors = await validateSendOtp({ email: '' });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('VerifyOtpDto validation', () => {
  it('passes with a valid email and 6-digit code', async () => {
    const errors = await validateVerifyOtp({ email: 'user@example.com', code: '123456' });
    expect(errors).toHaveLength(0);
  });

  it('fails when email is invalid', async () => {
    const errors = await validateVerifyOtp({ email: 'bad-email', code: '123456' });
    expect(errors.some(e => e.property === 'email')).toBe(true);
  });

  it('fails when code has fewer than 6 digits', async () => {
    const errors = await validateVerifyOtp({ email: 'user@example.com', code: '12345' });
    expect(errors.some(e => e.property === 'code')).toBe(true);
  });

  it('fails when code has more than 6 digits', async () => {
    const errors = await validateVerifyOtp({ email: 'user@example.com', code: '1234567' });
    expect(errors.some(e => e.property === 'code')).toBe(true);
  });

  it('fails when code contains non-numeric characters', async () => {
    const errors = await validateVerifyOtp({ email: 'user@example.com', code: '12345a' });
    expect(errors.some(e => e.property === 'code')).toBe(true);
  });

  it('fails when code is missing', async () => {
    const errors = await validateVerifyOtp({ email: 'user@example.com' });
    expect(errors.some(e => e.property === 'code')).toBe(true);
  });
});
