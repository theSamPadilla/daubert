import { MigrationInterface, QueryRunner } from "typeorm";

export class AddActivityLogConversationIndex1791747500375 implements MigrationInterface {
    name = 'AddActivityLogConversationIndex1791747500375'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX "ix_case_activity_log_conversation_created" ON "case_activity_log" ("conversation_id", "created_at", "id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."ix_case_activity_log_conversation_created"`);
    }

}
