/**
 * Phase B.1 — requires CARETIP_ISOLATED_POSTGRES_URL (disposable Postgres only).
 * Run: npm run test:subscription-b1
 */
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

await completeIsolatedPostgresBootstrap();

const { runSubscriptionB1Runtime } = await import("./subscription-b1-runtime.impl.js");
const { prisma } = await import("../src/prisma.js");

try {
  await runSubscriptionB1Runtime();
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
