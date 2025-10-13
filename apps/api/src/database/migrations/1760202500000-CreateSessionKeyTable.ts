import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSessionKeyTable1760202500000 implements MigrationInterface {
    name = 'CreateSessionKeyTable1760202500000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "SessionKey" ("id" SERIAL NOT NULL, "userId" integer NOT NULL, "publicKey" text NOT NULL, "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb, "expiresAt" TIMESTAMP WITH TIME ZONE, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_0d8b45f3f1d96e3dcff7f9eb965" UNIQUE ("publicKey"), CONSTRAINT "PK_69fe911828403c69e03c515aea0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "SessionKey" ADD CONSTRAINT "FK_6a6d6150653d350a0c5c52599bd" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "SessionKey" DROP CONSTRAINT "FK_6a6d6150653d350a0c5c52599bd"`);
        await queryRunner.query(`DROP TABLE "SessionKey"`);
    }

}
