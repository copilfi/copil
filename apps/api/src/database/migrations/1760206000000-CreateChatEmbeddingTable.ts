import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateChatEmbeddingTable1760206000000 implements MigrationInterface {
    name = 'CreateChatEmbeddingTable1760206000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "ChatEmbedding" (
          "id" SERIAL PRIMARY KEY,
          "userId" integer NOT NULL,
          "content" text NOT NULL,
          "embedding" jsonb NOT NULL,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "FK_chatembedding_user" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        )`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "ChatEmbedding"`);
    }
}

