import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTokenPriceTable1760201195343 implements MigrationInterface {
    name = 'CreateTokenPriceTable1760201195343'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "TokenPrice" ("id" SERIAL NOT NULL, "chain" text NOT NULL, "address" text NOT NULL, "symbol" text NOT NULL, "priceUsd" numeric(18,8) NOT NULL, "timestamp" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0143e9bf195a32fdd799cd1b905" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_29e2a07a6d28f2749a38650946" ON "TokenPrice" ("chain", "address") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_29e2a07a6d28f2749a38650946"`);
        await queryRunner.query(`DROP TABLE "TokenPrice"`);
    }

}
