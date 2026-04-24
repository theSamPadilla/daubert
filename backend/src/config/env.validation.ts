/**
 * Validates required environment variables at startup.
 * Fails fast with a clear error instead of cryptic runtime crashes.
 */

const requiredEnvVars = [
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'ETHERSCAN_API_KEY',
  'TRONSCAN_API_KEY',
];

// These become required once auth is enabled
const firebaseEnvVars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
];

export function validateEnv(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required vars
  for (const key of requiredEnvVars) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  // Format checks
  if (
    process.env.ANTHROPIC_API_KEY &&
    !process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-')
  ) {
    warnings.push('ANTHROPIC_API_KEY does not start with "sk-ant-" — may be invalid');
  }

  // Firebase vars: warn if partially set
  const firebaseSet = firebaseEnvVars.filter((k) => !!process.env[k]);
  if (firebaseSet.length > 0 && firebaseSet.length < firebaseEnvVars.length) {
    const firebaseMissing = firebaseEnvVars.filter((k) => !process.env[k]);
    missing.push(...firebaseMissing);
  } else if (firebaseSet.length === 0) {
    warnings.push(
      'Firebase env vars not set — auth will not work. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY to enable.',
    );
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
}
