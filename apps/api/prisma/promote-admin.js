// Makes an existing account the SaaS owner/admin (or removes admin with --remove).
//   npm run admin:promote -w @pos/api -- owner@example.com
//   npm run admin:promote -w @pos/api -- owner@example.com --remove
const { PrismaClient } = require('@prisma/client');

const email = (process.argv[2] || '').trim().toLowerCase();
const remove = process.argv.includes('--remove');
if (!email || !email.includes('@')) {
  console.error('Usage: npm run admin:promote -w @pos/api -- <email> [--remove]');
  process.exit(1);
}

const prisma = new PrismaClient();
prisma.user
  .update({ where: { email }, data: { role: remove ? 'USER' : 'ADMIN' }, select: { email: true, role: true } })
  .then((u) => console.log(`${u.email} is now ${u.role}`))
  .catch((e) => {
    console.error(e.code === 'P2025' ? `No account with email ${email}. Register it on the website first.` : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
