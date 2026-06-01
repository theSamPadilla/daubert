import { MigrationInterface, QueryRunner } from "typeorm";

export class DropStartDateAddSummary1780335059803 implements MigrationInterface {
    name = 'DropStartDateAddSummary1780335059803'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "cases" DROP COLUMN "start_date"`);
        await queryRunner.query(`ALTER TABLE "cases" ADD "summary" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "cases" DROP COLUMN "summary"`);
        await queryRunner.query(`ALTER TABLE "cases" ADD "start_date" TIMESTAMP`);
    }

}
