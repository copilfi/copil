import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateChatMemoryTable1760205000000 implements MigrationInterface {
    name = 'CreateChatMemoryTable1760205000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "ChatMemory" (
          "id" SERIAL PRIMARY KEY,
          "userId" integer NOT NULL UNIQUE,
          "summary" text NOT NULL,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "FK_chatmemory_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        )`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "ChatMemory"`);
    }
}

