import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrganizationsAndSuperadmin1780344234718 implements MigrationInterface {
  name = 'OrganizationsAndSuperadmin1780344234718';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create new tables (idempotent via IF NOT EXISTS)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organizations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "name" character varying NOT NULL,
        "slug" character varying NOT NULL,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_963693341bd612aa01ddf3a4b6" ON "organizations" ("slug")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organization_members" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "user_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "role" character varying NOT NULL DEFAULT 'guest',
        CONSTRAINT "UQ_f4812f00736e35131a65d6032da" UNIQUE ("user_id", "organization_id"),
        CONSTRAINT "PK_c2b39d5d072886a4d9c8105eb9a" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organization_invites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "email" character varying NOT NULL,
        "role" character varying NOT NULL,
        "code" character varying NOT NULL,
        "message" text,
        "created_by_user_id" uuid NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        "used_by_user_id" uuid,
        CONSTRAINT "PK_e0799bee14bf23b82851d55fd05" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_89053f57bae552fa77241494df" ON "organization_invites" ("email")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_4ae29ba7d770a4f0c3115fb287" ON "organization_invites" ("code")
    `);

    // 2. Add new columns (IF NOT EXISTS is supported on ADD COLUMN in Postgres 9.6+)
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_super_admin" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "organization_id" uuid NULL
    `);

    // 3. Add FK constraints for new tables (idempotent via DO $$ ... EXCEPTION WHEN duplicate_object)
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "organization_members" ADD CONSTRAINT "FK_89bde91f78d36ca41e9515d91c6"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "organization_members" ADD CONSTRAINT "FK_7062a4fbd9bab22ffd918e5d3d9"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "organization_invites" ADD CONSTRAINT "FK_86ee44dc17238efe40601b14540"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "organization_invites" ADD CONSTRAINT "FK_4a24bea80fad6847aa503b18a5e"
          FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "organization_invites" ADD CONSTRAINT "FK_138d6a6cb73b58d50e3386b6e4c"
          FOREIGN KEY ("used_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // 4. Seed the Incite org with slug 'incite' (WHERE NOT EXISTS guards re-runs)
    await queryRunner.query(`
      INSERT INTO "organizations" ("id", "name", "slug", "created_at", "updated_at")
      SELECT gen_random_uuid(), 'Incite', 'incite', NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM "organizations" WHERE "slug" = 'incite')
    `);

    // 5. Backfill organization_members from users.org_role
    //    Guarded on the existence of org_role column so a re-run after the drop is safe.
    const hasOrgRole = await queryRunner.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'org_role'
    `);

    if (hasOrgRole.length > 0) {
      await queryRunner.query(`
        INSERT INTO "organization_members" ("id", "user_id", "organization_id", "role", "created_at", "updated_at")
        SELECT gen_random_uuid(), u."id", o."id", u."org_role", NOW(), NOW()
        FROM "users" u
        CROSS JOIN "organizations" o
        WHERE o."slug" = 'incite'
        ON CONFLICT ("user_id", "organization_id") DO NOTHING
      `);
    }

    // 6. Promote @incite.ventures users to superadmin (idempotent UPDATE)
    await queryRunner.query(`
      UPDATE "users" SET "is_super_admin" = TRUE
      WHERE "email" LIKE '%@incite.ventures' AND "is_super_admin" = FALSE
    `);

    // 7. Backfill cases.organization_id to the Incite org (only NULL rows — idempotent)
    await queryRunner.query(`
      UPDATE "cases"
      SET "organization_id" = (SELECT "id" FROM "organizations" WHERE "slug" = 'incite' LIMIT 1)
      WHERE "organization_id" IS NULL
    `);

    // 8. Set organization_id NOT NULL and add FK constraint
    //    SET NOT NULL is a no-op if the column is already NOT NULL.
    await queryRunner.query(`ALTER TABLE "cases" ALTER COLUMN "organization_id" SET NOT NULL`);

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "cases" ADD CONSTRAINT "FK_c47a144982a0234b25f91e07717"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // 9. Drop the old org_role column (IF EXISTS makes this idempotent on re-run)
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "org_role"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // NOTE: down() causes data loss — org membership and superadmin status are not recoverable.
    // This is acceptable pre-launch. Run only in an emergency rollback scenario.

    // Restore org_role column (values lost — everyone reverts to 'guest')
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "org_role" character varying NOT NULL DEFAULT 'guest'`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "is_super_admin"`);

    // Drop cases FK and organization_id column
    await queryRunner.query(`ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "FK_c47a144982a0234b25f91e07717"`);
    await queryRunner.query(`ALTER TABLE "cases" DROP COLUMN IF EXISTS "organization_id"`);

    // Drop organization_invites
    await queryRunner.query(`ALTER TABLE "organization_invites" DROP CONSTRAINT IF EXISTS "FK_138d6a6cb73b58d50e3386b6e4c"`);
    await queryRunner.query(`ALTER TABLE "organization_invites" DROP CONSTRAINT IF EXISTS "FK_4a24bea80fad6847aa503b18a5e"`);
    await queryRunner.query(`ALTER TABLE "organization_invites" DROP CONSTRAINT IF EXISTS "FK_86ee44dc17238efe40601b14540"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_4ae29ba7d770a4f0c3115fb287"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_89053f57bae552fa77241494df"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organization_invites"`);

    // Drop organization_members
    await queryRunner.query(`ALTER TABLE "organization_members" DROP CONSTRAINT IF EXISTS "FK_7062a4fbd9bab22ffd918e5d3d9"`);
    await queryRunner.query(`ALTER TABLE "organization_members" DROP CONSTRAINT IF EXISTS "FK_89bde91f78d36ca41e9515d91c6"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organization_members"`);

    // Drop organizations
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_963693341bd612aa01ddf3a4b6"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organizations"`);

    // Restore DEFAULT changes
    await queryRunner.query(`ALTER TABLE "labeled_entities" ALTER COLUMN "wallets" SET DEFAULT '[]'`);
    await queryRunner.query(`ALTER TABLE "productions" ALTER COLUMN "data" SET DEFAULT '{}'`);
  }
}
