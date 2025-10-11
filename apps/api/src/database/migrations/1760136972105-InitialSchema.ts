import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1760136972105 implements MigrationInterface {
    name = 'InitialSchema1760136972105'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "Strategy" ("id" SERIAL NOT NULL, "userId" integer NOT NULL, "name" text NOT NULL, "definition" jsonb NOT NULL, "schedule" text, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fa5ff7d5796ef61db2fd233ae77" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "TransactionLog" ("id" SERIAL NOT NULL, "userId" integer NOT NULL, "strategyId" integer, "description" text NOT NULL, "txHash" text, "chain" text, "status" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a1ecdfbc517e8a673348bc7095c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "User" ("id" SERIAL NOT NULL, "email" text NOT NULL, "privyDid" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_4a257d2c9837248d70640b3e36e" UNIQUE ("email"), CONSTRAINT "UQ_9678112cf4caa8e50b24d3d6af8" UNIQUE ("privyDid"), CONSTRAINT "PK_9862f679340fb2388436a5ab3e4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "Wallet" ("id" SERIAL NOT NULL, "userId" integer NOT NULL, "address" text NOT NULL, "chain" text NOT NULL, CONSTRAINT "UQ_1f89b98b1c4f7dc23208d7f50c3" UNIQUE ("userId", "chain"), CONSTRAINT "PK_8828fa4047435abf9287ff0e89e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "Strategy" ADD CONSTRAINT "FK_b080454e147747aa1f11b5f35e5" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TransactionLog" ADD CONSTRAINT "FK_db63ff6559742321b44093c9d54" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "TransactionLog" ADD CONSTRAINT "FK_dc7ddfb3494f3900cf03c43e8d0" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "Wallet" ADD CONSTRAINT "FK_2f7aa51d6746fc8fc8ed63ddfbc" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "Wallet" DROP CONSTRAINT "FK_2f7aa51d6746fc8fc8ed63ddfbc"`);
        await queryRunner.query(`ALTER TABLE "TransactionLog" DROP CONSTRAINT "FK_dc7ddfb3494f3900cf03c43e8d0"`);
        await queryRunner.query(`ALTER TABLE "TransactionLog" DROP CONSTRAINT "FK_db63ff6559742321b44093c9d54"`);
        await queryRunner.query(`ALTER TABLE "Strategy" DROP CONSTRAINT "FK_b080454e147747aa1f11b5f35e5"`);
        await queryRunner.query(`DROP TABLE "Wallet"`);
        await queryRunner.query(`DROP TABLE "User"`);
        await queryRunner.query(`DROP TABLE "TransactionLog"`);
        await queryRunner.query(`DROP TABLE "Strategy"`);
    }

}
