import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAddressClassifications1788385406000 implements MigrationInterface {
  name = 'AddAddressClassifications1788385406000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "address_classifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "chain" character varying NOT NULL, "address" character varying NOT NULL, "address_type" character varying NOT NULL, "token_standard" character varying, "symbol" character varying, "decimals" integer, "name" character varying, "probed_at" TIMESTAMP NOT NULL, CONSTRAINT "UQ_bc29d1e87c3c19e5a1246e18c5a" UNIQUE ("chain", "address"), CONSTRAINT "PK_b9c77bb7ffb2e75d01d06ce8143" PRIMARY KEY ("id"))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "address_classifications"`);
  }
}
