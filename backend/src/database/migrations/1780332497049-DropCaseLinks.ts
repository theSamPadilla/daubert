import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropCaseLinks1780332497049 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE cases DROP COLUMN links`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE cases ADD COLUMN links jsonb NOT NULL DEFAULT '[]'`);
  }
}
