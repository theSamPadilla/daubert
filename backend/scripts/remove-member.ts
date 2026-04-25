#!/usr/bin/env ts-node
/**
 * Remove a user from a case.
 * Usage: npm run scripts:remove-member -- --email "user@example.com" --case-id <uuid>
 */
import { createConnection, parseArgs, colors } from './db-connect';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !args['case-id']) {
    console.error(colors.red('Usage: --email <email> --case-id <uuid>'));
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
      'DELETE FROM case_members WHERE user_id = $1 AND case_id = $2 RETURNING id',
      [users[0].id, args['case-id']],
    );

    if (result[1] === 0) {
      console.log(colors.yellow(`${args.email} is not a member of case ${args['case-id']}`));
    } else {
      console.log(colors.green(`Removed ${users[0].name} from case ${args['case-id']}`));
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(colors.red(err.message));
  process.exit(1);
});
