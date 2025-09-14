import { PrismaClient } from '@prisma/client';

// Create a global prisma instance
declare global {
  // eslint-disable-next-line no-var, no-unused-vars
  var __prisma: PrismaClient | undefined;
}

let prisma: PrismaClient;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  // In development, use a global variable to avoid exhausting database connections
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ['query', 'error', 'warn'],
    });
  }
  prisma = global.__prisma;
}

export { prisma };

// Re-export Prisma types
export * from '@prisma/client';

// Custom database utilities
export * from './repositories';
export * from './migrations';
export * from './seeds';