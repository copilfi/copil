import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

// Load environment from root .env file with override
const envPath = path.resolve(__dirname, '../../../../.env');
dotenv.config({ path: envPath, override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  
  // Database
  DATABASE_URL: z.string().default('postgresql://postgres:password@localhost:5432/copil_dev'),
  
  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  
  // JWT
  JWT_SECRET: z.string().default('your-super-secret-jwt-key-change-in-production'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  
  // Blockchain - Alchemy Primary, SEI Fallback
  ALCHEMY_SEI_RPC_URL: z.string().default('https://sei-mainnet.g.alchemy.com/v2/sboNXA7fMognu1Fo4gsts'),
  ALCHEMY_SEI_WS_URL: z.string().default('wss://sei-mainnet.g.alchemy.com/v2/sboNXA7fMognu1Fo4gsts'),
  SEI_TESTNET_RPC_URL: z.string().default('https://evm-rpc-testnet.sei-apis.com'),
  SEI_MAINNET_RPC_URL: z.string().default('https://evm-rpc.sei-apis.com'),
  
  // Backend automation key - NOT for user wallets!
  // Used for: DCA execution, conditional orders, gas sponsorship
  AUTOMATION_PRIVATE_KEY: z.string().optional(),
  PRIVATE_KEY: z.string().optional(), // Legacy compatibility
  
  // Platform Revenue - Treasury Wallet
  TREASURY_PRIVATE_KEY: z.string().optional(),
  TREASURY_ADDRESS: z.string().optional(),
  
  // Fee Configuration
  SWAP_FEE_PERCENTAGE: z.coerce.number().default(0.002),
  DCA_FEE_PERCENTAGE: z.coerce.number().default(0.0075),
  CONDITIONAL_ORDER_FEE_PERCENTAGE: z.coerce.number().default(0.005),
  AI_STRATEGY_FEE_PERCENTAGE: z.coerce.number().default(0.01),
  
  // Contract Addresses (will be set after deployment)
  ENTRY_POINT_ADDRESS: z.string().optional(),
  ACCOUNT_FACTORY_ADDRESS: z.string().optional(),
  CONDITIONAL_ORDER_ENGINE_ADDRESS: z.string().optional(),
  
  // Chain IDs
  SEI_CHAIN_ID: z.coerce.number().default(1329),
  SEI_TESTNET_CHAIN_ID: z.coerce.number().default(713715),
  
  // External APIs
  COINMARKETCAP_API_KEY: z.string().optional(),
  COINGECKO_API_KEY: z.string().optional(),
  
  // AI Services
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4'),
  ANTHROPIC_API_KEY: z.string().optional(),
  
  // Oracle Services
  PYTH_PRICE_SERVICE_URL: z.string().default('https://hermes.pyth.network'),
  DEFILLLAMA_API_URL: z.string().default('https://api.llama.fi'),
  
  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  
  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type Environment = z.infer<typeof envSchema>;

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parseResult.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parseResult.data;

export default env;