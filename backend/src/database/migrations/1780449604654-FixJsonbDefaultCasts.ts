import { MigrationInterface, QueryRunner } from "typeorm";

export class FixJsonbDefaultCasts1780449604654 implements MigrationInterface {
    name = 'FixJsonbDefaultCasts1780449604654'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "productions" ALTER COLUMN "data" SET DEFAULT '{}'::jsonb`);
        await queryRunner.query(`ALTER TABLE "labeled_entities" ALTER COLUMN "wallets" SET DEFAULT '[]'::jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "labeled_entities" ALTER COLUMN "wallets" SET DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "productions" ALTER COLUMN "data" SET DEFAULT '{}'`);
    }

}
