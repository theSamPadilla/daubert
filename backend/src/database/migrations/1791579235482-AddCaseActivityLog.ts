import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCaseActivityLog1791579235482 implements MigrationInterface {
    name = 'AddCaseActivityLog1791579235482'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "case_activity_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "case_id" uuid NOT NULL, "user_id" uuid, "source" character varying(16) NOT NULL, "agent" character varying(255), "conversation_id" uuid, "mcp_session_id" uuid, "action" character varying(64) NOT NULL, "input" jsonb NOT NULL, "status" character varying(16) NOT NULL, "summary" jsonb, "backfilled" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_a9d00bf80d28097653b11066ce8" PRIMARY KEY ("id"))`);
        // Backfill before the index and FKs: ADD FOREIGN KEY holds SHARE ROW EXCLUSIVE on "cases"
        // and "users" until commit, so adding FKs last keeps that lock off the backfill.
        // Rebuilds chat entries from surviving messages; older chats were purged by the 30-day job.
        await queryRunner.query(`
            WITH "results" AS (
                SELECT m2."conversation_id", rb->>'tool_use_id' AS "tool_use_id",
                       bool_or(rb->>'content' LIKE '{"error":%') AS "has_error",
                       bool_or(rb->>'content' LIKE '%"status":"error"%' OR rb->>'content' LIKE '%"status":"timeout"%') AS "script_failed"
                FROM "messages" m2
                CROSS JOIN LATERAL jsonb_array_elements(
                    CASE WHEN jsonb_typeof(m2."content") = 'array' THEN m2."content" ELSE '[]'::jsonb END) rb
                WHERE m2."role" = 'user' AND rb->>'type' = 'tool_result'
                GROUP BY 1, 2
            ), "models" AS (
                SELECT DISTINCT ON (t."message_id") t."message_id", t."model"
                FROM "token_usage" t
                WHERE t."message_id" IS NOT NULL
                ORDER BY t."message_id", t."created_at"
            )
            INSERT INTO "case_activity_log"
                ("case_id", "user_id", "source", "agent", "conversation_id", "action", "input", "status", "summary", "backfilled", "created_at")
            SELECT c."case_id", c."user_id", 'chat', tu."model", c."id",
                   e.b->>'name',
                   CASE WHEN length(COALESCE(e.b->'input', '{}'::jsonb)::text) > 16384
                        THEN jsonb_build_object('_truncated', true, 'preview', left((e.b->'input')::text, 16384))
                        ELSE COALESCE(e.b->'input', '{}'::jsonb) END,
                   CASE WHEN r."has_error" OR (e.b->>'name' = 'execute_script' AND r."script_failed") OR ws."failed"
                        THEN 'error' ELSE 'ok' END,
                   NULL, true,
                   -- messages.created_at is timestamp without time zone holding UTC; +ord ms keeps block order within a turn.
                   (m."created_at" AT TIME ZONE 'UTC') + e.ord * interval '1 millisecond'
            FROM "messages" m
            JOIN "conversations" c ON c."id" = m."conversation_id"
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(m."content") = 'array' THEN m."content" ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS e(b, ord)
            LEFT JOIN "models" tu ON tu."message_id" = m."id"
            LEFT JOIN "results" r ON r."conversation_id" = m."conversation_id" AND r."tool_use_id" = e.b->>'id'
            -- A web search result lives in the same assistant message; on failure its content is an object, not a list.
            LEFT JOIN LATERAL (
                SELECT bool_or(jsonb_typeof(wb->'content') = 'object') AS "failed"
                FROM jsonb_array_elements(m."content") wb
                WHERE wb->>'type' = 'web_search_tool_result' AND wb->>'tool_use_id' = e.b->>'id'
            ) ws ON true
            WHERE m."role" = 'assistant'
              AND (e.b->>'type' = 'tool_use' OR (e.b->>'type' = 'server_tool_use' AND e.b->>'name' = 'web_search'))
        `);
        await queryRunner.query(`CREATE INDEX "ix_case_activity_log_case_created" ON "case_activity_log" ("case_id", "created_at", "id") `);
        await queryRunner.query(`ALTER TABLE "case_activity_log" ADD CONSTRAINT "FK_294064b0f959ab7a2b4d55bead3" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "case_activity_log" ADD CONSTRAINT "FK_f887ece9e6a0169ad6e261bf01f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        // Append-only: reject UPDATE/DELETE/TRUNCATE except the foreign-key actions
        // (case deleted -> CASCADE, user deleted -> SET NULL), which run as nested
        // RI triggers, so pg_trigger_depth() > 1.
        await queryRunner.query(`
            CREATE FUNCTION "case_activity_log_append_only"() RETURNS trigger AS $$
            BEGIN
                IF TG_OP <> 'TRUNCATE' AND pg_trigger_depth() > 1 THEN
                    RETURN COALESCE(NEW, OLD);
                END IF;
                RAISE EXCEPTION 'case_activity_log is append-only';
            END
            $$ LANGUAGE plpgsql
        `);
        await queryRunner.query(`CREATE TRIGGER "case_activity_log_no_update_delete" BEFORE UPDATE OR DELETE ON "case_activity_log" FOR EACH ROW EXECUTE FUNCTION "case_activity_log_append_only"()`);
        await queryRunner.query(`CREATE TRIGGER "case_activity_log_no_truncate" BEFORE TRUNCATE ON "case_activity_log" FOR EACH STATEMENT EXECUTE FUNCTION "case_activity_log_append_only"()`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TRIGGER "case_activity_log_no_truncate" ON "case_activity_log"`);
        await queryRunner.query(`DROP TRIGGER "case_activity_log_no_update_delete" ON "case_activity_log"`);
        await queryRunner.query(`DROP FUNCTION "case_activity_log_append_only"()`);
        await queryRunner.query(`ALTER TABLE "case_activity_log" DROP CONSTRAINT "FK_f887ece9e6a0169ad6e261bf01f"`);
        await queryRunner.query(`ALTER TABLE "case_activity_log" DROP CONSTRAINT "FK_294064b0f959ab7a2b4d55bead3"`);
        await queryRunner.query(`DROP INDEX "public"."ix_case_activity_log_case_created"`);
        await queryRunner.query(`DROP TABLE "case_activity_log"`);
    }

}
