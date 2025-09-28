import { PrismaClient } from '@prisma/client';
import assetList from './assetlist.json';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Sync EVM token registry entries from asset list
  const pacificAssets = (assetList as any)['pacific-1'] ?? [];

  for (const asset of pacificAssets) {
    if (!asset || asset.type_asset !== 'erc20') {
      continue;
    }

    const address: string | undefined = asset.base;
    if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
      continue;
    }

    const denomUnits = Array.isArray(asset.denom_units) ? asset.denom_units : [];
    const decimals: number = denomUnits.length > 0
      ? Number(denomUnits[denomUnits.length - 1].exponent ?? 18)
      : 18;

    await prisma.tokenRegistry.upsert({
      where: { address },
      update: {
        symbol: asset.symbol || asset.display || address,
        name: asset.name || asset.symbol || address,
        decimals,
        logoURI: asset.images?.png || asset.images?.svg || null,
        isVerified: true,
        isActive: true
      },
      create: {
        address,
        symbol: asset.symbol || asset.display || address,
        name: asset.name || asset.symbol || address,
        decimals,
        logoURI: asset.images?.png || asset.images?.svg || null,
        isVerified: true,
        isActive: true
      }
    });
  }

  // Create test user
  const testUser = await prisma.user.upsert({
    where: { walletAddress: '0x742d35Cc6634C0532925a3b8D1C3B13B5B0C5c80' },
    update: {},
    create: {
      walletAddress: '0x742d35Cc6634C0532925a3b8D1C3B13B5B0C5c80',
      smartAccountAddress: '0x1234567890123456789012345678901234567890',
      email: 'test@copil.app',
      username: 'testuser',
      kycStatus: 'VERIFIED',
      preferences: {
        defaultSlippage: 0.5,
        maxGasPrice: 20000000000,
        notifications: {
          email: true,
          sms: false,
          push: true,
          strategies: {
            executed: true,
            failed: true,
            triggered: true
          },
          portfolio: {
            dailySummary: true,
            largeMovements: true,
            rebalanceAlerts: true
          },
          market: {
            priceAlerts: true,
            opportunities: true,
            riskAlerts: true
          }
        },
        trading: {
          autoApproveSmallTrades: true,
          smallTradeThreshold: 100,
          requireConfirmationFor: {
            largeOrders: true,
            newStrategies: true,
            highRiskTrades: true
          },
          defaultTimeouts: {
            swapDeadline: 20,
            strategyExpiration: 24
          },
          riskManagement: {
            maxPositionSize: 10,
            maxDailyLoss: 5,
            stopLossDefault: 2
          }
        },
        ui: {
          theme: 'dark',
          language: 'en',
          currency: 'USD',
          chartType: 'candlestick',
          defaultTimeframe: '1h',
          showAdvancedFeatures: true
        }
      }
    }
  });

  // Create user subscription
  await prisma.userSubscription.create({
    data: {
      userId: testUser.id,
      tier: 'PRO',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      limits: {
        maxActiveStrategies: 50,
        maxMonthlyVolume: 100000,
        aiRequestsPerDay: 1000,
        advancedAnalytics: true,
        prioritySupport: true,
        customIndicators: true
      }
    }
  });

  // Create user session with session key
  const userSession = await prisma.userSession.upsert({
    where: { token: 'dev_session_token_123' },
    update: {},
    create: {
      userId: testUser.id,
      token: 'dev_session_token_123',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      ipAddress: '127.0.0.1',
      userAgent: 'Copil Development Client'
    }
  });

  // Create session key
  await prisma.sessionKey.create({
    data: {
      sessionId: userSession.id,
      address: '0x9876543210987654321098765432109876543210',
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      validAfter: new Date(),
      limitAmount: '1000000000000000000', // 1 ETH in wei
      allowedTargets: [
        '0x1111111111111111111111111111111111111111', // DEX Router
        '0x2222222222222222222222222222222222222222'  // Token Contract
      ],
      allowedFunctions: [
        '0xa9059cbb', // transfer(address,uint256)
        '0x7ff36ab5'  // swapExactETHForTokens
      ]
    }
  });

  // Create test strategies
  const strategies = [
    {
      name: 'DCA SEI Purchase',
      type: 'DCA',
      description: 'Dollar cost average into SEI token every day',
      conditions: [
        {
          type: 'time_after',
          value: '00:00',
          operator: '==',
          description: 'Execute daily at midnight'
        }
      ],
      parameters: {
        tokenIn: { symbol: 'USDC', address: '0x3999999999999999999999999999999999999999' },
        tokenOut: { symbol: 'SEI', address: '0x4444444444444444444444444444444444444444' },
        amountIn: '100',
        frequency: 'daily',
        totalOrders: 30,
        currentOrder: 1,
        slippage: 0.5,
        maxGasPrice: '20000000000'
      }
    },
    {
      name: 'SEI Price Alert',
      type: 'CONDITIONAL_ORDER',
      description: 'Buy SEI when price drops below $0.50',
      conditions: [
        {
          type: 'price_below',
          value: '0.50',
          operator: '<',
          token: 'SEI',
          description: 'SEI price below $0.50'
        }
      ],
      parameters: {
        tokenIn: { symbol: 'USDC', address: '0x3999999999999999999999999999999999999999' },
        tokenOut: { symbol: 'SEI', address: '0x4444444444444444444444444444444444444444' },
        amountIn: '500',
        slippage: 1.0,
        maxGasPrice: '25000000000'
      }
    },
    {
      name: 'Portfolio Rebalance',
      type: 'PORTFOLIO_REBALANCING',
      description: 'Rebalance portfolio weekly',
      conditions: [
        {
          type: 'time_after',
          value: 'sunday_00:00',
          operator: '==',
          description: 'Execute weekly on Sunday'
        }
      ],
      parameters: {
        targetAllocations: {
          'SEI': 40,
          'USDC': 40,
          'WETH': 20
        },
        rebalanceThreshold: 5, // 5% deviation
        slippage: 1.0,
        maxGasPrice: '30000000000'
      }
    }
  ];

  for (const strategyData of strategies) {
    await prisma.strategy.create({
      data: {
        userId: testUser.id,
        name: strategyData.name,
        type: strategyData.type as any,
        description: strategyData.description,
        conditions: strategyData.conditions,
        parameters: strategyData.parameters
      }
    });
  }

  // Create default portfolio
  await prisma.portfolio.create({
    data: {
      userId: testUser.id,
      name: 'Default Portfolio',
      description: 'Main trading portfolio',
      isDefault: true,
      assets: [
        {
          tokenAddress: '0x4444444444444444444444444444444444444444',
          symbol: 'SEI',
          balance: '1000.0',
          value: '450.0'
        },
        {
          tokenAddress: '0x3999999999999999999999999999999999999999',
          symbol: 'USDC',
          balance: '2000.0',
          value: '2000.0'
        },
        {
          tokenAddress: '0x5555555555555555555555555555555555555555',
          symbol: 'WETH',
          balance: '0.5',
          value: '1200.0'
        }
      ],
      metadata: {
        totalValue: '3650.0',
        lastUpdated: new Date().toISOString()
      }
    }
  });

  // Create token registry entries
  const tokens = [
    {
      address: '0x4444444444444444444444444444444444444444',
      symbol: 'SEI',
      name: 'Sei Network Token',
      decimals: 18,
      logoURI: 'https://assets.coingecko.com/coins/images/28205/thumb/Sei_Logo_-_Transparent.png',
      coingeckoId: 'sei-network',
      isVerified: true
    },
    {
      address: '0x3999999999999999999999999999999999999999',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logoURI: 'https://assets.coingecko.com/coins/images/6319/thumb/USD_Coin_icon.png',
      coingeckoId: 'usd-coin',
      isVerified: true
    },
    {
      address: '0x5555555555555555555555555555555555555555',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      logoURI: 'https://assets.coingecko.com/coins/images/2518/thumb/weth.png',
      coingeckoId: 'weth',
      isVerified: true
    }
  ];

  for (const token of tokens) {
    await prisma.tokenRegistry.upsert({
      where: { address: token.address },
      update: {},
      create: token
    });
  }

  // Create DEX status entries
  const dexes = [
    {
      id: 'astroport',
      name: 'astroport',
      displayName: 'Astroport',
      routerAddress: '0x7777777777777777777777777777777777777777',
      factoryAddress: '0x6666666666666666666666666666666666666666',
      tvl: '50000000',
      volume24h: '2500000',
      fees: [0.3, 0.05, 1.0]
    },
    {
      id: 'dragonswap',
      name: 'dragonswap',
      displayName: 'DragonSwap',
      routerAddress: '0x8888888888888888888888888888888888888888',
      factoryAddress: '0x9999999999999999999999999999999999999999',
      tvl: '25000000',
      volume24h: '1200000',
      fees: [0.25, 0.05, 0.3]
    },
    {
      id: 'whitewhale',
      name: 'whitewhale',
      displayName: 'White Whale',
      routerAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      factoryAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      tvl: '15000000',
      volume24h: '800000',
      fees: [0.3]
    }
  ];

  for (const dex of dexes) {
    await prisma.dEXStatus.upsert({
      where: { id: dex.id },
      update: {},
      create: dex
    });
  }

  // Create sample market data
  const now = new Date();
  const marketData = [
    {
      timestamp: now,
      tokenAddress: '0x4444444444444444444444444444444444444444',
      price: '0.45',
      volume24h: '5000000',
      liquidity: '12000000',
      marketCap: '450000000'
    },
    {
      timestamp: now,
      tokenAddress: '0x3999999999999999999999999999999999999999',
      price: '1.00',
      volume24h: '15000000',
      liquidity: '50000000',
      marketCap: '32000000000'
    },
    {
      timestamp: now,
      tokenAddress: '0x5555555555555555555555555555555555555555',
      price: '2400.00',
      volume24h: '8000000',
      liquidity: '25000000',
      marketCap: '288000000000'
    }
  ];

  for (const data of marketData) {
    await prisma.marketData.upsert({
      where: {
        timestamp_tokenAddress: {
          timestamp: data.timestamp,
          tokenAddress: data.tokenAddress
        }
      },
      update: {},
      create: data
    });
  }

  // Create user analytics
  await prisma.userAnalytics.upsert({
    where: { userId: testUser.id },
    update: {},
    create: {
      userId: testUser.id,
      totalTrades: 25,
      totalVolume: '15000.00',
      totalPnL: '1250.50',
      winRate: 68.0,
      averageHoldTime: 432000, // 5 days in seconds
      favoriteTokens: ['SEI', 'USDC', 'WETH'],
      riskScore: 42.5
    }
  });

  // Create system config
  const configs = [
    { key: 'MIN_SLIPPAGE', value: '0.1' },
    { key: 'MAX_SLIPPAGE', value: '5.0' },
    { key: 'DEFAULT_GAS_LIMIT', value: '300000' },
    { key: 'MAX_GAS_PRICE', value: '50000000000' },
    { key: 'STRATEGY_EXECUTION_INTERVAL', value: '30000' },
    { key: 'PRICE_UPDATE_INTERVAL', value: '10000' }
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: { value: config.value },
      create: config
    });
  }

  console.log('✅ Database seeded successfully!');
  console.log(`📊 Created:`);
  console.log(`   • 1 test user with verified KYC`);
  console.log(`   • 1 user session with session key`);
  console.log(`   • 3 trading strategies (DCA, Conditional, Rebalancing)`);
  console.log(`   • 1 default portfolio with 3 assets`);
  console.log(`   • 3 token registry entries`);
  console.log(`   • 3 DEX configurations`);
  console.log(`   • Market data for all tokens`);
  console.log(`   • User analytics and system configuration`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
