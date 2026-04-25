#!/usr/bin/env ts-node
/**
 * List users, optionally filtered by case.
 * Usage: npm run scripts:list-users [-- --case-id <uuid>]
 */
import { createConnection, parseArgs, colors } from './db-connect';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ds = await createConnection();

  try {
    if (args['case-id']) {
      const cases = await ds.query('SELECT name FROM cases WHERE id = $1', [args['case-id']]);
      if (cases.length === 0) {
        console.error(colors.red(`No case found with ID: ${args['case-id']}`));
        process.exit(1);
      }

      console.log(colors.bold(`Members of "${cases[0].name}":\n`));

      const members = await ds.query(
        `SELECT u.name, u.email, u.firebase_uid, cm.role, cm.created_at
         FROM case_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.case_id = $1
         ORDER BY cm.role, u.name`,
        [args['case-id']],
      );

      if (members.length === 0) {
        console.log('  (no members)');
        return;
      }

      for (const m of members) {
        const linked = m.firebase_uid ? colors.green('linked') : colors.yellow('pending');
        console.log(`  ${m.role.padEnd(6)} ${m.name} <${m.email}> [${linked}]`);
      }
    } else {
      const users = await ds.query(
        'SELECT name, email, firebase_uid, created_at FROM users ORDER BY name',
      );

      console.log(colors.bold(`All users (${users.length}):\n`));

      for (const u of users) {
        const linked = u.firebase_uid ? colors.green('linked') : colors.yellow('pending');
        console.log(`  ${u.name} <${u.email}> [${linked}]`);
      }
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(colors.red(err.message));
  process.exit(1);
});
