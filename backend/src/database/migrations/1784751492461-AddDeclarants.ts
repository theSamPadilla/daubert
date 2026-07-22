import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDeclarants1784751492461 implements MigrationInterface {
    name = 'AddDeclarants1784751492461'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "declarants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "display_name" character varying NOT NULL, "title" character varying, "firm" character varying, "qualifications" jsonb NOT NULL DEFAULT '[]'::jsonb, "cv_exhibit" character varying, "prior_testimony" jsonb NOT NULL DEFAULT '[]'::jsonb, "hourly_rate" character varying, "non_contingency_disclosure" text, "date_of_birth" character varying, "address" text, "organization_id" uuid NOT NULL, "user_id" uuid, CONSTRAINT "PK_186b7976f802b277f58686f7a25" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "declarants" ADD CONSTRAINT "FK_c9a5dd6c9775b352b79f8075930" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "declarants" ADD CONSTRAINT "FK_265fefdbe611816a1580da49e8b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

        // Backfill: legacy "declarant_profile" declaration_library_blocks are superseded by
        // first-class declarants. Migrate each into a new declarant row (qualifications
        // paragraphs carried over verbatim), then remove the now-redundant library blocks.
        // declarant_profile blocks are the ONLY kind touched — "boilerplate" blocks are untouched
        // and remain the sole purpose of declaration_library_blocks going forward.
        await queryRunner.query(`
            INSERT INTO "declarants" ("id", "created_at", "updated_at", "display_name", "qualifications", "organization_id")
            SELECT uuid_generate_v4(), now(), now(), "name", COALESCE("content"->'paragraphs', '[]'::jsonb), "organization_id"
            FROM "declaration_library_blocks"
            WHERE "kind" = 'declarant_profile'
        `);
        await queryRunner.query(`DELETE FROM "declaration_library_blocks" WHERE "kind" = 'declarant_profile'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Note: the declarant_profile -> declaration_library_blocks backfill above is destructive
        // and NOT reversed here — the original blocks are deleted in up() and cannot be
        // reconstructed. down() only removes the declarants table/constraints added by this
        // migration.
        await queryRunner.query(`ALTER TABLE "declarants" DROP CONSTRAINT "FK_265fefdbe611816a1580da49e8b"`);
        await queryRunner.query(`ALTER TABLE "declarants" DROP CONSTRAINT "FK_c9a5dd6c9775b352b79f8075930"`);
        await queryRunner.query(`DROP TABLE "declarants"`);
    }

}
