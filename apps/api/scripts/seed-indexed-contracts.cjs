const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

(async () => {
  const prisma = new PrismaClient();
  try {
    const chainId = Number(process.env.SEI_CHAIN_ID || process.env.SEI_MAINNET_CHAIN_ID || process.env.SEI_TESTNET_CHAIN_ID || 1329);

    const contracts = [
      {
        key: 'account-factory',
        name: 'AccountFactory',
        address: process.env.ACCOUNT_FACTORY_ADDRESS || process.env.SEI_MAINNET_ACCOUNT_FACTORY_ADDRESS,
        abiHash: 'account-factory'
      },
      {
        key: 'conditional-order-engine',
        name: 'ConditionalOrderEngine',
        address: process.env.CONDITIONAL_ORDER_ENGINE_ADDRESS || process.env.SEI_MAINNET_CONDITIONAL_ENGINE_ADDRESS,
        abiHash: 'conditional-order-engine'
      }
    ].filter(item => item.address);

    if (!contracts.length) {
      console.log('No contract addresses configured; nothing to seed.');
      process.exit(0);
    }

    const latestBlock = Number(process.env.EVENT_INDEX_SEED_BLOCK || 0);

    for (const contract of contracts) {
      const address = contract.address.toLowerCase();
      const record = await prisma.indexedContract.upsert({
        where: { address },
        update: {
          name: contract.name,
          chainId,
          isActive: true,
          metadata: {
            key: contract.key,
            abiHash: contract.abiHash
          }
        },
        create: {
          name: contract.name,
          address,
          chainId,
          lastIndexedBlock: latestBlock,
          metadata: {
            key: contract.key,
            abiHash: contract.abiHash
          }
        }
      });
      console.log(`Indexed contract ready: ${record.name} (${record.address})`);
    }
  } catch (error) {
    console.error('Failed to seed indexed contracts:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
