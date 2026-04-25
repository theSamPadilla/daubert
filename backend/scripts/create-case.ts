#!/usr/bin/env ts-node
/**
 * Create a new case and assign an owner.
 * Usage: npm run scripts:create-case -- --name "Case Name" --owner-email "sam@incite.ventures"
 */
import { createConnection, parseArgs, colors } from './db-connect';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.name || !args['owner-email']) {
    console.error(colors.red('Usage: --name <case name> --owner-email <email>'));
    process.exit(1);
  }

  const ds = await createConnection();

  try {
    const users = await ds.query(
      'SELECT id, name FROM users WHERE email = $1',
      [args['owner-email']],
    );

    if (users.length === 0) {
      console.error(colors.red(`No user found with email: ${args['owner-email']}`));
      console.error('Create the user first: npm run scripts:create-user -- --email ... --name ...');
      process.exit(1);
    }

    const owner = users[0];

    const caseResult = await ds.query(
      'INSERT INTO cases (name, user_id, links, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id',
      [args.name, owner.id, '[]'],
    );

    const caseId = caseResult[0].id;

    await ds.query(
      'INSERT INTO case_members (user_id, case_id, role, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
      [owner.id, caseId, 'owner'],
    );

    console.log(colors.green(`Created case: "${args.name}"`));
    console.log(`  Case ID: ${caseId}`);
    console.log(`  Owner: ${owner.name} <${args['owner-email']}>`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(colors.red(err.message));
  process.exit(1);
});
