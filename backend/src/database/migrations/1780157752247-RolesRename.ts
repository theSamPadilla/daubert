import { MigrationInterface, QueryRunner } from 'typeorm';

export class RolesRename1780157752247 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE case_members SET role = 'viewer' WHERE role = 'guest'`);
    await queryRunner.query(`ALTER TABLE case_members ALTER COLUMN role SET DEFAULT 'viewer'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE case_members ALTER COLUMN role SET DEFAULT 'guest'`);
    await queryRunner.query(`UPDATE case_members SET role = 'guest' WHERE role = 'viewer'`);
  }
}
