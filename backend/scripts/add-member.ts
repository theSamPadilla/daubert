#!/usr/bin/env ts-node
/**
 * Promote a user to member (or create a new member shell).
 * Usage: npm run scripts:add-member -- --email "user@example.com"
 *
 * Behavior:
 *  - Existing admin → no-op (admin > member, preserve).
 *  - Existing member → no-op.
 *  - Existing guest → promoted to member.
 *  - No user → created as member shell (firebase_uid stays null until first sign-in).
 */
import { createConnection, parseArgs, colors } from './db-connect';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email?.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    console.error(colors.red('Usage: --email <email>'));
    process.exit(1);
  }

  const ds = await createConnection();
  try {
    const existing = await ds.query(
      'SELECT id, email, org_role FROM users WHERE email = $1',
      [email],
    );

    if (existing.length > 0) {
      const row = existing[0];
      if (row.org_role === 'admin') {
        console.log(colors.yellow(`${email} is already an admin — leaving unchanged.`));
        return;
      }
      if (row.org_role === 'member') {
        console.log(colors.yellow(`${email} is already a member — no change.`));
        return;
      }
      await ds.query(
        `UPDATE users SET org_role = 'member', updated_at = NOW() WHERE id = $1`,
        [row.id],
      );
      console.log(colors.green(`Promoted ${email}: guest → member.`));
      return;
    }

    // No user yet — create a member shell. Name is the email local-part;
    // AuthGuard's first-sign-in flow overwrites with the Firebase display name.
    const namePlaceholder = email.split('@')[0];
    const result = await ds.query(
      `INSERT INTO users (name, email, org_role, created_at, updated_at)
       VALUES ($1, $2, 'member', NOW(), NOW())
       RETURNING id`,
      [namePlaceholder, email],
    );
    console.log(colors.green(`Created ${email} as member (will be linked to Firebase on first sign-in).`));
    console.log(`  ID: ${result[0].id}`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(colors.red(err.message));
  process.exit(1);
});
