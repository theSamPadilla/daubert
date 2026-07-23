import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDeclarantFiles1784761553193 implements MigrationInterface {
    name = 'AddDeclarantFiles1784761553193'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "declarant_files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "declarant_id" uuid NOT NULL, "kind" character varying NOT NULL, "name" character varying NOT NULL, "mime_type" character varying NOT NULL, "size" bigint NOT NULL, "object_key" character varying NOT NULL, "uploaded_by_user_id" character varying NOT NULL, CONSTRAINT "PK_4265231e3deaba49e6f6630b6ef" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6c8eef5c3bc041ca563926102c" ON "declarant_files" ("declarant_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2152c5cf210cd9d60296a96b51" ON "declarant_files" ("object_key") `);
        await queryRunner.query(`ALTER TABLE "declarant_files" ADD CONSTRAINT "FK_6c8eef5c3bc041ca563926102cb" FOREIGN KEY ("declarant_id") REFERENCES "declarants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "declarant_files" DROP CONSTRAINT "FK_6c8eef5c3bc041ca563926102cb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2152c5cf210cd9d60296a96b51"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6c8eef5c3bc041ca563926102c"`);
        await queryRunner.query(`DROP TABLE "declarant_files"`);
    }

}
