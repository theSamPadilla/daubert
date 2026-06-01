import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCaseInvites1780160966596 implements MigrationInterface {
    name = 'CreateCaseInvites1780160966596'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "case_invites" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "case_id" uuid NOT NULL, "email" character varying NOT NULL, "role" character varying NOT NULL, "code" character varying NOT NULL, "message" text, "created_by_user_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "used_by_user_id" uuid, CONSTRAINT "PK_58fcb03092c0a609943c936605f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_bffdf1840b31fe16b9aa97e040" ON "case_invites" ("email") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_14e716390ec20cc9f6ea01797f" ON "case_invites" ("code") `);
        await queryRunner.query(`ALTER TABLE "case_invites" ADD CONSTRAINT "FK_7424e2e8cbcaab8101d2d3222d1" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "case_invites" ADD CONSTRAINT "FK_6edd51efe6bc2fbb0927f5777c1" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "case_invites" ADD CONSTRAINT "FK_e4b2afadbba06681a8cbb879316" FOREIGN KEY ("used_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "case_invites" DROP CONSTRAINT "FK_e4b2afadbba06681a8cbb879316"`);
        await queryRunner.query(`ALTER TABLE "case_invites" DROP CONSTRAINT "FK_6edd51efe6bc2fbb0927f5777c1"`);
        await queryRunner.query(`ALTER TABLE "case_invites" DROP CONSTRAINT "FK_7424e2e8cbcaab8101d2d3222d1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_14e716390ec20cc9f6ea01797f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bffdf1840b31fe16b9aa97e040"`);
        await queryRunner.query(`DROP TABLE "case_invites"`);
    }

}
