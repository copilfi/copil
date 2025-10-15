import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSmartAccountAddressToWallet1760202500002 implements MigrationInterface {
    name = 'AddSmartAccountAddressToWallet1760202500002'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Wallet" ADD "smartAccountAddress" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Wallet" DROP COLUMN "smartAccountAddress"`);
    }

}
