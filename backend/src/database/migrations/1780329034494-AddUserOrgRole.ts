import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserOrgRole1780329034494 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN org_role varchar NOT NULL DEFAULT 'guest'`);
    await queryRunner.query(`UPDATE users SET org_role = 'admin' WHERE email LIKE '%@incite.ventures'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN org_role`);
  }
}
