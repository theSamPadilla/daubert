import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductions1777155242087 implements MigrationInterface {
    name = 'AddProductions1777155242087'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "productions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "type" character varying NOT NULL, "data" jsonb NOT NULL DEFAULT '{}'::jsonb, "case_id" uuid NOT NULL, CONSTRAINT "PK_395fda0b6f26cb5fd9a2aa6315c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "labeled_entities" ALTER COLUMN "wallets" SET DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "productions" ADD CONSTRAINT "FK_f276b7e145dbb79a547dfc8872b" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "productions" DROP CONSTRAINT "FK_f276b7e145dbb79a547dfc8872b"`);
        await queryRunner.query(`ALTER TABLE "labeled_entities" ALTER COLUMN "wallets" SET DEFAULT '[]'`);
        await queryRunner.query(`DROP TABLE "productions"`);
    }

}
