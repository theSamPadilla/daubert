import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOAuthAndAgentAudit1781278460495 implements MigrationInterface {
  name = 'AddOAuthAndAgentAudit1781278460495';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create the revoked-reason enum used by oauth_session.
    //    Guarded with a DO block so a partial re-run does not blow up.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "oauth_session_revoked_reason" AS ENUM (
          'user',
          'admin',
          'refresh_reuse',
          'owner_deactivated',
          'membership_revoked'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // 2. oauth_client — registered MCP client apps (RFC 7591 + pre-seeded).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "oauth_client" (
        "client_id" character varying(64) NOT NULL,
        "display_name" character varying(128) NOT NULL,
        "redirect_uris" text array NOT NULL,
        "is_public_client" boolean NOT NULL DEFAULT true,
        "is_dynamic" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oauth_client" PRIMARY KEY ("client_id")
      )
    `);

    // 3. oauth_session — one row per active (user, org, surface) connect-grant.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "oauth_session" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_user_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "client_id" character varying(64) NOT NULL,
        "surface_label" character varying(255) NOT NULL,
        "access_token_hash" character varying(64) NOT NULL,
        "refresh_token_hash" character varying(64) NOT NULL,
        "access_token_expires_at" TIMESTAMP NOT NULL,
        "refresh_token_expires_at" TIMESTAMP NOT NULL,
        "last_used_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "revoked_at" TIMESTAMP,
        "revoked_reason" "oauth_session_revoked_reason",
        CONSTRAINT "PK_oauth_session" PRIMARY KEY ("id")
      )
    `);

    // Partial indexes — only enforce uniqueness / lookup speed on live rows.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ix_oauth_session_access_token_hash"
        ON "oauth_session" ("access_token_hash")
        WHERE "revoked_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ix_oauth_session_refresh_token_hash"
        ON "oauth_session" ("refresh_token_hash")
        WHERE "revoked_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_oauth_session_owner_org_active"
        ON "oauth_session" ("owner_user_id", "organization_id")
        WHERE "revoked_at" IS NULL
    `);

    // 4. oauth_code — short-lived authorization codes (60s TTL, single-use).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "oauth_code" (
        "code" character varying(128) NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "client_id" character varying(64) NOT NULL,
        "code_challenge" character varying(128) NOT NULL,
        "code_challenge_method" character varying(16) NOT NULL,
        "redirect_uri" character varying(2048) NOT NULL,
        "state" character varying(512),
        "expires_at" TIMESTAMP NOT NULL,
        "consumed_at" TIMESTAMP,
        CONSTRAINT "PK_oauth_code" PRIMARY KEY ("code")
      )
    `);

    // 5. oauth_consumed_state — replay cache for signed state-bags.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "oauth_consumed_state" (
        "bag_id" character varying(64) NOT NULL,
        "consumed_at" TIMESTAMP NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_oauth_consumed_state" PRIMARY KEY ("bag_id")
      )
    `);

    // 6. agent_audit_log — append-only audit trail of MCP tool calls.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_audit_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "session_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "action" character varying(64) NOT NULL,
        "target_ref" character varying(255),
        "status" character varying(16) NOT NULL,
        "detail" jsonb,
        CONSTRAINT "PK_agent_audit_log" PRIMARY KEY ("id")
      )
    `);

    // session_id is intentionally NOT a FK (sessions are soft-revoked, never
    // deleted) — but we still want lookups by session to be cheap.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_agent_audit_log_session_id"
        ON "agent_audit_log" ("session_id")
    `);

    // 7. Foreign keys (idempotent via duplicate_object guard).
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "oauth_session" ADD CONSTRAINT "FK_oauth_session_owner_user_id"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "oauth_session" ADD CONSTRAINT "FK_oauth_session_organization_id"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "oauth_session" ADD CONSTRAINT "FK_oauth_session_client_id"
          FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // FK-safe order: drop FKs → drop dependent indexes/tables → drop enum.
    await queryRunner.query(
      `ALTER TABLE "oauth_session" DROP CONSTRAINT IF EXISTS "FK_oauth_session_client_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "oauth_session" DROP CONSTRAINT IF EXISTS "FK_oauth_session_organization_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "oauth_session" DROP CONSTRAINT IF EXISTS "FK_oauth_session_owner_user_id"`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "public"."ix_agent_audit_log_session_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_audit_log"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "oauth_consumed_state"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "oauth_code"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "public"."ix_oauth_session_owner_org_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."ix_oauth_session_refresh_token_hash"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."ix_oauth_session_access_token_hash"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "oauth_session"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "oauth_client"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "oauth_session_revoked_reason"`);
  }
}
