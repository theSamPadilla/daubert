import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOtps1780426951705 implements MigrationInterface {
    name = 'CreateOtps1780426951705'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "otps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "email" character varying NOT NULL, "code" character varying NOT NULL, "expires_at" TIMESTAMP NOT NULL, "verified" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_91fef5ed60605b854a2115d2410" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a1a32e0358e00377e99f3199cd" ON "otps" ("email", "verified") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_a1a32e0358e00377e99f3199cd"`);
        await queryRunner.query(`DROP TABLE "otps"`);
    }

}
