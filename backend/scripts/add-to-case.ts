#!/usr/bin/env ts-node
/**
 * Add a user to a case as a member.
 * Usage: npm run scripts:add-to-case -- --email "user@example.com" --case-id <uuid> --role guest
 */
import { createConnection, parseArgs, colors } from './db-connect';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !args['case-id']) {
    console.error(colors.red('Usage: --email <email> --case-id <uuid> [--role owner|guest]'));
    process.exit(1);
  }

  const role = args.role || 'guest';
  if (role !== 'owner' && role !== 'guest') {
    console.error(colors.red('Role must be "owner" or "guest"'));
    process.exit(1);
  }

  const ds = await createConnection();

  try {
    const users = await ds.query('SELECT id, name FROM users WHERE email = $1', [args.email]);
    if (users.length === 0) {
      console.error(colors.red(`No user found with email: ${args.email}`));
      process.exit(1);
    }

    const cases = await ds.query('SELECT id, name FROM cases WHERE id = $1', [args['case-id']]);
    if (cases.length === 0) {
      console.error(colors.red(`No case found with ID: ${args['case-id']}`));
      process.exit(1);
    }

    const existing = await ds.query(
      'SELECT id FROM case_members WHERE user_id = $1 AND case_id = $2',
      [users[0].id, args['case-id']],
    );

    if (existing.length > 0) {
      console.log(colors.yellow(`${args.email} is already a member of "${cases[0].name}"`));
      return;
    }

    await ds.query(
      'INSERT INTO case_members (user_id, case_id, role, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
      [users[0].id, args['case-id'], role],
    );

    console.log(colors.green(`Added ${users[0].name} to "${cases[0].name}" as ${role}`));
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(colors.red(err.message));
  process.exit(1);
});
