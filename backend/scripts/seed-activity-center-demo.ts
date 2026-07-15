/**
 * Seed Activity Center feed for demo@caretip.de without full demo reset.
 * Run: npm run db:seed:activity-center
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { seedDemoActivityCenter } from "../prisma/seedDemoActivityCenter.js";

async function main() {
  const n = await seedDemoActivityCenter(prisma);
  console.log(`Done. Inserted ${n} activity events.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
