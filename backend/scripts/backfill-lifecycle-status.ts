/**
 * Idempotent backfill for Slice C lifecycle fields.
 * Safe to re-run. Does not destroy data.
 *
 * Run: npm run db:backfill-lifecycle-status (from backend/)
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

async function main() {
  const deactivated = await prisma.user.updateMany({
    where: { isActive: false, accountStatus: "active" },
    data: { accountStatus: "deactivated" },
  });
  console.info(`[backfill] users active→deactivated by isActive=false: ${deactivated.count}`);

  const softClosed = await prisma.business.updateMany({
    where: { deletedAt: { not: null }, lifecycleStatus: "active" },
    data: { lifecycleStatus: "soft_closed" },
  });
  console.info(`[backfill] businesses soft_closed from deletedAt: ${softClosed.count}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
