import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDeclarationLibraryBlocks1784696424940 implements MigrationInterface {
    name = 'AddDeclarationLibraryBlocks1784696424940'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "declaration_library_blocks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "kind" character varying NOT NULL, "name" character varying NOT NULL, "category" character varying, "content" jsonb NOT NULL DEFAULT '{}'::jsonb, "organization_id" uuid NOT NULL, CONSTRAINT "PK_f9eae0090260453260037d0d450" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "declaration_library_blocks" ADD CONSTRAINT "FK_0380592555d69c40821e3fd44eb" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "declaration_library_blocks" DROP CONSTRAINT "FK_0380592555d69c40821e3fd44eb"`);
        await queryRunner.query(`DROP TABLE "declaration_library_blocks"`);
    }

}
