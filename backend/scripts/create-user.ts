#!/usr/bin/env ts-node
/**
 * Create a new user in the database.
 * Usage: npm run scripts:create-user -- --email "user@example.com" --name "Jane Doe"
 */
import { createConnection, parseArgs, colors } from './db-connect';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !args.name) {
    console.error(colors.red('Usage: --email <email> --name <name>'));
    process.exit(1);
  }

  const ds = await createConnection();

  try {
    const existing = await ds.query(
      'SELECT id, email FROM users WHERE email = $1',
      [args.email],
    );

    if (existing.length > 0) {
      console.log(colors.yellow(`User already exists: ${args.email} (${existing[0].id})`));
      return;
    }

    const result = await ds.query(
      'INSERT INTO users (name, email, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING id',
      [args.name, args.email],
    );

    console.log(colors.green(`Created user: ${args.name} <${args.email}>`));
    console.log(`  ID: ${result[0].id}`);
    console.log(colors.cyan('  Tell them to sign in with Google at the app URL.'));
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(colors.red(err.message));
  process.exit(1);
});
