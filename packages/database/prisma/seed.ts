import { PrismaClient } from '@prisma/client';
import { TOKENS, DEXES } from '@copil/core';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Seed DEX configurations
  console.log('📊 Seeding DEX configurations...');
  for (const [key, dex] of Object.entries(DEXES)) {
    await prisma.dEXStatus.upsert({
      where: { id: key },
      update: {
        displayName: dex.displayName,
        isActive: dex.isActive,
        routerAddress: dex.routerAddress,
        factoryAddress: dex.factoryAddress,
        fees: dex.fees,
      },
      create: {
        id: key,
        name: dex.name,
        displayName: dex.displayName,
        isActive: dex.isActive,
        routerAddress: dex.routerAddress,
        factoryAddress: dex.factoryAddress,
        fees: dex.fees,
      },
    });
  }

  // Seed token registry
  console.log('🪙 Seeding token registry...');
  for (const [symbol, token] of Object.entries(TOKENS)) {
    await prisma.tokenRegistry.upsert({
      where: { address: token.address },
      update: {
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        logoURI: token.logoURI,
        coingeckoId: token.coingeckoId,
        isVerified: true, // Mark default tokens as verified
      },
      create: {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        logoURI: token.logoURI,
        coingeckoId: token.coingeckoId,
        isVerified: true,
      },
    });
  }

  // Seed system configuration
  console.log('⚙️ Seeding system configuration...');
  const systemConfigs = [
    { key: 'DEFAULT_SLIPPAGE', value: '0.5' },
    { key: 'MAX_SLIPPAGE', value: '30' },
    { key: 'MIN_SLIPPAGE', value: '0.01' },
    { key: 'MAX_GAS_PRICE', value: '50' },
    { key: 'TRANSACTION_TIMEOUT', value: '1800' }, // 30 minutes in seconds
    { key: 'STRATEGY_CLEANUP_INTERVAL', value: '3600' }, // 1 hour in seconds
    { key: 'PRICE_UPDATE_INTERVAL', value: '60' }, // 1 minute in seconds
    { key: 'MAINTENANCE_MODE', value: 'false' },
    { key: 'MAX_ACTIVE_STRATEGIES_FREE', value: '3' },
    { key: 'MAX_ACTIVE_STRATEGIES_PRO', value: '10' },
    { key: 'MAX_ACTIVE_STRATEGIES_PREMIUM', value: '50' },
    { key: 'MAX_ACTIVE_STRATEGIES_ENTERPRISE', value: '200' },
    { key: 'AI_REQUESTS_PER_DAY_FREE', value: '50' },
    { key: 'AI_REQUESTS_PER_DAY_PRO', value: '500' },
    { key: 'AI_REQUESTS_PER_DAY_PREMIUM', value: '2000' },
    { key: 'AI_REQUESTS_PER_DAY_ENTERPRISE', value: '10000' },
  ];

  for (const config of systemConfigs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: { value: config.value },
      create: config,
    });
  }

  // Create demo user for testing (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log('👤 Creating demo user...');
    const demoUser = await prisma.user.upsert({
      where: { walletAddress: '0x742d35Cc6676C4C7B0c4D0D3Db4A4c8D5A4c8D5A' },
      update: {},
      create: {
        walletAddress: '0x742d35Cc6676C4C7B0c4D0D3Db4A4c8D5A4c8D5A',
        smartAccountAddress: '0x123456789012345678901234567890123456789A',
        email: 'demo@copil.app',
        username: 'demo_user',
        preferences: {
          defaultSlippage: 0.5,
          maxGasPrice: 20,
          notifications: {
            email: true,
            sms: false,
            push: true,
            strategies: {
              executed: true,
              failed: true,
              triggered: true,
            },
            portfolio: {
              dailySummary: true,
              largeMovements: true,
              rebalanceAlerts: true,
            },
            market: {
              priceAlerts: true,
              opportunities: true,
              riskAlerts: true,
            },
          },
          trading: {
            autoApproveSmallTrades: false,
            smallTradeThreshold: 100,
            requireConfirmationFor: {
              largeOrders: true,
              newStrategies: true,
              highRiskTrades: true,
            },
            defaultTimeouts: {
              swapDeadline: 20,
              strategyExpiration: 24,
            },
            riskManagement: {
              maxPositionSize: 25,
              maxDailyLoss: 5,
              stopLossDefault: 10,
            },
          },
          ui: {
            theme: 'dark',
            language: 'en',
            currency: 'USD',
            chartType: 'candlestick',
            defaultTimeframe: '1d',
            showAdvancedFeatures: true,
          },
        },
      },
    });

    // Create demo subscription
    await prisma.userSubscription.create({
      data: {
        userId: demoUser.id,
        tier: 'PRO',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        limits: {
          maxActiveStrategies: 10,
          maxMonthlyVolume: 100000,
          aiRequestsPerDay: 500,
          advancedAnalytics: true,
          prioritySupport: true,
          customIndicators: true,
        },
      },
    });

    // Create demo portfolio
    await prisma.portfolio.create({
      data: {
        userId: demoUser.id,
        name: 'Main Portfolio',
        description: 'Primary trading portfolio',
        isDefault: true,
        assets: [
          {
            token: TOKENS.SEI,
            balance: { amount: '1000', amountRaw: '1000000000000000000000' },
            valueUSD: '500',
            allocation: 50,
          },
          {
            token: TOKENS.USDC,
            balance: { amount: '500', amountRaw: '500000000' },
            valueUSD: '500',
            allocation: 50,
          },
        ],
      },
    });

    console.log('✅ Demo user created successfully');
  }

  console.log('🎉 Database seed completed successfully');
}

main()
  .catch(e => {
    console.error('❌ Error during database seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });