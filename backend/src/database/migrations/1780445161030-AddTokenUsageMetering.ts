import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTokenUsageMetering1780445161030 implements MigrationInterface {
    name = 'AddTokenUsageMetering1780445161030'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "monthly_usage" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "user_id" uuid NOT NULL, "period" character(7) NOT NULL, "model" character varying(128) NOT NULL, "call_count" bigint NOT NULL DEFAULT '0', "input_tokens" bigint NOT NULL DEFAULT '0', "output_tokens" bigint NOT NULL DEFAULT '0', "cache_read_input_tokens" bigint NOT NULL DEFAULT '0', "cache_creation_5m_input_tokens" bigint NOT NULL DEFAULT '0', "cache_creation_1h_input_tokens" bigint NOT NULL DEFAULT '0', CONSTRAINT "UQ_ce2212a32c23e1173a201c7770c" UNIQUE ("org_id", "user_id", "period", "model"), CONSTRAINT "PK_d72075463bbc930781c792be6e6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "token_usage" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "org_id" uuid, "user_id" uuid, "case_id" uuid, "conversation_id" uuid, "message_id" uuid, "surface" character varying(32) NOT NULL, "model" character varying(128) NOT NULL, "input_tokens" integer NOT NULL DEFAULT '0', "output_tokens" integer NOT NULL DEFAULT '0', "cache_read_input_tokens" integer NOT NULL DEFAULT '0', "cache_creation_5m_input_tokens" integer NOT NULL DEFAULT '0', "cache_creation_1h_input_tokens" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_b85b17103d77d9695632654729d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8daed096774812ce4a7bfa6757" ON "token_usage" ("conversation_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_daa8c08a8596492cc842586b76" ON "token_usage" ("case_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_9d87af3986f52a77b8ec177f84" ON "token_usage" ("user_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_dc0da74f3c196c36652c20ece0" ON "token_usage" ("org_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "monthly_usage" ADD CONSTRAINT "FK_96770f11e6a1c0df27dc35ecbd9" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "monthly_usage" ADD CONSTRAINT "FK_505cd340e59c8cc029f8980e6e1" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "token_usage" ADD CONSTRAINT "FK_3ff4d306be32c00eb50048c4e5c" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "token_usage" ADD CONSTRAINT "FK_f3e27270e575ec838d6039f6c5a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "token_usage" ADD CONSTRAINT "FK_adb35857fe7fe439de20637c248" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "token_usage" ADD CONSTRAINT "FK_8daed096774812ce4a7bfa67572" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "token_usage" ADD CONSTRAINT "FK_8094c0282d7ff3e20bda8d6b1bc" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "token_usage" DROP CONSTRAINT "FK_8094c0282d7ff3e20bda8d6b1bc"`);
        await queryRunner.query(`ALTER TABLE "token_usage" DROP CONSTRAINT "FK_8daed096774812ce4a7bfa67572"`);
        await queryRunner.query(`ALTER TABLE "token_usage" DROP CONSTRAINT "FK_adb35857fe7fe439de20637c248"`);
        await queryRunner.query(`ALTER TABLE "token_usage" DROP CONSTRAINT "FK_f3e27270e575ec838d6039f6c5a"`);
        await queryRunner.query(`ALTER TABLE "token_usage" DROP CONSTRAINT "FK_3ff4d306be32c00eb50048c4e5c"`);
        await queryRunner.query(`ALTER TABLE "monthly_usage" DROP CONSTRAINT "FK_505cd340e59c8cc029f8980e6e1"`);
        await queryRunner.query(`ALTER TABLE "monthly_usage" DROP CONSTRAINT "FK_96770f11e6a1c0df27dc35ecbd9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dc0da74f3c196c36652c20ece0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9d87af3986f52a77b8ec177f84"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_daa8c08a8596492cc842586b76"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8daed096774812ce4a7bfa6757"`);
        await queryRunner.query(`DROP TABLE "token_usage"`);
        await queryRunner.query(`DROP TABLE "monthly_usage"`);
    }

}
