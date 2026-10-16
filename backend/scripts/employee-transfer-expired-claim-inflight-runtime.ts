/**
 * Phase 1.2 — expired claim + in-flight transfers.create race (two-process, mocked Stripe).
 *
 *   npm run test:employee-transfer-expired-claim-inflight
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Role,
  StripeConnectStatus,
  TipStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import { EMPLOYEE_TIP_RELEASE_IN_FLIGHT_TTL_MS } from "../src/config/employeeTipReleaseRecovery.config.js";
import {
  DURABLE_RELEASE_BLOCK_PREFIX,
  DURABLE_OPERATIONAL_SEP,
  extractDurableReleaseSegment,
  formatDurableReleaseBlock,
  formatEmployeeTipReleaseClaim,
  formatEmployeeTipReleaseOpsState,
  formatEmployeeTipStripeTransferInFlight,
  mergeDurableWithOperationalMarker,
  operationTokenMatches,
  parseDurableReleaseBlockDetail,
  parseEmployeeTipStripeTransferInFlight,
  releaseCreateBlockedByStoredMarker,
} from "../src/lib/employeeTipReleaseClaim.js";
import { readEmployeeTipStripeCreateAuditFile } from "../src/lib/employeeTipReleaseStripeCreateAudit.js";
import { baseEmployeeTipReleaseIdempotencyKey } from "../src/lib/stripeTransferError.js";
import { prisma } from "../src/prisma.js";
import {
  __employeeTipReleaseMarkDefiniteTransferFailureForTests,
  __setEmployeeTipPayablePersistFnForTests,
  __setEmployeeTipReleaseTransferListFnForTests,
  __setEmployeeTipTransferCreateFnForTests,
  reconcileEmployeeTipReleaseTransfer,
  releaseHeldPlatformPayablesForEmployee,
} from "../src/services/employeeTipRelease.service.js";
import {
  applyDisputeToEmployeePayable,
  applyRefundToEmployeePayable,
} from "../src/services/employeeTipPayable.service.js";
import {
  clearMockEmployeeTipStripeTransferList,
  installMockEmptyEmployeeTipTransferList,
} from "./lib/mockEmployeeTipStripeTransferList.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerScript = join(__dirname, "employee-transfer-expired-claim-inflight-worker.ts");

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function seedHeldPayable(suffix: string) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `infl-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `Infl ${suffix}`,
      slug: `infl-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_infl_biz_${suffix}`,
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
  const empAcct = `acct_infl_emp_${suffix}`;
  await prisma.employeeStripeAccount.create({
    data: {
      employeeId: employee.id,
      stripeAccountId: empAcct,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });
  const tip = await prisma.transaction.create({
    data: {
      amount: 10,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_infl_${suffix}`,
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
      stripePaymentIntentId: `pi_infl_${suffix}`,
      stripeChargeId: `ch_infl_${suffix}`,
    },
  });
  return { manager, business, employee, empAcct, payable };
}

async function cleanup(ctx: {
  employeeId: string;
  businessId: string;
  managerId: string;
}) {
  await prisma.employeeTipPayable.deleteMany({ where: { employeeId: ctx.employeeId } });
  await prisma.transaction.deleteMany({ where: { employeeId: ctx.employeeId } });
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: ctx.employeeId } });
  await prisma.employee.delete({ where: { id: ctx.employeeId } });
  await prisma.business.delete({ where: { id: ctx.businessId } });
  await prisma.user.delete({ where: { id: ctx.managerId } });
}

async function waitForInflightMarker(payableId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.employeeTipPayable.findUnique({
      where: { id: payableId },
      select: { lastTransferError: true },
    });
    if (parseEmployeeTipStripeTransferInFlight(row?.lastTransferError)) {
      return row!.lastTransferError!;
    }
    await sleep(40);
  }
  throw new Error("timeout_waiting_for_rel_inflight");
}

function runWorker(
  employeeId: string,
  payableId: string,
  auditFilePath: string,
  barrierFilePath?: string,
): Promise<{ released: number; uncertain: number; pid: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", workerScript, employeeId, payableId], {
      cwd: join(__dirname, ".."),
      env: {
        ...process.env,
        CARETIP_EMP_TIP_STRIPE_CREATE_AUDIT_FILE: auditFilePath,
        ...(barrierFilePath
          ? { CARETIP_EMP_TIP_CREATE_BARRIER_FILE: barrierFilePath }
          : {}),
      },
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
        reject(new Error(`worker exit ${code}: ${stdout}`));
        return;
      }
      const line = stdout
        .trim()
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .pop();
      if (!line) {
        reject(new Error(`worker missing json stdout: ${stdout}`));
        return;
      }
      const parsed = JSON.parse(line) as {
        pid: number;
        result: { released: number; uncertain: number };
      };
      resolve({
        pid: parsed.pid,
        released: parsed.result.released,
        uncertain: parsed.result.uncertain,
      });
    });
  });
}

async function main() {
  const suffix = `infl_${Date.now()}`;
  const expectedKey = (payableId: string) => baseEmployeeTipReleaseIdempotencyKey(payableId);

  // --- Two-process: active rel_inflight blocks Worker B (no second create) ---
  {
    const { manager, business, employee, payable } = await seedHeldPayable(`${suffix}_active`);
    const auditDir = join(tmpdir(), `caretip-infl-active-${Date.now()}`);
    mkdirSync(auditDir, { recursive: true });
    const auditFile = join(auditDir, "audit.jsonl");
    const barrierFile = join(auditDir, "barrier.txt");
    writeFileSync(barrierFile, "hold", "utf8");

    const workerAPromise = runWorker(employee.id, payable.id, auditFile, barrierFile);

    const inflightRaw = await waitForInflightMarker(payable.id);
    pass("active-inflight-marker", `Worker A marked ${inflightRaw.slice(0, 40)}…`);

    assert.equal(
      readEmployeeTipStripeCreateAuditFile(auditFile).length,
      0,
      "audit before barrier release must be empty",
    );

    const workerB = await runWorker(employee.id, payable.id, auditFile);
    assert.equal(workerB.released, 0, "Worker B must not release while inflight active");
    assert.equal(
      readEmployeeTipStripeCreateAuditFile(auditFile).length,
      0,
      "Worker B must not call transfers.create while inflight active",
    );

    writeFileSync(barrierFile, "release", "utf8");
    const workerA = await workerAPromise;
    assert.equal(workerA.released, 1);

    const audit = readEmployeeTipStripeCreateAuditFile(auditFile);
    assert.equal(audit.length, 1, `exactly one create (keys=${JSON.stringify(audit)})`);
    assert.equal(audit[0]?.idempotencyKey, expectedKey(payable.id));

    const workerB2 = await runWorker(employee.id, payable.id, auditFile);
    assert.equal(workerB2.released, 0);
    assert.equal(readEmployeeTipStripeCreateAuditFile(auditFile).length, 1);

    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(row?.status, EmployeeTipPayableStatus.transferred);
    assert.ok(row?.stripeTransferId?.startsWith("tr_inflight_"));

    pass(
      "active-inflight-race",
      `B blocked during A create; 1 create key=${audit[0]?.idempotencyKey}`,
    );

    rmSync(auditDir, { recursive: true, force: true });
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- Two-process: expired inflight + empty lookup → B blocked; A completes once ---
  {
    const { manager, business, employee, empAcct, payable } = await seedHeldPayable(
      `${suffix}_reclaim`,
    );
    const auditDir = join(tmpdir(), `caretip-infl-reclaim-${Date.now()}`);
    mkdirSync(auditDir, { recursive: true });
    const auditFile = join(auditDir, "audit.jsonl");
    const barrierFile = join(auditDir, "barrier.txt");
    writeFileSync(barrierFile, "hold", "utf8");

    const workerAPromise = runWorker(employee.id, payable.id, auditFile, barrierFile);
    const inflightRaw = await waitForInflightMarker(payable.id);
    const parsed = parseEmployeeTipStripeTransferInFlight(inflightRaw);
    assert.ok(parsed);

    const expiredStarted = Date.now() - EMPLOYEE_TIP_RELEASE_IN_FLIGHT_TTL_MS - 60_000;
    const expiredInflight = formatEmployeeTipStripeTransferInFlight(parsed.token, expiredStarted);
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: { lastTransferError: expiredInflight },
    });

    const workerB = await runWorker(employee.id, payable.id, auditFile);
    assert.equal(workerB.released, 0);
    assert.ok(workerB.uncertain >= 1, "B should end uncertain after post-reclaim empty lookup");
    assert.equal(readEmployeeTipStripeCreateAuditFile(auditFile).length, 0, "B must not create");

    const afterB = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.match(afterB?.lastTransferError ?? "", /rel_durable:1:post_reclaim_empty_lookup/);

    writeFileSync(barrierFile, "release", "utf8");
    const workerA = await workerAPromise;
    assert.equal(workerA.released, 0, "stale A must not persist after B reclaimed");

    const audit = readEmployeeTipStripeCreateAuditFile(auditFile);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.idempotencyKey, expectedKey(payable.id));

    const still = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(still?.stripeTransferId, null, "ownership_lost must not let stale worker persist");
    assert.ok(
      still?.lastTransferError?.includes(DURABLE_RELEASE_BLOCK_PREFIX),
      "orphan or post-reclaim durable marker must remain",
    );

    const orphanTransferId = `tr_inflight_${workerA.pid}`;

    // Scenario A — third release attempt, lookup still empty → no second create
    installMockEmptyEmployeeTipTransferList();
    let thirdCreates = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      thirdCreates += 1;
      return { id: "tr_third_blocked", amount: 900 };
    });
    const third = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(third.released, 0);
    assert.ok(third.uncertain >= 1);
    assert.equal(thirdCreates, 0);
    assert.equal(readEmployeeTipStripeCreateAuditFile(auditFile).length, 1);
    pass("scenario-a-third-attempt", "Third release with durable block + empty list → 0 creates");

    // Scenario B — orphan becomes visible via list → single persisted transfer
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        {
          id: orphanTransferId,
          object: "transfer",
          amount: 900,
          currency: "eur",
          destination: empAcct,
          metadata: {
            caretip_payable_id: payable.id,
            caretip_employee_id: employee.id,
            caretip_business_id: payable.businessId,
            caretip_transaction_id: payable.transactionId,
          },
        },
      ],
      has_more: false,
      url: "/v1/transfers",
    }));
    const fourth = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(fourth.released, 1);
    assert.equal(thirdCreates, 0);
    assert.equal(readEmployeeTipStripeCreateAuditFile(auditFile).length, 1);
    const reconciled = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(reconciled?.status, EmployeeTipPayableStatus.transferred);
    assert.equal(reconciled?.stripeTransferId, orphanTransferId);
    assert.equal(reconciled?.lastTransferError, null);
    pass(
      "scenario-b-orphan-reconcile",
      `List found orphan ${orphanTransferId}; 1 total create key=${audit[0]?.idempotencyKey}`,
    );

    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();

    pass(
      "post-reclaim-empty-lookup",
      `B blocked create (${afterB?.lastTransferError}); A create count=1 key=${audit[0]?.idempotencyKey}`,
    );

    rmSync(auditDir, { recursive: true, force: true });
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- In-process: post-reclaim from expired claim (no inflight) ---
  {
    const { manager, business, employee, payable } = await seedHeldPayable(`${suffix}_pr`);
    const deadClaim = formatEmployeeTipReleaseClaim(Date.now() - 60_000, "deadbeefcafebabe");
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: {
        status: EmployeeTipPayableStatus.transferring,
        lastTransferError: deadClaim,
      },
    });
    installMockEmptyEmployeeTipTransferList();
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: `tr_pr_${suffix}`, amount: 900 };
    });
    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(createCalls, 0);
    assert.equal(result.released, 0);
    assert.ok(result.uncertain >= 1);
    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.match(row?.lastTransferError ?? "", /rel_durable:1:post_reclaim_empty_lookup/);
    const second = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(createCalls, 0);
    assert.equal(second.released, 0);
    pass("post-reclaim-solo", "Expired claim reclaim + empty list blocks create across attempts");
    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- In-process: Stripe succeeds, DB persist fails → list reconcile without second create ---
  {
    const { manager, business, employee, empAcct, payable } = await seedHeldPayable(
      `${suffix}_persist`,
    );
    const transferId = `tr_persist_${suffix}`;
    let createCalls = 0;
    installMockEmptyEmployeeTipTransferList();
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: transferId, amount: 900 };
    });
    __setEmployeeTipPayablePersistFnForTests(async () => {
      throw new Error("simulated_db_down");
    });
    const r1 = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(createCalls, 1);
    assert.equal(r1.released, 0);
    assert.ok(r1.uncertain >= 1);
    __setEmployeeTipPayablePersistFnForTests(null);
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        {
          id: transferId,
          object: "transfer",
          amount: 900,
          currency: "eur",
          destination: empAcct,
          metadata: {
            caretip_payable_id: payable.id,
            caretip_employee_id: employee.id,
            caretip_business_id: payable.businessId,
            caretip_transaction_id: payable.transactionId,
          },
        },
      ],
      has_more: false,
      url: "/v1/transfers",
    }));
    const r2 = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(createCalls, 1, "retry must reconcile via list, not blind create");
    assert.equal(r2.released, 1);
    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
    pass("persist-fail", "DB persist failure then list reconcile — single transfers.create");
  }

  // --- In-process: legacy transferring without rel_claim ---
  {
    const { manager, business, employee, payable } = await seedHeldPayable(`${suffix}_legacy`);
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: {
        status: EmployeeTipPayableStatus.transferring,
        lastTransferError: null,
      },
    });
    installMockEmptyEmployeeTipTransferList();
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async (_p, opts) => {
      createCalls += 1;
      assert.equal(opts.idempotencyKey, expectedKey(payable.id));
      return { id: `tr_legacy_${suffix}`, amount: 900 };
    });
    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.released, 1);
    assert.equal(createCalls, 1);
    pass("legacy-transferring", "transferring without rel_claim still releases with base idempotency key");
    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- In-process: dual reconcile (lookup path) ---
  {
    const { manager, business, employee, empAcct, payable } = await seedHeldPayable(`${suffix}_dual`);
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: { status: EmployeeTipPayableStatus.transferring },
    });
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        {
          id: `tr_dual_${suffix}`,
          object: "transfer",
          amount: 900,
          currency: "eur",
          destination: empAcct,
          metadata: {
            caretip_payable_id: payable.id,
            caretip_employee_id: employee.id,
            caretip_business_id: payable.businessId,
            caretip_transaction_id: payable.transactionId,
          },
        },
      ],
      has_more: false,
      url: "/v1/transfers",
    }));
    const [o1, o2] = await Promise.all([
      reconcileEmployeeTipReleaseTransfer({
        payableId: payable.id,
        employeeId: employee.id,
        destinationAccountId: empAcct,
      }),
      reconcileEmployeeTipReleaseTransfer({
        payableId: payable.id,
        employeeId: employee.id,
        destinationAccountId: empAcct,
      }),
    ]);
    const outcomes = new Set([o1, o2]);
    assert.ok(outcomes.has("reconciled"));
    assert.ok(
      outcomes.has("not_eligible") || outcomes.has("still_uncertain") || o1 === o2,
    );
    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(row?.stripeTransferId, `tr_dual_${suffix}`);
    pass("dual-reconcile", "Parallel reconcile persisted single stripeTransferId");
    clearMockEmployeeTipStripeTransferList();
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- In-process: definite failure then safe retry ---
  {
    const { manager, business, employee, payable } = await seedHeldPayable(`${suffix}_retry`);
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: {
        status: EmployeeTipPayableStatus.transfer_failed,
        lastTransferError: "card_declined",
      },
    });
    installMockEmptyEmployeeTipTransferList();
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async (_p, opts) => {
      createCalls += 1;
      assert.equal(opts.idempotencyKey, expectedKey(payable.id));
      return { id: `tr_retry_${suffix}`, amount: 900 };
    });
    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.released, 1);
    assert.equal(createCalls, 1);
    pass("definite-failure-retry", "transfer_failed retry uses same base idempotency key");
    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- Scenario C — unsafe lookup outcomes while durable block active ---
  {
    const { manager, business, employee, empAcct, payable } = await seedHeldPayable(`${suffix}_sc`);
    const durable = formatDurableReleaseBlock("post_reclaim_empty_lookup", "test");
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: { status: EmployeeTipPayableStatus.transferring, lastTransferError: durable },
    });
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: "tr_sc_bad", amount: 900 };
    });

    __setEmployeeTipReleaseTransferListFnForTests(async () => {
      throw new Error("stripe_list_down");
    });
    const fail = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(fail.released, 0);
    assert.equal(createCalls, 0);

    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [],
      has_more: true,
      url: "/v1/transfers",
    }));
    const incomplete = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(incomplete.released, 0);
    assert.equal(createCalls, 0);

    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        {
          id: `tr_dup_a_${suffix}`,
          object: "transfer",
          amount: 900,
          currency: "eur",
          destination: empAcct,
          metadata: { caretip_payable_id: payable.id },
        },
        {
          id: `tr_dup_b_${suffix}`,
          object: "transfer",
          amount: 900,
          currency: "eur",
          destination: empAcct,
          metadata: { caretip_payable_id: payable.id },
        },
      ],
      has_more: false,
      url: "/v1/transfers",
    }));
    const dup = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(dup.released, 0);
    assert.equal(createCalls, 0);
    const dupRow = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.match(dupRow?.lastTransferError ?? "", /duplicate_stripe_transfer|manual_duplicate/);

    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        {
          id: `tr_bad_amt_${suffix}`,
          object: "transfer",
          amount: 1,
          currency: "eur",
          destination: empAcct,
          metadata: {
            caretip_payable_id: payable.id,
            caretip_employee_id: employee.id,
            caretip_business_id: payable.businessId,
            caretip_transaction_id: payable.transactionId,
          },
        },
      ],
      has_more: false,
      url: "/v1/transfers",
    }));
    const badAmt = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(badAmt.released, 0);
    assert.equal(createCalls, 0);

    pass("scenario-c-unsafe-lookup", "Durable block + lookup errors/duplicates → no create");
    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- Scenario D — stale worker cannot apply definite failure ---
  {
    const { manager, business, employee, payable } = await seedHeldPayable(`${suffix}_stale`);
    const tokenNew = "newownertoken123456";
    const tokenStale = "staleworkertoken12";
    const claimNew = formatEmployeeTipReleaseClaim(Date.now() + 600_000, tokenNew);
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: {
        status: EmployeeTipPayableStatus.transferring,
        lastTransferError: claimNew,
      },
    });
    const applied = await __employeeTipReleaseMarkDefiniteTransferFailureForTests(
      payable.id,
      "stale_definite_fail",
      tokenStale,
    );
    assert.equal(applied, false);
    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(row?.status, EmployeeTipPayableStatus.transferring);
    assert.equal(row?.lastTransferError, claimNew);
    pass("scenario-d-stale-definite-fail", "Stale token cannot set transfer_failed");
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- Scenario E — durable marker survives fresh invocation (restart surrogate) ---
  {
    const { manager, business, employee, payable } = await seedHeldPayable(`${suffix}_restart`);
    const durable = formatDurableReleaseBlock("orphan_suspected", `tr_restart_${suffix}`);
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: { status: EmployeeTipPayableStatus.transferring, lastTransferError: durable },
    });
    installMockEmptyEmployeeTipTransferList();
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: "tr_restart_bad", amount: 900 };
    });
    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.released, 0);
    assert.equal(createCalls, 0);
    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.ok(
      row?.lastTransferError?.startsWith(DURABLE_RELEASE_BLOCK_PREFIX),
      `expected durable block, got ${row?.lastTransferError}`,
    );
    pass(
      "scenario-e-restart-surrogate",
      "Fresh release with persisted rel_durable remains blocked (no in-memory state)",
    );
    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- Fix F1: durable block + lookup found + persist fail preserves rel_durable ---
  {
    const { manager, business, employee, empAcct, payable } = await seedHeldPayable(
      `${suffix}_f1`,
    );
    const durable = formatDurableReleaseBlock("post_reclaim_empty_lookup", "f1");
    const transferId = `tr_f1_candidate_${suffix}`;
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: { status: EmployeeTipPayableStatus.transferring, lastTransferError: durable },
    });
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        {
          id: transferId,
          object: "transfer",
          amount: 900,
          currency: "eur",
          destination: empAcct,
          metadata: {
            caretip_payable_id: payable.id,
            caretip_employee_id: employee.id,
            caretip_business_id: payable.businessId,
            caretip_transaction_id: payable.transactionId,
          },
        },
      ],
      has_more: false,
      url: "/v1/transfers",
    }));
    __setEmployeeTipPayablePersistFnForTests(async () => {
      throw new Error("simulated_persist_after_lookup");
    });
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: "tr_f1_should_not_create", amount: 900 };
    });
    const r1 = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(createCalls, 0, "lookup path must not create");
    assert.equal(r1.released, 0);
    assert.ok(r1.uncertain >= 1);
    const afterUncertain = await prisma.employeeTipPayable.findUnique({
      where: { id: payable.id },
    });
    assert.ok(
      releaseCreateBlockedByStoredMarker(afterUncertain?.lastTransferError),
      `durable block must remain, got ${afterUncertain?.lastTransferError}`,
    );
    assert.ok(
      afterUncertain?.lastTransferError?.includes("orphan_suspected") ||
        afterUncertain?.lastTransferError?.includes("post_reclaim_empty_lookup"),
      "actionable durable detail preserved",
    );
    __setEmployeeTipPayablePersistFnForTests(null);
    installMockEmptyEmployeeTipTransferList();
    const r2 = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(createCalls, 0, "empty lookup after persist fail must not authorize create");
    assert.equal(r2.released, 0);
    pass("fix-f1-durable-persist-fail", "Uncertain handler kept rel_durable; empty lookup blocked create");
    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- Fix F2: refund/dispute cannot erase durable release block ---
  {
    const { manager, business, employee, payable } = await seedHeldPayable(`${suffix}_f2`);
    const durable = formatDurableReleaseBlock("post_reclaim_empty_lookup", "refund_dispute");
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: {
        status: EmployeeTipPayableStatus.transferring,
        lastTransferError: durable,
      },
    });
    await applyRefundToEmployeePayable({
      transactionId: payable.transactionId,
      refundedCents: 100,
    });
    const afterRefund = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.ok(
      releaseCreateBlockedByStoredMarker(afterRefund?.lastTransferError),
      `refund must preserve durable marker, got ${afterRefund?.lastTransferError}`,
    );

    await applyDisputeToEmployeePayable({
      transactionId: payable.transactionId,
      stripeDisputeId: `dp_f2_${suffix}`,
      disputeAmountCents: 200,
      stripeStatus: "needs_response",
    });
    const afterDispute = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.ok(
      releaseCreateBlockedByStoredMarker(afterDispute?.lastTransferError),
      `dispute open must preserve durable marker, got ${afterDispute?.lastTransferError}`,
    );
    pass("fix-f2-refund-dispute", "Refund and dispute paths preserve rel_durable block");
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- Fix F3: legacy ops_uncertain post_reclaim blocks across attempts ---
  {
    const { manager, business, employee, payable } = await seedHeldPayable(`${suffix}_f3`);
    const legacyClaim = "legacytok12345678";
    const legacyMarker = `ops_uncertain:${legacyClaim}:post_reclaim_empty_lookup:pre_upgrade`;
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: {
        status: EmployeeTipPayableStatus.transferring,
        lastTransferError: legacyMarker,
      },
    });
    installMockEmptyEmployeeTipTransferList();
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: `tr_legacy_f3_${suffix}`, amount: 900 };
    });
    const first = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(createCalls, 0);
    assert.equal(first.released, 0);
    assert.ok(first.uncertain >= 1);
    const mid = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.ok(
      releaseCreateBlockedByStoredMarker(mid?.lastTransferError),
      `legacy or upgraded durable must block, got ${mid?.lastTransferError}`,
    );

    const second = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(createCalls, 0);
    assert.equal(second.released, 0);
    const finalRow = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.ok(
      releaseCreateBlockedByStoredMarker(finalRow?.lastTransferError),
      `still blocked after second empty lookup, got ${finalRow?.lastTransferError}`,
    );
    pass("fix-f3-legacy-post-reclaim", "Legacy post_reclaim marker blocks multiple releases with empty list");
    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // --- Marker composition near 180-char field limit ---
  {
    const durable = formatDurableReleaseBlock("post_reclaim_empty_lookup", "x".repeat(40));
    const token = "a".repeat(16);
    const longDetail = "d".repeat(120);
    const ops = formatEmployeeTipReleaseOpsState("uncertain", token, longDetail);
    const merged = mergeDurableWithOperationalMarker(durable, ops);
    assert.equal(merged.length, 180);
    assert.ok(merged.startsWith(DURABLE_RELEASE_BLOCK_PREFIX));
    const extracted = extractDurableReleaseSegment(merged);
    assert.ok(extracted?.startsWith(DURABLE_RELEASE_BLOCK_PREFIX));
    assert.ok(!operationTokenMatches(merged, token), "truncated ops tail must not match full token");
    const sepIdx = merged.indexOf(DURABLE_OPERATIONAL_SEP);
    if (sepIdx >= 0) {
      const opsTail = merged.slice(sepIdx + 1);
      assert.ok(
        !opsTail.endsWith(token),
        "ownership token must not survive intact when field is truncated",
      );
    }
    pass("marker-180-char", "Durable prefix survives merge truncation; truncated token fails ownership match");
  }

  console.log("\nemployee-transfer-expired-claim-inflight-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
