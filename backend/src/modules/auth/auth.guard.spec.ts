import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import {
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { FIREBASE_ADMIN } from './firebase-admin.provider';
import { UsersService } from '../users/users.service';
import { ScriptTokenService } from '../script/script-token.service';
import { IS_PUBLIC_KEY } from './public.decorator';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FakeRequest {
  headers: Record<string, string | string[]>;
  method?: string;
  url?: string;
  user?: any;
  principal?: any;
}

function makeContext(req: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => function handler() {},
    getClass: () => class TestClass {},
    getArgs: () => [] as any,
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as any,
    switchToWs: () => ({}) as any,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('AuthGuard (dual-auth)', () => {
  let guard: AuthGuard;
  let scriptToken: ScriptTokenService;
  let reflector: { getAllAndOverride: jest.Mock };
  let firebaseApp: { auth: jest.Mock };
  let verifyIdToken: jest.Mock;
  let usersService: {
    findByFirebaseUid: jest.Mock;
    findByEmail: jest.Mock;
    linkFirebaseUid: jest.Mock;
  };

  beforeEach(async () => {
    verifyIdToken = jest.fn();
    firebaseApp = { auth: jest.fn(() => ({ verifyIdToken })) };
    usersService = {
      findByFirebaseUid: jest.fn(),
      findByEmail: jest.fn(),
      linkFirebaseUid: jest.fn(),
    };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthGuard,
        ScriptTokenService,
        { provide: FIREBASE_ADMIN, useValue: firebaseApp },
        { provide: UsersService, useValue: usersService },
        { provide: Reflector, useValue: reflector },
      ],
    }).compile();

    guard = module.get(AuthGuard);
    scriptToken = module.get(ScriptTokenService);
  });

  // ── @Public() short-circuit ────────────────────────────────────────────────

  it('bypasses auth for routes decorated with @Public()', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    const req: FakeRequest = { headers: {} };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      IS_PUBLIC_KEY,
      expect.any(Array),
    );
    expect(req.principal).toBeUndefined();
    expect(req.user).toBeUndefined();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  // ── Missing both headers ───────────────────────────────────────────────────

  it('throws UnauthorizedException when no auth header is present', async () => {
    const ctx = makeContext({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // ── Script-token path ──────────────────────────────────────────────────────

  it('valid X-Script-Token attaches script principal and does NOT set req.user', async () => {
    const token = scriptToken.sign('case-42');
    const req: FakeRequest = {
      headers: { 'x-script-token': token },
      method: 'GET',
      url: '/traces/abc',
    };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.principal).toEqual({ kind: 'script', caseId: 'case-42' });
    expect(req.user).toBeUndefined();
    // Firebase path was not invoked
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(usersService.findByFirebaseUid).not.toHaveBeenCalled();
  });

  it('invalid X-Script-Token throws UnauthorizedException and does NOT fall through to Firebase', async () => {
    const req: FakeRequest = {
      headers: {
        'x-script-token': 'totally-bogus-token',
        authorization: 'Bearer some-firebase-token',
      },
    };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // Firebase path must NOT be tried
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(usersService.findByFirebaseUid).not.toHaveBeenCalled();
  });

  // ── Firebase path ──────────────────────────────────────────────────────────

  it('valid Firebase Bearer attaches user principal and req.user', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'fb-uid', email: 'a@b.c' });
    const user = { id: 'user-1', email: 'a@b.c', name: 'Alice' };
    usersService.findByFirebaseUid.mockResolvedValue(user);

    const req: FakeRequest = {
      headers: { authorization: 'Bearer firebase-jwt-here' },
    };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verifyIdToken).toHaveBeenCalledWith('firebase-jwt-here');
    expect(usersService.findByFirebaseUid).toHaveBeenCalledWith('fb-uid');
    expect(req.user).toBe(user);
    expect(req.principal).toEqual({ kind: 'user', userId: 'user-1' });
  });

  it('Firebase path: rejects when verifyIdToken throws', async () => {
    verifyIdToken.mockRejectedValue(new Error('expired'));

    const req: FakeRequest = {
      headers: { authorization: 'Bearer bad-token' },
    };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(req.user).toBeUndefined();
    expect(req.principal).toBeUndefined();
  });
});
