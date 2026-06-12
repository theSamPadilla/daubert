import { validateEnv } from './env.validation';

/** Minimal set of vars that satisfy every UNCONDITIONAL required key. */
const BASE_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://localhost/test',
  ANTHROPIC_API_KEY: 'sk-ant-dummy',
  ETHERSCAN_API_KEY: 'dummy-etherscan',
  TRONSCAN_API_KEY: 'dummy-tron',
  FRONTEND_URL: 'http://localhost:3001',
  // Firebase — all three must be set together to avoid "partially set" error
  FIREBASE_PROJECT_ID: 'proj',
  FIREBASE_CLIENT_EMAIL: 'svc@proj.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\ndummy\n-----END RSA PRIVATE KEY-----',
  // OAuth — required
  OAUTH_ISSUER_URL: 'http://localhost:8081',
  OAUTH_STATE_SECRET: 'a'.repeat(32),
};

describe('validateEnv — data-room rules', () => {
  // ── prod: bucket required ────────────────────────────────────────────────

  it('throws when NODE_ENV=production and GCS_DATA_ROOM_BUCKET is absent', () => {
    const env = { ...BASE_ENV, NODE_ENV: 'production' };
    expect(() => validateEnv(env)).toThrow(/GCS_DATA_ROOM_BUCKET/);
  });

  it('does not throw for the bucket when NODE_ENV=production and GCS_DATA_ROOM_BUCKET is set', () => {
    const env = {
      ...BASE_ENV,
      NODE_ENV: 'production',
      GCS_DATA_ROOM_BUCKET: 'my-bucket',
    };
    expect(() => validateEnv(env)).not.toThrow();
  });

  // ── non-prod: bucket optional ────────────────────────────────────────────

  it('does not throw when NODE_ENV=development and GCS_DATA_ROOM_BUCKET is absent', () => {
    const env = { ...BASE_ENV, NODE_ENV: 'development' };
    expect(() => validateEnv(env)).not.toThrow();
  });

  // ── old OAuth / encryption vars are gone ────────────────────────────────

  it('does not throw when GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, and DATAROOM_ENCRYPTION_KEY are absent', () => {
    // BASE_ENV intentionally contains none of the old OAuth/encryption vars.
    // This test verifies they are no longer required.
    const env: Record<string, string> = { ...BASE_ENV, NODE_ENV: 'development' };
    expect(env).not.toHaveProperty('GOOGLE_OAUTH_CLIENT_ID');
    expect(env).not.toHaveProperty('GOOGLE_OAUTH_CLIENT_SECRET');
    expect(env).not.toHaveProperty('GOOGLE_OAUTH_REDIRECT_URI');
    expect(env).not.toHaveProperty('DATAROOM_ENCRYPTION_KEY');
    expect(() => validateEnv(env)).not.toThrow();
  });
});

describe('validateEnv — OAuth authorization server rules', () => {
  // ── OAUTH_ISSUER_URL required ────────────────────────────────────────────

  it('throws when OAUTH_ISSUER_URL is missing', () => {
    const { OAUTH_ISSUER_URL: _omit, ...envWithoutIssuer } = BASE_ENV;
    expect(() => validateEnv(envWithoutIssuer as any)).toThrow(/OAUTH_ISSUER_URL/);
  });

  // ── OAUTH_STATE_SECRET required ──────────────────────────────────────────

  it('throws when OAUTH_STATE_SECRET is missing', () => {
    const { OAUTH_STATE_SECRET: _omit, ...envWithoutSecret } = BASE_ENV;
    expect(() => validateEnv(envWithoutSecret as any)).toThrow(/OAUTH_STATE_SECRET/);
  });

  it('throws when OAUTH_STATE_SECRET is shorter than 32 chars', () => {
    const env = { ...BASE_ENV, OAUTH_STATE_SECRET: 'short' };
    expect(() => validateEnv(env)).toThrow(/OAUTH_STATE_SECRET/);
  });

  it('does not throw when both OAUTH_ISSUER_URL and OAUTH_STATE_SECRET (>=32 chars) are set', () => {
    expect(() => validateEnv(BASE_ENV)).not.toThrow();
  });
});
