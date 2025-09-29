-- CreateTable
CREATE TABLE "indexed_contracts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "last_indexed_block" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexed_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blockchain_events" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "block_number" INTEGER NOT NULL,
    "transaction_hash" TEXT NOT NULL,
    "log_index" INTEGER NOT NULL,
    "block_hash" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "blockchain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_cursors" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "block_number" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "indexed_contracts_address_key" ON "indexed_contracts"("address");

-- CreateIndex
CREATE INDEX "idx_blockchain_events_block" ON "blockchain_events"("block_number");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_events_transaction_hash_log_index_key" ON "blockchain_events"("transaction_hash", "log_index");

-- CreateIndex
CREATE UNIQUE INDEX "event_cursors_key_key" ON "event_cursors"("key");

-- AddForeignKey
ALTER TABLE "blockchain_events" ADD CONSTRAINT "blockchain_events_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "indexed_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

