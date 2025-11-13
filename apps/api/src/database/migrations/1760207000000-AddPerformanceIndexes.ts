import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPerformanceIndexes1760207000000 implements MigrationInterface {
    name = 'AddPerformanceIndexes1760207000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // TransactionLog indexes for frequent queries
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_transactionlog_userid" ON "TransactionLog" ("userId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_transactionlog_userid_createdat" ON "TransactionLog" ("userId", "createdAt" DESC)`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_transactionlog_strategyid" ON "TransactionLog" ("strategyId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_transactionlog_status" ON "TransactionLog" ("status")`);

        // SessionKey indexes
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sessionkey_userid" ON "SessionKey" ("userId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sessionkey_userid_isactive" ON "SessionKey" ("userId", "isActive")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sessionkey_publickey" ON "SessionKey" ("publicKey")`);

        // Strategy indexes
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_strategy_userid" ON "Strategy" ("userId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_strategy_userid_isactive" ON "Strategy" ("userId", "isActive")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_strategy_schedule" ON "Strategy" ("schedule")`);

        // Wallet indexes
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_wallet_userid" ON "Wallet" ("userId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_wallet_userid_chain" ON "Wallet" ("userId", "chain")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_wallet_address" ON "Wallet" ("address")`);

        // TokenPrice indexes for trending queries
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tokenprice_chain_address" ON "TokenPrice" ("chain", "address")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tokenprice_chain_address_timestamp" ON "TokenPrice" ("chain", "address", "timestamp" DESC)`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tokenprice_timestamp" ON "TokenPrice" ("timestamp" DESC)`);

        // TokenSentiment indexes
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tokensentiment_chain_symbol" ON "TokenSentiment" ("chain", "symbol")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tokensentiment_timestamp" ON "TokenSentiment" ("timestamp" DESC)`);

        // TokenMetadata indexes
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tokenmetadata_chain_address" ON "TokenMetadata" ("chain", "address")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tokenmetadata_symbol" ON "TokenMetadata" ("symbol")`);

        // ChatMemory index
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_chatmemory_userid" ON "ChatMemory" ("userId")`);

        // ChatEmbedding indexes for semantic search
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_chatembedding_userid" ON "ChatEmbedding" ("userId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_chatembedding_userid_createdat" ON "ChatEmbedding" ("userId", "createdAt" DESC)`);

        // Create pgvector extension if not exists (for future vector similarity search)
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop all indexes in reverse order
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chatembedding_userid_createdat"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chatembedding_userid"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chatmemory_userid"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tokenmetadata_symbol"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tokenmetadata_chain_address"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tokensentiment_timestamp"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tokensentiment_chain_symbol"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tokenprice_timestamp"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tokenprice_chain_address_timestamp"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tokenprice_chain_address"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallet_address"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallet_userid_chain"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallet_userid"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_strategy_schedule"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_strategy_userid_isactive"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_strategy_userid"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sessionkey_publickey"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sessionkey_userid_isactive"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_sessionkey_userid"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transactionlog_status"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transactionlog_strategyid"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transactionlog_userid_createdat"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_transactionlog_userid"`);
    }
}