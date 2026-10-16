/**
 * Multi-process PostgreSQL concurrency for employee tip release (mocked Stripe).
 *
 *   npm run test:employee-transfer-release-concurrency
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readEmployeeTipStripeCreateAuditFile } from "../src/lib/employeeTipReleaseStripeCreateAudit.js";
import { baseEmployeeTipReleaseIdempotencyKey } from "../src/lib/stripeTransferError.js";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Role,
  StripeConnectStatus,
  TipStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerScript = join(__dirname, "employee-transfer-release-concurrency-worker.ts");

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

async function seed() {
  const suffix = `conc_${Date.now()}`;
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `conc-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `Conc ${suffix}`,
      slug: `conc-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_conc_biz_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: `Emp ${suffix}`,
      jobTitle: "Server",
      businessId: business.id,
      activationStatus: "active",
    },
  });
  await prisma.employeeStripeAccount.create({
    data: {
      employeeId: employee.id,
      stripeAccountId: `acct_conc_emp_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });
  const tip = await prisma.transaction.create({
    data: {
      amount: 10,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_conc_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  const payable = await prisma.employeeTipPayable.create({
    data: {
      transactionId: tip.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.held_platform,
      grossCents: 1000,
      platformFeeCents: 100,
      payableCents: 900,
      stripePaymentIntentId: `pi_conc_${suffix}`,
      stripeChargeId: `ch_conc_${suffix}`,
    },
  });
  return { manager, business, employee, payable };
}

function runWorker(
  employeeId: string,
  payableId: string,
  auditFilePath: string,
): Promise<{ released: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", workerScript, employeeId, payableId], {
      cwd: join(__dirname, ".."),
      env: { ...process.env, CARETIP_EMP_TIP_STRIPE_CREATE_AUDIT_FILE: auditFilePath },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`worker exit ${code}`));
        return;
      }
      const line = stdout
        .trim()
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .pop();
      if (!line) {
        reject(new Error("worker missing json stdout"));
        return;
      }
      const parsed = JSON.parse(line) as {
        result: { released: number };
      };
      resolve({
        released: parsed.result.released,
      });
    });
  });
}

async function main() {
  const { manager, business, employee, payable } = await seed();

  const auditDir = join(tmpdir(), `caretip-emp-tip-audit-${Date.now()}`);
  mkdirSync(auditDir, { recursive: true });
  const auditFilePath = join(auditDir, "stripe-create-audit.jsonl");

  const expectedKey = baseEmployeeTipReleaseIdempotencyKey(payable.id);

  const [a, b] = await Promise.all([
    runWorker(employee.id, payable.id, auditFilePath),
    runWorker(employee.id, payable.id, auditFilePath),
  ]);

  const auditEntries = readEmployeeTipStripeCreateAuditFile(auditFilePath);
  assert.equal(a.released + b.released, 1, "exactly one worker may mark released");
  assert.equal(
    auditEntries.length,
    1,
    `mock transfers.create must run once (audit=${JSON.stringify(auditEntries)})`,
  );
  assert.equal(auditEntries[0]?.idempotencyKey, expectedKey);
  assert.equal(auditEntries[0]?.payableId, payable.id);

  const after = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
  assert.equal(after?.status, EmployeeTipPayableStatus.transferred);
  assert.ok(after?.stripeTransferId?.startsWith("tr_worker_"));
  assert.equal(after?.transferredCents, 900);

  const dupTransfers = await prisma.employeeTipPayable.count({
    where: { stripeTransferId: after?.stripeTransferId ?? "" },
  });
  assert.equal(dupTransfers, 1, "stripeTransferId remains unique in ledger");

  pass(
    "multi-process",
    `Two processes → 1 mock create (key=${expectedKey}), 1 released payable (${after?.stripeTransferId})`,
  );

  try {
    rmSync(auditDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  await prisma.employeeTipPayable.deleteMany({ where: { employeeId: employee.id } });
  await prisma.transaction.deleteMany({ where: { employeeId: employee.id } });
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: employee.id } });
  await prisma.employee.delete({ where: { id: employee.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.user.delete({ where: { id: manager.id } });

  console.log("\nemployee-transfer-release-concurrency-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
