import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLabeledEntities1777151576595 implements MigrationInterface {
    name = 'AddLabeledEntities1777151576595'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "labeled_entities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "category" character varying NOT NULL, "description" text, "wallets" jsonb NOT NULL DEFAULT '[]'::jsonb, "metadata" jsonb, CONSTRAINT "PK_d502652372e4f9feb2e8803635f" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "labeled_entities"`);
    }

}
