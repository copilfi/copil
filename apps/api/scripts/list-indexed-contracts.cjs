const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

(async () => {
  const contracts = await prisma.indexedContract.findMany({
    orderBy: { createdAt: 'desc' }
  });
  console.log(JSON.stringify(contracts, null, 2));
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error('Failed to list indexed contracts:', error);
  await prisma.$disconnect();
  process.exit(1);
});
