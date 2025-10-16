import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTokenMetadataTable1760204000000 implements MigrationInterface {
    name = 'CreateTokenMetadataTable1760204000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "TokenMetadata" ("id" SERIAL NOT NULL, "chain" text NOT NULL, "address" text NOT NULL, "symbol" text, "decimals" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1c221720b8100f9868124633e6a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_token_metadata_chain_address" ON "TokenMetadata" ("chain", "address")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_token_metadata_chain_address"`);
        await queryRunner.query(`DROP TABLE "TokenMetadata"`);
    }
}

