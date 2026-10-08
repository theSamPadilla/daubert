import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAgentRuns1791416963448 implements MigrationInterface {
    name = 'AddAgentRuns1791416963448'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "agent_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "conversation_id" uuid NOT NULL, "user_id" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'queued', "user_message_id" uuid, "case_id" uuid, "investigation_id" uuid, "model" character varying, "viewer_role" character varying NOT NULL, "cancel_requested_at" TIMESTAMP WITH TIME ZONE, "started_at" TIMESTAMP WITH TIME ZONE, "heartbeat_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, "error" jsonb, CONSTRAINT "PK_442f7e0ec4ae860cf17edc57825" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_agent_runs_conversation_created" ON "agent_runs" ("conversation_id", "created_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_agent_runs_active_per_conversation" ON "agent_runs" ("conversation_id") WHERE "status" IN ('queued', 'running')`);
        await queryRunner.query(`CREATE TABLE "agent_run_events" ("run_id" uuid NOT NULL, "seq" integer NOT NULL, "type" character varying NOT NULL, "data" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b8a1df1e8ca9fd6adff94428397" PRIMARY KEY ("run_id", "seq"))`);
        await queryRunner.query(`ALTER TABLE "agent_runs" ADD CONSTRAINT "FK_3bf7cd6e8aa46c1c6008bf7d0d3" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "agent_run_events" ADD CONSTRAINT "FK_9dcc7738d94725c47d3d8bed8de" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "agent_run_events" DROP CONSTRAINT "FK_9dcc7738d94725c47d3d8bed8de"`);
        await queryRunner.query(`ALTER TABLE "agent_runs" DROP CONSTRAINT "FK_3bf7cd6e8aa46c1c6008bf7d0d3"`);
        await queryRunner.query(`DROP TABLE "agent_run_events"`);
        await queryRunner.query(`DROP INDEX "public"."uq_agent_runs_active_per_conversation"`);
        await queryRunner.query(`DROP INDEX "public"."ix_agent_runs_conversation_created"`);
        await queryRunner.query(`DROP TABLE "agent_runs"`);
    }

}
