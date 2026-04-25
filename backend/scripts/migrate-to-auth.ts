#!/usr/bin/env ts-node
/**
 * One-time migration: consolidates data under the Geffen case,
 * creates case_members, scopes conversations, and cleans up empty cases.
 *
 * Dry-run by default. Pass --execute to actually run.
 *
 * Usage:
 *   npm run scripts:migrate-to-auth                  # dry-run
 *   npm run scripts:migrate-to-auth -- --execute      # actually run
 */
import { createConnection, parseArgs, colors } from './db-connect';
import { DataSource } from 'typeorm';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.execute !== 'true';

  if (dryRun) {
    console.log(colors.yellow('DRY RUN — no changes will be made. Pass --execute to run for real.\n'));
  }

  const ds = await createConnection();
  const qr = ds.createQueryRunner();
  await qr.connect();

  try {
    // Step 1: Find the Geffen case
    const geffenCases = await qr.query(
      "SELECT id, name FROM cases WHERE LOWER(name) = 'geffen'",
    );
    if (geffenCases.length === 0) {
      console.error(colors.red('No case named "Geffen" found. Aborting.'));
      process.exit(1);
    }
    const geffenId = geffenCases[0].id;
    console.log(colors.cyan(`Found Geffen case: ${geffenId}`));

    // Step 2: Find Sam's user row
    const samUsers = await qr.query(
      "SELECT id, name, email FROM users WHERE email = 'sam@incite.ventures'",
    );
    if (samUsers.length === 0) {
      // Try to find any user and update email
      const allUsers = await qr.query('SELECT id, name, email FROM users LIMIT 1');
      if (allUsers.length === 0) {
        console.error(colors.red('No users found. Aborting.'));
        process.exit(1);
      }
      console.log(colors.yellow(`No sam@incite.ventures user found. Using ${allUsers[0].email} instead.`));
      if (!dryRun) {
        await qr.query(
          "UPDATE users SET email = 'sam@incite.ventures' WHERE id = $1",
          [allUsers[0].id],
        );
      }
      samUsers.push({ ...allUsers[0], email: 'sam@incite.ventures' });
    }
    const samId = samUsers[0].id;
    console.log(colors.cyan(`Sam's user row: ${samId} <${samUsers[0].email}>`));

    if (!dryRun) {
      await qr.startTransaction();
    }

    try {
      // Step 3: Create case_members for all cases
      const allCases = await qr.query('SELECT id, name FROM cases');
      let membersCreated = 0;
      for (const c of allCases) {
        const existing = await qr.query(
          'SELECT id FROM case_members WHERE user_id = $1 AND case_id = $2',
          [samId, c.id],
        );
        if (existing.length === 0) {
          if (!dryRun) {
            await qr.query(
              'INSERT INTO case_members (user_id, case_id, role, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
              [samId, c.id, 'owner'],
            );
          }
          membersCreated++;
        }
      }
      console.log(`  case_members created: ${membersCreated}`);

      // Step 4: Move all investigations to Geffen
      const invResult = await qr.query(
        'SELECT COUNT(*) as count FROM investigations WHERE case_id != $1',
        [geffenId],
      );
      const invCount = parseInt(invResult[0].count, 10);
      if (!dryRun && invCount > 0) {
        await qr.query(
          'UPDATE investigations SET case_id = $1 WHERE case_id != $1',
          [geffenId],
        );
      }
      console.log(`  investigations moved to Geffen: ${invCount}`);

      // Step 5: Scope all conversations to Geffen
      const convResult = await qr.query(
        'SELECT COUNT(*) as count FROM conversations WHERE case_id IS NULL',
      );
      const convCount = parseInt(convResult[0].count, 10);
      if (!dryRun && convCount > 0) {
        await qr.query(
          'UPDATE conversations SET case_id = $1 WHERE case_id IS NULL',
          [geffenId],
        );
      }
      console.log(`  conversations scoped to Geffen: ${convCount}`);

      // Step 6: Delete empty cases
      const emptyCases = await qr.query(
        `SELECT c.id, c.name FROM cases c
         LEFT JOIN investigations i ON i.case_id = c.id
         WHERE c.id != $1
         GROUP BY c.id
         HAVING COUNT(i.id) = 0`,
        [geffenId],
      );
      if (!dryRun && emptyCases.length > 0) {
        const ids = emptyCases.map((c: any) => c.id);
        await qr.query('DELETE FROM case_members WHERE case_id = ANY($1)', [ids]);
        await qr.query('DELETE FROM cases WHERE id = ANY($1)', [ids]);
      }
      console.log(`  empty cases deleted: ${emptyCases.length}`);
      for (const c of emptyCases) {
        console.log(`    - "${c.name}" (${c.id})`);
      }

      if (!dryRun) {
        await qr.commitTransaction();
        console.log(colors.green('\nMigration completed successfully.'));
      } else {
        console.log(colors.yellow('\nDry run complete. Pass --execute to apply changes.'));
      }
    } catch (err) {
      if (!dryRun) {
        await qr.rollbackTransaction();
      }
      throw err;
    }
  } finally {
    await qr.release();
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(colors.red(err.message));
  process.exit(1);
});
