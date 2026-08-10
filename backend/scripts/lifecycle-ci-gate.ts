/**
 * Slice I — coherent lifecycle + security CI gate.
 * Runs required A–H suites, scenarios, security-hardening, prisma validate, tsc.
 *
 * Does NOT set production destruction flags.
 * Expects DATABASE_URL for DB-backed suites (local or CI Postgres service).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");

const steps: Array<{ name: string; cmd: string; args: string[] }> = [
  { name: "lifecycle-slice-a", cmd: "npm", args: ["run", "test:lifecycle-slice-a"] },
  { name: "lifecycle-slice-b", cmd: "npm", args: ["run", "test:lifecycle-slice-b"] },
  { name: "lifecycle-slice-c", cmd: "npm", args: ["run", "test:lifecycle-slice-c"] },
  { name: "lifecycle-slice-d", cmd: "npm", args: ["run", "test:lifecycle-slice-d"] },
  { name: "lifecycle-slice-d1", cmd: "npm", args: ["run", "test:lifecycle-slice-d1"] },
  { name: "lifecycle-slice-e", cmd: "npm", args: ["run", "test:lifecycle-slice-e"] },
  { name: "lifecycle-slice-f-anonymization", cmd: "npm", args: ["run", "test:lifecycle-slice-f-anonymization"] },
  { name: "lifecycle-slice-f-b", cmd: "npm", args: ["run", "test:lifecycle-slice-f-b"] },
  { name: "lifecycle-slice-f-c", cmd: "npm", args: ["run", "test:lifecycle-slice-f-c"] },
  { name: "lifecycle-slice-g", cmd: "npm", args: ["run", "test:lifecycle-slice-g"] },
  { name: "lifecycle-platform-legal-hold-ui", cmd: "npm", args: ["run", "test:lifecycle-platform-legal-hold-ui"] },
  { name: "lifecycle-slice-h", cmd: "npm", args: ["run", "test:lifecycle-slice-h"] },
  { name: "lifecycle-g-r1-erasure-continue", cmd: "npm", args: ["run", "test:lifecycle-g-r1-erasure-continue"] },
  { name: "lifecycle-h-r1-privacy-audit", cmd: "npm", args: ["run", "test:lifecycle-h-r1-privacy-audit"] },
  { name: "lifecycle-migration-verify", cmd: "npm", args: ["run", "test:lifecycle-migration-verify"] },
  { name: "lifecycle-scenarios", cmd: "npm", args: ["run", "test:lifecycle-scenarios"] },
  { name: "security-hardening", cmd: "npm", args: ["run", "test:security-hardening"] },
  {
    name: "prisma-validate",
    cmd: "npx",
    args: ["prisma", "validate", "--schema=prisma/schema.prisma"],
  },
  { name: "tsc", cmd: "npx", args: ["tsc", "--noEmit"] },
];

function run(step: { name: string; cmd: string; args: string[] }): boolean {
  console.log(`\n======== CI GATE: ${step.name} ========`);
  const r = spawnSync(step.cmd, step.args, {
    cwd: backendRoot,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      // Never enable production destruction via the gate itself.
      // Individual tests may set flags in-process on fixtures only.
    },
  });
  if (r.status !== 0) {
    console.error(`\nCI GATE FAILED at: ${step.name}`);
    return false;
  }
  console.log(`CI GATE OK: ${step.name}`);
  return true;
}

let failed = false;
for (const step of steps) {
  if (!run(step)) {
    failed = true;
    break;
  }
}

if (failed) {
  process.exit(1);
}
console.log("\n======== LIFECYCLE CI GATE PASSED ========");
