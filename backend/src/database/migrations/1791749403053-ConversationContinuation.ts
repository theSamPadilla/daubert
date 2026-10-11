import { MigrationInterface, QueryRunner } from "typeorm";

export class ConversationContinuation1791749403053 implements MigrationInterface {
    name = 'ConversationContinuation1791749403053'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" ADD "context_tokens" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD "seed_summary" text`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD "continued_from_conversation_id" uuid`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD CONSTRAINT "FK_22155427849aa86caf32d9c00f1" FOREIGN KEY ("continued_from_conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" DROP CONSTRAINT "FK_22155427849aa86caf32d9c00f1"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "continued_from_conversation_id"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "seed_summary"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "context_tokens"`);
    }

}
