import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CloudTasksOidcGuard } from './cloud-tasks-oidc.guard';

const AUD = 'https://svc.run.app';
const SA = 'inv@p.iam.gserviceaccount.com';
const ctx = (authorization?: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }) }) as any;
const guardWith = (vars: Record<string, string>, payload?: any, throws = false) => {
  const guard = new CloudTasksOidcGuard({ get: (k: string) => vars[k] } as any);
  (guard as any).client = {
    verifyIdToken: jest.fn(async () => {
      if (throws) throw new Error('bad token');
      return { getPayload: () => payload };
    }),
  };
  return guard;
};
const CONFIGURED = { AGENT_RUNS_WORKER_URL: AUD, AGENT_RUNS_INVOKER_SA: SA };

describe('CloudTasksOidcGuard', () => {
  it('404s when Cloud Tasks is not configured (dev)', async () => {
    await expect(guardWith({}).canActivate(ctx('Bearer x'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a missing bearer token', async () => {
    await expect(guardWith(CONFIGURED).canActivate(ctx())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token that fails verification', async () => {
    await expect(guardWith(CONFIGURED, undefined, true).canActivate(ctx('Bearer x'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a valid token for a different service account', async () => {
    const g = guardWith(CONFIGURED, { email: 'other@p.iam.gserviceaccount.com', email_verified: true });
    await expect(g.canActivate(ctx('Bearer x'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a verified token from the invoker account and checks the audience', async () => {
    const g = guardWith(CONFIGURED, { email: SA, email_verified: true });
    await expect(g.canActivate(ctx('Bearer tok'))).resolves.toBe(true);
    expect((g as any).client.verifyIdToken).toHaveBeenCalledWith({ idToken: 'tok', audience: AUD });
  });
});
