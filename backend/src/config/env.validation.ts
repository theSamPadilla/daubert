/**
 * Validates required environment variables at startup.
 * Fails fast with a clear error instead of cryptic runtime crashes.
 */

const requiredEnvVars = [
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'ETHERSCAN_API_KEY',
  'TRONSCAN_API_KEY',
  // Data Room (Google Drive) — hard-required everywhere. The data-room module
  // is wired into AppModule unconditionally; missing values would otherwise
  // crash silently at first request. Fail loud at boot instead.
  // FRONTEND_URL is here because the OAuth callback redirects back to it.
  'DATAROOM_ENCRYPTION_KEY',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
  'FRONTEND_URL',
];

// These become required once auth is enabled
const firebaseEnvVars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
];

export function validateEnv(env: Record<string, string>): Record<string, string> {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required vars
  for (const key of requiredEnvVars) {
    if (!env[key]) {
      missing.push(key);
    }
  }

  // Format checks
  if (env.ANTHROPIC_API_KEY && !env.ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
    warnings.push('ANTHROPIC_API_KEY does not start with "sk-ant-" — may be invalid');
  }

  // Firebase vars: warn if partially set
  const firebaseSet = firebaseEnvVars.filter((k) => !!env[k]);
  if (firebaseSet.length > 0 && firebaseSet.length < firebaseEnvVars.length) {
    const firebaseMissing = firebaseEnvVars.filter((k) => !env[k]);
    missing.push(...firebaseMissing);
  } else if (firebaseSet.length === 0) {
    warnings.push(
      'Firebase env vars not set — auth will not work. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY to enable.',
    );
  }

  // Format check: encryption key must be 32 bytes of hex
  if (env.DATAROOM_ENCRYPTION_KEY) {
    const k = env.DATAROOM_ENCRYPTION_KEY;
    if (!/^[0-9a-fA-F]{64}$/.test(k)) {
      throw new Error(
        'DATAROOM_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate with `openssl rand -hex 32`.',
      );
    }
  }

  // Print warnings
  for (const w of warnings) {
    console.warn(`[env] WARNING: ${w}`);
  }

  // Fail on missing
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join('\n')}\n\nCheck your .env.development or .env.production file.`,
    );
  }

  return env;
}
