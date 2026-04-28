import { MigrationInterface, QueryRunner } from "typeorm";

// See docs/plans/2026-04-27-conversation-case-scoping.md
export class AddUserIdToConversations1777342782714 implements MigrationInterface {
    name = 'AddUserIdToConversations1777342782714'

    private readonly SEED_USER_EMAIL = 'sam@incite.ventures';
    private readonly ORPHAN_CASE_NAME = 'Geffen';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Add user_id as NULLABLE first so existing rows don't fail the NOT NULL check.
        await queryRunner.query(`ALTER TABLE "conversations" ADD "user_id" uuid`);

        // 2. Backfill user_id — attribute all pre-migration conversations to the seed user.
        //    Messages have no per-message author column, so we cannot do better than
        //    a flat attribution. This is acceptable because, prior to this fix, only
        //    Sam was creating conversations in practice.
        await queryRunner.query(
            `
            UPDATE "conversations"
            SET "user_id" = (SELECT "id" FROM "users" WHERE "email" = $1)
            WHERE "user_id" IS NULL
        `,
            [this.SEED_USER_EMAIL],
        );

        // 3. Fail loudly if backfill missed rows (e.g., the user record doesn't exist on this DB).
        const orphans = await queryRunner.query(
            `SELECT COUNT(*)::int AS n FROM "conversations" WHERE "user_id" IS NULL`,
        );
        if (orphans[0].n > 0) {
            throw new Error(
                `AddUserIdToConversations: ${orphans[0].n} conversations have no user_id after backfill. ` +
                `Confirm ${this.SEED_USER_EMAIL} exists in the users table before re-running.`,
            );
        }

        // 4. Backfill case_id orphans — pre-case-required-era conversations have NULL
        //    case_id. Attribute them to the named "orphan home" case (Geffen — see
        //    plan). Lookup by name; require exactly one match so we never silently
        //    pick the wrong case if the name happens to be ambiguous.
        const orphanCaseCount = await queryRunner.query(
            `SELECT COUNT(*)::int AS n FROM "conversations" WHERE "case_id" IS NULL`,
        );
        if (orphanCaseCount[0].n > 0) {
            const targetCase = await queryRunner.query(
                `SELECT "id" FROM "cases" WHERE "name" = $1`,
                [this.ORPHAN_CASE_NAME],
            );
            if (targetCase.length === 0) {
                throw new Error(
                    `AddUserIdToConversations: ${orphanCaseCount[0].n} conversations have NULL case_id, ` +
                    `but the orphan home case "${this.ORPHAN_CASE_NAME}" was not found. ` +
                    `Create the case or pre-attribute orphans before re-running.`,
                );
            }
            if (targetCase.length > 1) {
                throw new Error(
                    `AddUserIdToConversations: orphan home case name "${this.ORPHAN_CASE_NAME}" is ambiguous ` +
                    `(${targetCase.length} matches). Resolve before re-running.`,
                );
            }
            await queryRunner.query(
                `
                UPDATE "conversations"
                SET "case_id" = $1
                WHERE "case_id" IS NULL
            `,
                [targetCase[0].id],
            );
        }

        // 5. Tighten user_id: NOT NULL + FK + composite index.
        await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "user_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD CONSTRAINT "FK_3a9ae579e61e81cc0e989afeb4a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_conversations_case_user" ON "conversations" ("case_id", "user_id")`);

        // 6. Tighten case_id to NOT NULL — deep fix per CLAUDE.md. Defense-in-depth
        //    guard: even after step 4 we re-check, so a logic bug in the attribution
        //    can't sneak past us into a NOT NULL column.
        const remainingOrphans = await queryRunner.query(
            `SELECT COUNT(*)::int AS n FROM "conversations" WHERE "case_id" IS NULL`,
        );
        if (remainingOrphans[0].n > 0) {
            throw new Error(
                `AddUserIdToConversations: ${remainingOrphans[0].n} conversations still have NULL case_id ` +
                `after attribution. This indicates a bug in step 4.`,
            );
        }
        await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "case_id" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reverse step 5: revert case_id to nullable. The FK on case_id is untouched
        // by up(), so nothing to rebuild here.
        await queryRunner.query(`ALTER TABLE "conversations" ALTER COLUMN "case_id" DROP NOT NULL`);

        // Reverse step 4: drop index, FK, then column.
        await queryRunner.query(`DROP INDEX "IDX_conversations_case_user"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP CONSTRAINT "FK_3a9ae579e61e81cc0e989afeb4a"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "user_id"`);
    }

}
