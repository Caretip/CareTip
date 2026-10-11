/**
 * Apply Prisma migrations to CARETIP_ISOLATED_POSTGRES_URL only.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

const isolated = await completeIsolatedPostgresBootstrap();
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

console.log("[isolated-db] prisma migrate deploy on disposable target (credentials not logged).");

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  cwd: backendRoot,
  env: { ...process.env, DATABASE_URL: isolated },
  stdio: "inherit",
  shell: true,
});

process.exit(result.status === 0 ? 0 : 1);
