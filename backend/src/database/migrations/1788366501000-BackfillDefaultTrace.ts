import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillDefaultTrace1788366501000 implements MigrationInterface {
  name = 'BackfillDefaultTrace1788366501000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "traces" ("id", "name", "color", "visible", "collapsed", "data", "investigation_id", "created_at", "updated_at")
      SELECT gen_random_uuid(), 'Trace 1', '#3b82f6', true, false, '{"nodes": [], "edges": []}'::jsonb, i."id", NOW(), NOW()
      FROM "investigations" i
      WHERE NOT EXISTS (SELECT 1 FROM "traces" t WHERE t."investigation_id" = i."id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "traces" t
      WHERE t."name" = 'Trace 1'
        AND t."data" = '{"nodes": [], "edges": []}'::jsonb
        AND NOT EXISTS (SELECT 1 FROM "traces" o WHERE o."investigation_id" = t."investigation_id" AND o."id" <> t."id")
    `);
  }
}
