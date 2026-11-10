// Seeds the pricing catalogue. Run with: npm run db:seed -w @pos/api
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const plans = [
    { code: 'FREE', name: 'Free', priceMonthly: 0 },
    { code: 'PROFESSIONAL', name: 'Professional', priceMonthly: 49900 },
  ];
  for (const p of plans) {
    await prisma.plan.upsert({ where: { code: p.code }, update: p, create: p });
  }
  console.log(`Seeded ${plans.length} plans`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
