import { MigrationInterface, QueryRunner } from "typeorm";

export class ConversationHistoryTruncated1791747829657 implements MigrationInterface {
    name = 'ConversationHistoryTruncated1791747829657'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" ADD "history_truncated_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE INDEX "IDX_messages_conversation_created" ON "messages" ("conversation_id", "created_at") `);
        // Backfill: token_usage is never purged and is written after the turn's
        // user message, so only activity older than the retention window could
        // have had its messages purged. A conversation whose first usage row
        // is older than 30 days and predates its first remaining message by
        // more than a minute has already lost messages to the purge.
        await queryRunner.query(`
            UPDATE "conversations" c
            SET "history_truncated_at" = NOW()
            FROM (
                SELECT u."conversation_id", MIN(u."created_at") AS first_activity
                FROM "token_usage" u
                WHERE u."conversation_id" IS NOT NULL
                GROUP BY u."conversation_id"
            ) act,
            (
                SELECT m."conversation_id", MIN(m."created_at") AS first_message
                FROM "messages" m
                GROUP BY m."conversation_id"
            ) msgs
            WHERE act."conversation_id" = c."id"
              AND msgs."conversation_id" = c."id"
              AND act.first_activity < NOW() - INTERVAL '30 days'
              AND act.first_activity < msgs.first_message - INTERVAL '1 minute'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_messages_conversation_created"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "history_truncated_at"`);
    }

}
