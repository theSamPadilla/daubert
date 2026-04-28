import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialMigration1777332721367 implements MigrationInterface {
    name = 'InitialMigration1777332721367'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "traces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "color" character varying, "visible" boolean NOT NULL DEFAULT true, "collapsed" boolean NOT NULL DEFAULT false, "data" jsonb NOT NULL DEFAULT '{}', "investigation_id" uuid NOT NULL, CONSTRAINT "PK_a28bd8d9b09a77802bb18fbc2f5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "script_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "code" text NOT NULL, "output" text, "status" character varying(20) NOT NULL DEFAULT 'success', "duration_ms" integer NOT NULL DEFAULT '0', "investigation_id" uuid NOT NULL, CONSTRAINT "PK_fd691ba9984fe891bcee039d2cb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "investigations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "notes" text, "case_id" uuid NOT NULL, CONSTRAINT "PK_2fffe8ebb1cf4b2fc03a26ac8d9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "productions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "type" character varying NOT NULL, "data" jsonb NOT NULL DEFAULT '{}'::jsonb, "case_id" uuid NOT NULL, CONSTRAINT "PK_395fda0b6f26cb5fd9a2aa6315c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "case_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "case_id" uuid NOT NULL, "role" character varying NOT NULL DEFAULT 'guest', CONSTRAINT "UQ_db3cfab6b5ecea4655df2dbe3ec" UNIQUE ("user_id", "case_id"), CONSTRAINT "PK_c79ced16ff537f907b80c1bea4c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "firebase_uid" character varying, "name" character varying NOT NULL, "email" character varying NOT NULL, "avatar_url" character varying, CONSTRAINT "UQ_0fd54ced5cc75f7cb92925dd803" UNIQUE ("firebase_uid"), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "cases" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "start_date" TIMESTAMP, "links" jsonb NOT NULL DEFAULT '[]', "user_id" uuid, CONSTRAINT "PK_264acb3048c240fb89aa34626db" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "conversation_id" uuid NOT NULL, "role" character varying NOT NULL, "content" jsonb NOT NULL, CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "conversations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "title" character varying, "case_id" uuid, CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "data_room_connections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "case_id" uuid NOT NULL, "provider" character varying NOT NULL DEFAULT 'google_drive', "credentials_cipher" bytea NOT NULL, "credentials_iv" bytea NOT NULL, "credentials_auth_tag" bytea NOT NULL, "folder_id" character varying, "folder_name" character varying, "status" character varying NOT NULL DEFAULT 'active', CONSTRAINT "UQ_73fbeaacbd24859d0e10bc7e98a" UNIQUE ("case_id"), CONSTRAINT "PK_03adf335288c9bf40da65e59af2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "labeled_entities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying NOT NULL, "category" character varying NOT NULL, "description" text, "wallets" jsonb NOT NULL DEFAULT '[]'::jsonb, "metadata" jsonb, CONSTRAINT "PK_d502652372e4f9feb2e8803635f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "traces" ADD CONSTRAINT "FK_c48c0bc731f600210158c180535" FOREIGN KEY ("investigation_id") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "script_runs" ADD CONSTRAINT "FK_ae9b125aac8618d7b78c2518521" FOREIGN KEY ("investigation_id") REFERENCES "investigations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "investigations" ADD CONSTRAINT "FK_8e54c681c3569a94eefd6c098ee" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "productions" ADD CONSTRAINT "FK_f276b7e145dbb79a547dfc8872b" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "case_members" ADD CONSTRAINT "FK_49aa234accd4cb17825dde3d332" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "case_members" ADD CONSTRAINT "FK_2f3796489448d86521a69e096df" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cases" ADD CONSTRAINT "FK_050257d1dfa826275982b85af92" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD CONSTRAINT "FK_3c2e3ecc83b0c05a3b27864337d" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "data_room_connections" ADD CONSTRAINT "FK_73fbeaacbd24859d0e10bc7e98a" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "data_room_connections" DROP CONSTRAINT "FK_73fbeaacbd24859d0e10bc7e98a"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP CONSTRAINT "FK_3c2e3ecc83b0c05a3b27864337d"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23"`);
        await queryRunner.query(`ALTER TABLE "cases" DROP CONSTRAINT "FK_050257d1dfa826275982b85af92"`);
        await queryRunner.query(`ALTER TABLE "case_members" DROP CONSTRAINT "FK_2f3796489448d86521a69e096df"`);
        await queryRunner.query(`ALTER TABLE "case_members" DROP CONSTRAINT "FK_49aa234accd4cb17825dde3d332"`);
        await queryRunner.query(`ALTER TABLE "productions" DROP CONSTRAINT "FK_f276b7e145dbb79a547dfc8872b"`);
        await queryRunner.query(`ALTER TABLE "investigations" DROP CONSTRAINT "FK_8e54c681c3569a94eefd6c098ee"`);
        await queryRunner.query(`ALTER TABLE "script_runs" DROP CONSTRAINT "FK_ae9b125aac8618d7b78c2518521"`);
        await queryRunner.query(`ALTER TABLE "traces" DROP CONSTRAINT "FK_c48c0bc731f600210158c180535"`);
        await queryRunner.query(`DROP TABLE "labeled_entities"`);
        await queryRunner.query(`DROP TABLE "data_room_connections"`);
        await queryRunner.query(`DROP TABLE "conversations"`);
        await queryRunner.query(`DROP TABLE "messages"`);
        await queryRunner.query(`DROP TABLE "cases"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TABLE "case_members"`);
        await queryRunner.query(`DROP TABLE "productions"`);
        await queryRunner.query(`DROP TABLE "investigations"`);
        await queryRunner.query(`DROP TABLE "script_runs"`);
        await queryRunner.query(`DROP TABLE "traces"`);
    }

}
