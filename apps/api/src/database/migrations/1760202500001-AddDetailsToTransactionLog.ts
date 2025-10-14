import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDetailsToTransactionLog1760202500001 implements MigrationInterface {
    name = 'AddDetailsToTransactionLog1760202500001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TransactionLog" ADD "details" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "TransactionLog" DROP COLUMN "details"`);
    }

}
