import { MigrationInterface, QueryRunner } from "typeorm";

export class AgentToolingScopes1781213765062 implements MigrationInterface {
    name = 'AgentToolingScopes1781213765062'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Add anthropic_file_id to data_room_files (nullable)
        await queryRunner.query(`ALTER TABLE "data_room_files" ADD "anthropic_file_id" character varying`);

        // 2. Add case_id to script_runs as nullable first (table may have existing rows)
        await queryRunner.query(`ALTER TABLE "script_runs" ADD "case_id" uuid`);

        // 3. Backfill case_id from the related investigation
        await queryRunner.query(`UPDATE "script_runs" sr SET "case_id" = i."case_id" FROM "investigations" i WHERE i."id" = sr."investigation_id"`);

        // 4. Now enforce NOT NULL on case_id
        await queryRunner.query(`ALTER TABLE "script_runs" ALTER COLUMN "case_id" SET NOT NULL`);

        // 5. Make investigation_id nullable
        await queryRunner.query(`ALTER TABLE "script_runs" ALTER COLUMN "investigation_id" DROP NOT NULL`);

        // 6. Drop the old investigation FK (was CASCADE) and re-add it as SET NULL
        await queryRunner.query(`ALTER TABLE "script_runs" DROP CONSTRAINT IF EXISTS "FK_ae9b125aac8618d7b78c2518521"`);
        await queryRunner.query(`ALTER TABLE "script_runs" ADD CONSTRAINT "FK_ae9b125aac8618d7b78c2518521" FOREIGN KEY ("investigation_id") REFERENCES "investigations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

        // 7. Add case_id FK → cases(id) ON DELETE CASCADE
        await queryRunner.query(`ALTER TABLE "script_runs" ADD CONSTRAINT "FK_script_runs_case_id" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // 7 reversed: drop case_id FK
        await queryRunner.query(`ALTER TABLE "script_runs" DROP CONSTRAINT IF EXISTS "FK_script_runs_case_id"`);

        // 6 reversed: drop SET NULL investigation FK and restore CASCADE
        await queryRunner.query(`ALTER TABLE "script_runs" DROP CONSTRAINT IF EXISTS "FK_ae9b125aac8618d7b78c2518521"`);
        await queryRunner.query(`ALTER TABLE "script_runs" ADD CONSTRAINT "FK_ae9b125aac8618d7b78c2518521" FOREIGN KEY ("investigation_id") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // 5 reversed: restore investigation_id NOT NULL (will fail if any rows have null investigation_id)
        await queryRunner.query(`ALTER TABLE "script_runs" ALTER COLUMN "investigation_id" SET NOT NULL`);

        // 4+3+2 reversed: drop case_id column (no need to reverse NOT NULL separately)
        await queryRunner.query(`ALTER TABLE "script_runs" DROP COLUMN "case_id"`);

        // 1 reversed: drop anthropic_file_id
        await queryRunner.query(`ALTER TABLE "data_room_files" DROP COLUMN "anthropic_file_id"`);
    }

}
