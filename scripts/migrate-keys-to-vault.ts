#!/usr/bin/env node
/**
 * Migration Script: Environment Variables → HashiCorp Vault
 *
 * This script migrates session keys from environment variables to HashiCorp Vault.
 *
 * Prerequisites:
 * 1. Vault server running and unsealed
 * 2. VAULT_URL and VAULT_TOKEN environment variables set
 * 3. KV v2 secrets engine enabled at 'secret' path
 *
 * Usage:
 *   export VAULT_URL='http://localhost:8200'
 *   export VAULT_TOKEN='your-vault-token'
 *   npx tsx scripts/migrate-keys-to-vault.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

// Load environment variables from .env files
config({ path: resolve(__dirname, '../apps/api/.env') });
config({ path: resolve(__dirname, '../apps/transaction-executor/.env') });

const VAULT_URL = process.env.VAULT_URL;
const VAULT_TOKEN = process.env.VAULT_TOKEN;
const VAULT_MOUNT_PATH = process.env.VAULT_MOUNT_PATH || 'secret';
const DRY_RUN = process.env.DRY_RUN === 'true';

interface MigrationStats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  keys: Array<{ id: number; type: string; status: string; error?: string }>;
}

const stats: MigrationStats = {
  total: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  keys: [],
};

async function testVaultConnection(): Promise<boolean> {
  try {
    console.log(`🔍 Testing Vault connection to ${VAULT_URL}...`);

    const response = await fetch(`${VAULT_URL}/v1/sys/health`, {
      method: 'GET',
    });

    if (response.ok || response.status === 429 || response.status === 501) {
      // 429 = standby, 501 = unsealed
      console.log('✅ Vault connection successful');
      return true;
    } else {
      console.error(`❌ Vault health check failed: ${response.status} ${response.statusText}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Failed to connect to Vault: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}

async function checkKeyExists(keyPath: string): Promise<boolean> {
  try {
    const vaultPath = `${VAULT_MOUNT_PATH}/data/${keyPath}`;
    const response = await fetch(`${VAULT_URL}/v1/${vaultPath}`, {
      method: 'GET',
      headers: {
        'X-Vault-Token': VAULT_TOKEN!,
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function migrateKey(
  keyId: number,
  privateKey: string,
  chainType: 'evm' | 'solana',
  format: 'hex' | 'bytes' | 'b58',
): Promise<void> {
  stats.total++;

  const keyPath = format === 'hex' ? `session-key-${keyId}` : `session-key-${keyId}-${format}`;

  // Check if key already exists
  const exists = await checkKeyExists(keyPath);
  if (exists && !DRY_RUN) {
    console.log(`⏭️  Key ${keyPath} already exists in Vault, skipping`);
    stats.skipped++;
    stats.keys.push({ id: keyId, type: `${chainType}-${format}`, status: 'skipped' });
    return;
  }

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would migrate ${chainType} session key ${keyId} (${format})`);
    stats.success++;
    stats.keys.push({ id: keyId, type: `${chainType}-${format}`, status: 'dry-run' });
    return;
  }

  try {
    const vaultPath = `${VAULT_MOUNT_PATH}/data/${keyPath}`;

    const response = await fetch(`${VAULT_URL}/v1/${vaultPath}`, {
      method: 'POST',
      headers: {
        'X-Vault-Token': VAULT_TOKEN!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          privateKey,
          createdAt: new Date().toISOString(),
          chainType,
          format,
          migratedFrom: 'environment-variables',
          migrationDate: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`✅ Migrated ${chainType} session key ${keyId} (${format}) to Vault`);
    stats.success++;
    stats.keys.push({ id: keyId, type: `${chainType}-${format}`, status: 'success' });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Failed to migrate key ${keyId} (${format}): ${errorMsg}`);
    stats.failed++;
    stats.keys.push({ id: keyId, type: `${chainType}-${format}`, status: 'failed', error: errorMsg });
  }
}

async function discoverAndMigrateKeys(): Promise<void> {
  console.log('\n🔍 Discovering session keys from environment variables...\n');

  // Check for generic fallback key
  const fallbackKey = process.env.SESSION_KEY_PRIVATE_KEY;
  if (fallbackKey) {
    console.log('⚠️  Found generic SESSION_KEY_PRIVATE_KEY fallback');
    console.log('    This key will NOT be migrated. Please use specific session key IDs.\n');
  }

  // EVM keys (SESSION_KEY_N_PRIVATE_KEY)
  console.log('🔎 Searching for EVM session keys...');
  for (let i = 1; i <= 100; i++) {
    const key = process.env[`SESSION_KEY_${i}_PRIVATE_KEY`];
    if (key) {
      console.log(`   Found EVM key: SESSION_KEY_${i}_PRIVATE_KEY`);
      await migrateKey(i, key, 'evm', 'hex');
    }
  }

  // Solana keys - Bytes format (SESSION_KEY_N_PRIVATE_KEY_BYTES)
  console.log('\n🔎 Searching for Solana session keys (bytes format)...');
  for (let i = 1; i <= 100; i++) {
    const keyBytes = process.env[`SESSION_KEY_${i}_PRIVATE_KEY_BYTES`];
    if (keyBytes) {
      try {
        // Validate JSON format
        JSON.parse(keyBytes);
        console.log(`   Found Solana key (bytes): SESSION_KEY_${i}_PRIVATE_KEY_BYTES`);
        await migrateKey(i, keyBytes, 'solana', 'bytes');
      } catch {
        console.error(`   ❌ Invalid JSON in SESSION_KEY_${i}_PRIVATE_KEY_BYTES, skipping`);
        stats.failed++;
      }
    }
  }

  // Solana keys - Base58 format (SESSION_KEY_N_PRIVATE_KEY_B58)
  console.log('\n🔎 Searching for Solana session keys (Base58 format)...');
  for (let i = 1; i <= 100; i++) {
    const keyB58 = process.env[`SESSION_KEY_${i}_PRIVATE_KEY_B58`];
    if (keyB58) {
      console.log(`   Found Solana key (Base58): SESSION_KEY_${i}_PRIVATE_KEY_B58`);
      await migrateKey(i, keyB58, 'solana', 'b58');
    }
  }
}

async function verifyMigration(): Promise<void> {
  console.log('\n🔍 Verifying migrated keys...\n');

  for (const key of stats.keys) {
    if (key.status === 'success') {
      const keyPath = key.type.includes('evm') ? `session-key-${key.id}` : `session-key-${key.id}-${key.type.split('-')[1]}`;
      const exists = await checkKeyExists(keyPath);

      if (exists) {
        console.log(`✅ Verified: ${keyPath} exists in Vault`);
      } else {
        console.error(`❌ Verification failed: ${keyPath} not found in Vault`);
      }
    }
  }
}

function printSummary(): void {
  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total keys processed: ${stats.total}`);
  console.log(`✅ Successful:        ${stats.success}`);
  console.log(`⏭️  Skipped:           ${stats.skipped} (already in Vault)`);
  console.log(`❌ Failed:            ${stats.failed}`);
  console.log('='.repeat(60));

  if (stats.failed > 0) {
    console.log('\n❌ FAILED MIGRATIONS:');
    stats.keys
      .filter((k) => k.status === 'failed')
      .forEach((k) => {
        console.log(`   - Session key ${k.id} (${k.type}): ${k.error}`);
      });
  }

  if (DRY_RUN) {
    console.log('\n⚠️  This was a DRY RUN. No keys were actually migrated.');
    console.log('   Run without DRY_RUN=true to perform the migration.\n');
  } else if (stats.success > 0) {
    console.log('\n✅ NEXT STEPS:');
    console.log('   1. Verify the migrated keys in Vault:');
    console.log('      vault kv list secret/');
    console.log('   2. Update your .env files to enable Vault:');
    console.log('      VAULT_ENABLED=true');
    console.log('   3. Remove SESSION_KEY_*_PRIVATE_KEY from .env files');
    console.log('   4. Test your application with Vault integration');
    console.log('   5. Once verified, securely delete .env backups\n');
  }
}

function printNextSteps(): void {
  console.log('\n📋 RECOMMENDED NEXT STEPS:\n');
  console.log('1. Review migrated keys:');
  console.log('   vault kv list secret/');
  console.log('   vault kv get secret/session-key-1\n');
  console.log('2. Update .env configuration:');
  console.log('   VAULT_ENABLED=true');
  console.log('   VAULT_URL=http://localhost:8200');
  console.log('   VAULT_TOKEN=your-vault-token\n');
  console.log('3. Remove old environment variables:');
  console.log('   sed -i \'/SESSION_KEY_.*_PRIVATE_KEY/d\' apps/api/.env\n');
  console.log('4. Test the application:');
  console.log('   npm run start:dev\n');
  console.log('5. Monitor logs for Vault connection:');
  console.log('   Look for: ✅ HashiCorp Vault integration enabled\n');
}

async function main() {
  console.log('🔐 SESSION KEY MIGRATION TO HASHICORP VAULT');
  console.log('='.repeat(60));

  // Validate environment
  if (!VAULT_URL) {
    console.error('❌ VAULT_URL environment variable not set');
    console.error('   export VAULT_URL=http://localhost:8200');
    process.exit(1);
  }

  if (!VAULT_TOKEN) {
    console.error('❌ VAULT_TOKEN environment variable not set');
    console.error('   export VAULT_TOKEN=your-vault-token');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No keys will be modified');
  }

  console.log(`\nVault URL: ${VAULT_URL}`);
  console.log(`Mount Path: ${VAULT_MOUNT_PATH}\n`);

  // Test Vault connection
  const connected = await testVaultConnection();
  if (!connected) {
    console.error('\n❌ Cannot connect to Vault. Please check:');
    console.error('   1. Vault server is running');
    console.error('   2. VAULT_URL is correct');
    console.error('   3. Vault is unsealed');
    process.exit(1);
  }

  // Discover and migrate keys
  await discoverAndMigrateKeys();

  // Verify migration
  if (!DRY_RUN && stats.success > 0) {
    await verifyMigration();
  }

  // Print summary
  printSummary();

  // Print next steps
  if (stats.success > 0 && !DRY_RUN) {
    printNextSteps();
  }

  // Exit with error if any migrations failed
  if (stats.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n❌ Migration failed:', error);
  process.exit(1);
});
