import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSourceToTokenPrice1760208000000 implements MigrationInterface {
    name = 'AddSourceToTokenPrice1760208000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add source column to TokenPrice table
        await queryRunner.query(`ALTER TABLE "TokenPrice" ADD COLUMN "source" TEXT`);

        // Set default source for existing records
        await queryRunner.query(`UPDATE "TokenPrice" SET "source" = 'dexscreener' WHERE "source" IS NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TokenPrice" DROP COLUMN "source"`);
    }
}