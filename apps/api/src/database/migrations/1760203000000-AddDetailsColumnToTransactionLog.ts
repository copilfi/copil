import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDetailsColumnToTransactionLog1760203000000 implements MigrationInterface {
    name = 'AddDetailsColumnToTransactionLog1760203000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TransactionLog" ADD COLUMN IF NOT EXISTS "details" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TransactionLog" DROP COLUMN "details"`);
    }

}
