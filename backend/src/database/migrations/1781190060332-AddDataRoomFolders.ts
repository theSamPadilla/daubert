import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDataRoomFolders1781190060332 implements MigrationInterface {
    name = 'AddDataRoomFolders1781190060332'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "data_room_folders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "case_id" character varying NOT NULL, "parent_folder_id" character varying, "name" character varying NOT NULL, "created_by_user_id" character varying NOT NULL, CONSTRAINT "PK_ad4693caa033d63aab85070981c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b1190e3e5731004b05eb93567c" ON "data_room_folders" ("case_id", "parent_folder_id") `);
        await queryRunner.query(`ALTER TABLE "data_room_files" ADD "folder_id" character varying`);
        await queryRunner.query(`CREATE INDEX "IDX_d19813b567f50fe327ff47305a" ON "data_room_files" ("folder_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_d19813b567f50fe327ff47305a"`);
        await queryRunner.query(`ALTER TABLE "data_room_files" DROP COLUMN "folder_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b1190e3e5731004b05eb93567c"`);
        await queryRunner.query(`DROP TABLE "data_room_folders"`);
    }

}
