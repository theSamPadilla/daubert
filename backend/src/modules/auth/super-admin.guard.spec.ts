import { ForbiddenException } from '@nestjs/common';
import { SuperAdminGuard } from './super-admin.guard';

describe('SuperAdminGuard', () => {
  const guard = new SuperAdminGuard();
  const ctx = (user: any) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  it('throws when unauthenticated', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(undefined))).toThrow('Authentication required');
  });

  it('throws when not superadmin', () => {
    expect(() => guard.canActivate(ctx({ isSuperAdmin: false }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx({ isSuperAdmin: false }))).toThrow('Superadmin');
  });

  it('passes when superadmin', () => {
    expect(guard.canActivate(ctx({ isSuperAdmin: true }))).toBe(true);
  });
});
