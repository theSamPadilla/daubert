#!/usr/bin/env ts-node
/**
 * Change a user's role in a case.
 * Usage: npm run scripts:change-role -- --email "user@example.com" --case-id <uuid> --role guest
 */
import { createConnection, parseArgs, colors } from './db-connect';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !args['case-id'] || !args.role) {
    console.error(colors.red('Usage: --email <email> --case-id <uuid> --role owner|guest'));
    process.exit(1);
  }

  if (args.role !== 'owner' && args.role !== 'guest') {
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

    const result = await ds.query(
      'UPDATE case_members SET role = $1 WHERE user_id = $2 AND case_id = $3 RETURNING id',
      [args.role, users[0].id, args['case-id']],
    );

    if (result[1] === 0) {
      console.error(colors.red(`${args.email} is not a member of case ${args['case-id']}`));
      process.exit(1);
    }

    console.log(colors.green(`Changed ${users[0].name}'s role to ${args.role} in case ${args['case-id']}`));
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(colors.red(err.message));
  process.exit(1);
});
