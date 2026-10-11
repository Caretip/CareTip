/**
 * Sprint 1.2 — requires CARETIP_ISOLATED_POSTGRES_URL (disposable Postgres only).
 * Run: npm run test:subscription-reliability-sprint1_2-integration
 */
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

await completeIsolatedPostgresBootstrap();

const { runSprint12IntegrationRuntime } = await import(
  "./subscription-reliability-sprint1_2-integration-runtime.impl.js"
);
const { prisma } = await import("../src/prisma.js");

try {
  await runSprint12IntegrationRuntime();
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
