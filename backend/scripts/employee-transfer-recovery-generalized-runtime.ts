/**
 * GENERALIZED EMPLOYEE TRANSFER RECOVERY PROOF — no Charline-specific logic.
 *
 *   npm run test:employee-transfer-recovery-generalized
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
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
import { buildEmployeeTipReleaseIdempotencyKey } from "../src/lib/stripeTransferError.js";
import {
  __setEmployeeTipTransferCreateFnForTests,
  releaseHeldPlatformPayablesForEmployee,
} from "../src/services/employeeTipRelease.service.js";

type TransferCall = {
  params: { amount: number; destination: string; metadata?: Record<string, string> };
  options: { idempotencyKey: string };
};

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

const proof = {
  employeeFixtures: 0,
  retryScenarios: 0,
  duplicateScenarios: 0,
  businessDistributionExclusions: 0,
  idempotencyConflictScenarios: 0,
  unknownOutcomeScenarios: 0,
  finalTransferCounts: 0,
};

async function seedEmployee(suffix: string, connectReady = true) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `gen-rec-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `Gen Rec ${suffix}`,
      slug: `gen-rec-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_gen_rec_biz_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employeeUser = await prisma.user.create({
    data: {
      email: `gen-rec-emp-${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: `Employee ${suffix}`,
      jobTitle: "Server",
      businessId: business.id,
      userId: employeeUser.id,
    },
  });
  if (connectReady) {
    await prisma.employeeStripeAccount.create({
      data: {
        employeeId: employee.id,
        stripeAccountId: `acct_gen_rec_emp_${suffix}`,
        stripeConnectStatus: StripeConnectStatus.ready,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: true,
      },
    });
  }
  return { manager, business, employee };
}

async function seedPlatformHoldPayable(
  employeeId: string,
  businessId: string,
  suffix: string,
  status: EmployeeTipPayableStatus,
  opts?: { updatedAt?: Date; stripeTransferId?: string; transferredCents?: number },
) {
  const tip = await prisma.transaction.create({
    data: {
      amount: 42,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_gen_${suffix}`,
      employeeId,
      businessId,
    },
  });
  return prisma.employeeTipPayable.create({
    data: {
      transactionId: tip.id,
      employeeId,
      businessId,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status,
      grossCents: 4200,
      platformFeeCents: 469,
      payableCents: 3731,
      transferredCents: opts?.transferredCents ?? 0,
      stripeTransferId: opts?.stripeTransferId ?? null,
      stripePaymentIntentId: `pi_gen_${suffix}`,
      stripeChargeId: `ch_gen_${suffix}`,
      updatedAt: opts?.updatedAt ?? new Date(),
    },
  });
}

async function cleanup(ctx: {
  employee: { id: string; userId: string | null };
  businessId: string;
  managerId: string;
}) {
  await prisma.employeeTipPayable.deleteMany({ where: { employeeId: ctx.employee.id } });
  await prisma.transaction.deleteMany({ where: { employeeId: ctx.employee.id } });
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: ctx.employee.id } });
  await prisma.employee.delete({ where: { id: ctx.employee.id } });
  await prisma.business.delete({ where: { id: ctx.businessId } });
  const userIds = [ctx.managerId, ctx.employee.userId].filter((id): id is string => Boolean(id));
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  const suffix = `gen_${Date.now()}`;

  // CASE A — first fail, later ready, retry succeeds (one transfer)
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_a`);
    proof.employeeFixtures += 1;
    const payable = await seedPlatformHoldPayable(
      employee.id,
      business.id,
      `${suffix}_a`,
      EmployeeTipPayableStatus.transfer_failed,
      { updatedAt: new Date("2026-01-02T10:00:00Z") },
    );
    const calls: TransferCall[] = [];
    __setEmployeeTipTransferCreateFnForTests(async (params, options) => {
      calls.push({ params: params as TransferCall["params"], options });
      return { id: `tr_gen_a_${suffix}`, amount: params.amount ?? 0 };
    });
    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.released, 1);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].options.idempotencyKey,
      buildEmployeeTipReleaseIdempotencyKey(payable.id, {
        status: EmployeeTipPayableStatus.transfer_failed,
        updatedAt: payable.updatedAt,
      }),
    );
    proof.retryScenarios += 1;
    proof.finalTransferCounts += 1;
    pass("case-a", "destination later ready → one successful transfer");
    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({ employee, businessId: business.id, managerId: manager.id });
  }

  // CASE B — idempotency conflict on old key, fresh key succeeds
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_b`);
    proof.employeeFixtures += 1;
    const failedAt = new Date("2026-01-03T11:00:00Z");
    const payable = await seedPlatformHoldPayable(
      employee.id,
      business.id,
      `${suffix}_b`,
      EmployeeTipPayableStatus.transfer_failed,
      { updatedAt: failedAt },
    );
    const oldKey = `emp_tip_release:${payable.id}`;
    const newKey = buildEmployeeTipReleaseIdempotencyKey(payable.id, {
      status: EmployeeTipPayableStatus.transfer_failed,
      updatedAt: failedAt,
    });
    assert.notEqual(oldKey, newKey);
    let calls = 0;
    __setEmployeeTipTransferCreateFnForTests(async (_params, options) => {
      calls += 1;
      if (options.idempotencyKey === oldKey) {
        const err = new Error("Keys for idempotent requests can only be used with the same parameters");
        (err as { type: string }).type = "StripeIdempotencyError";
        throw err;
      }
      return { id: `tr_gen_b_${suffix}`, amount: 3731 };
    });
    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.released, 1);
    assert.equal(calls, 1);
    proof.idempotencyConflictScenarios += 1;
    proof.retryScenarios += 1;
    proof.finalTransferCounts += 1;
    pass("case-b", "fresh retry key avoids stale idempotency conflict");
    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({ employee, businessId: business.id, managerId: manager.id });
  }

  // CASE C — repeated failures, no duplicate transfer
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_c`);
    proof.employeeFixtures += 1;
    await seedPlatformHoldPayable(
      employee.id,
      business.id,
      `${suffix}_c`,
      EmployeeTipPayableStatus.transfer_failed,
      { updatedAt: new Date("2026-01-04T12:00:00Z") },
    );
    let calls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      calls += 1;
      throw new Error("transfers capability missing");
    });
    await releaseHeldPlatformPayablesForEmployee(employee.id);
    const after = await prisma.employeeTipPayable.findFirst({
      where: { employeeId: employee.id },
    });
    assert.equal(after?.status, EmployeeTipPayableStatus.transfer_failed);
    assert.equal(after?.transferredCents, 0);
    assert.equal(calls, 1);
    proof.retryScenarios += 1;
    pass("case-c", "retry failure leaves payable owed, no transfer created");
    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({ employee, businessId: business.id, managerId: manager.id });
  }

  // CASE D — already transferred, no second transfer
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_d`);
    proof.employeeFixtures += 1;
    await seedPlatformHoldPayable(
      employee.id,
      business.id,
      `${suffix}_d`,
      EmployeeTipPayableStatus.transferred,
      { stripeTransferId: `tr_already_${suffix}`, transferredCents: 3731 },
    );
    let calls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      calls += 1;
      return { id: `tr_dup_${suffix}`, amount: 3731 };
    });
    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.released, 0);
    assert.equal(calls, 0);
    proof.duplicateScenarios += 1;
    pass("case-d", "already transferred payable skipped");
    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({ employee, businessId: business.id, managerId: manager.id });
  }

  // CASE E — business_distribution never released via employee transfer
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_e`);
    proof.employeeFixtures += 1;
    const tip = await prisma.transaction.create({
      data: {
        amount: 40,
        status: TipStatus.success,
        stripePaymentIntentId: `pi_gen_e_${suffix}`,
        employeeId: employee.id,
        businessId: business.id,
      },
    });
    await prisma.employeeTipPayable.create({
      data: {
        transactionId: tip.id,
        employeeId: employee.id,
        businessId: business.id,
        routingMode: EmployeeTipPayoutMode.business_distribution,
        chargeModel: EmployeeTipChargeModel.destination_business,
        status: EmployeeTipPayableStatus.held_business,
        grossCents: 4000,
        platformFeeCents: 449,
        payableCents: 3551,
        stripePaymentIntentId: `pi_gen_e_${suffix}`,
      },
    });
    let calls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      calls += 1;
      return { id: `tr_bad_${suffix}`, amount: 3551 };
    });
    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.attempted, 0);
    assert.equal(calls, 0);
    proof.businessDistributionExclusions += 1;
    pass("case-e", "business_distribution excluded from employee release");
    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({ employee, businessId: business.id, managerId: manager.id });
  }

  // CASE F — not recipient-ready, no transfer attempt
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_f`, false);
    proof.employeeFixtures += 1;
    await seedPlatformHoldPayable(
      employee.id,
      business.id,
      `${suffix}_f`,
      EmployeeTipPayableStatus.transfer_failed,
    );
    let calls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      calls += 1;
      return { id: `tr_bad_${suffix}`, amount: 3731 };
    });
    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.attempted, 0);
    assert.equal(calls, 0);
    pass("case-f", "not recipient-ready → no unsafe transfer attempt");
    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({ employee, businessId: business.id, managerId: manager.id });
  }

  // CASE G — duplicate invocation with same retry key does not double-transfer
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_g`);
    proof.employeeFixtures += 1;
    const failedAt = new Date("2026-01-05T14:00:00Z");
    const payable = await seedPlatformHoldPayable(
      employee.id,
      business.id,
      `${suffix}_g`,
      EmployeeTipPayableStatus.transfer_failed,
      { updatedAt: failedAt },
    );
    const retryKey = buildEmployeeTipReleaseIdempotencyKey(payable.id, {
      status: EmployeeTipPayableStatus.transfer_failed,
      updatedAt: failedAt,
    });
    let calls = 0;
    __setEmployeeTipTransferCreateFnForTests(async (_params, options) => {
      calls += 1;
      assert.equal(options.idempotencyKey, retryKey);
      return { id: `tr_gen_g_${suffix}`, amount: 3731 };
    });
    const first = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(first.released, 1);
    const second = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(second.released, 0);
    assert.equal(calls, 1);
    proof.duplicateScenarios += 1;
    proof.unknownOutcomeScenarios += 1;
    proof.finalTransferCounts += 1;
    pass("case-g", "duplicate recovery invocation does not create second transfer");
    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({ employee, businessId: business.id, managerId: manager.id });
  }

  // Prove no Charline IDs in production release path
  const releaseSrc = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../src/services/employeeTipRelease.service.ts", import.meta.url), "utf8"),
  );
  const transferErrSrc = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../src/lib/stripeTransferError.ts", import.meta.url), "utf8"),
  );
  for (const pattern of [
    /cmtlevnof/,
    /cmudvx61/,
    /tr_3UIm/,
    /acct_1UImFh/,
    /Charline/i,
    /5351/,
  ]) {
    assert.ok(!pattern.test(releaseSrc), `production release must not contain ${pattern}`);
    assert.ok(!pattern.test(transferErrSrc), `stripeTransferError must not contain ${pattern}`);
  }
  pass("no-charline-hardcode", "production transfer recovery has zero Charline-specific logic");

  console.log("\n=== GENERALIZED EMPLOYEE TRANSFER RECOVERY PROOF ===");
  console.log(JSON.stringify(proof, null, 2));
  console.log("employee-transfer-recovery-generalized-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
