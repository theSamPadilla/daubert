import { MigrationInterface, QueryRunner } from "typeorm";

export class DataRoomFileNotes1791747265802 implements MigrationInterface {
    name = 'DataRoomFileNotes1791747265802'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "data_room_file_notes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "case_id" uuid NOT NULL, "file_id" uuid NOT NULL, "notes" jsonb NOT NULL, "updated_by_user_id" uuid, "conversation_id" uuid, "model" character varying, CONSTRAINT "PK_74d4159bd570bc8dbf3e169942e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4480d5a7ebeb27491df9719a2a" ON "data_room_file_notes" ("case_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_77229d99b090d369fd34fef7a5" ON "data_room_file_notes" ("file_id") `);
        await queryRunner.query(`ALTER TABLE "data_room_file_notes" ADD CONSTRAINT "FK_4480d5a7ebeb27491df9719a2a1" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "data_room_file_notes" ADD CONSTRAINT "FK_77229d99b090d369fd34fef7a53" FOREIGN KEY ("file_id") REFERENCES "data_room_files"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "data_room_file_notes" ADD CONSTRAINT "FK_c88439331dad2f6562d8e44803b" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "data_room_file_notes" DROP CONSTRAINT "FK_c88439331dad2f6562d8e44803b"`);
        await queryRunner.query(`ALTER TABLE "data_room_file_notes" DROP CONSTRAINT "FK_77229d99b090d369fd34fef7a53"`);
        await queryRunner.query(`ALTER TABLE "data_room_file_notes" DROP CONSTRAINT "FK_4480d5a7ebeb27491df9719a2a1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_77229d99b090d369fd34fef7a5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4480d5a7ebeb27491df9719a2a"`);
        await queryRunner.query(`DROP TABLE "data_room_file_notes"`);
    }

}
