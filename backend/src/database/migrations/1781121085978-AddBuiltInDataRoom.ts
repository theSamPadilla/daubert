import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBuiltInDataRoom1781121085978 implements MigrationInterface {
    name = 'AddBuiltInDataRoom1781121085978'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "data_room_access_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "case_id" character varying NOT NULL, "file_id" character varying, "user_id" character varying NOT NULL, "action" character varying NOT NULL, CONSTRAINT "PK_7fca7f7497fa94428cb58f7b368" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_29507e72a2a81f8e52d437c879" ON "data_room_access_log" ("case_id") `);
        await queryRunner.query(`CREATE TABLE "data_room_files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "case_id" character varying NOT NULL, "name" character varying NOT NULL, "mime_type" character varying NOT NULL, "size" bigint NOT NULL, "object_key" character varying NOT NULL, "uploaded_by_user_id" character varying NOT NULL, CONSTRAINT "PK_189ad000bc8b076ff95ba88fea3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1a7a5f7b3b0def46db1da78d12" ON "data_room_files" ("case_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_70e0103bd3b8e779001967ff33" ON "data_room_files" ("object_key") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_70e0103bd3b8e779001967ff33"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1a7a5f7b3b0def46db1da78d12"`);
        await queryRunner.query(`DROP TABLE "data_room_files"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_29507e72a2a81f8e52d437c879"`);
        await queryRunner.query(`DROP TABLE "data_room_access_log"`);
    }

}
