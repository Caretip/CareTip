/**
 * Employee tip release failure injection — mocked Stripe, real PostgreSQL locks.
 *
 *   npm run test:employee-transfer-failure-injection
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
import { baseEmployeeTipReleaseIdempotencyKey } from "../src/lib/stripeTransferError.js";
import {
  __setEmployeeTipPayablePersistFnForTests,
  __setEmployeeTipTransferCreateFnForTests,
  reconcileEmployeeTipReleaseTransfer,
  releaseHeldPlatformPayablesForEmployee,
} from "../src/services/employeeTipRelease.service.js";
import {
  clearMockEmployeeTipStripeTransferList,
  installMockEmptyEmployeeTipTransferList,
} from "./lib/mockEmployeeTipStripeTransferList.js";

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

async function seedEmployee(suffix: string) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `inj-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `Inj ${suffix}`,
      slug: `inj-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_inj_biz_${suffix}`,
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
      stripeAccountId: `acct_inj_emp_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });
  return { manager, business, employee };
}

async function seedHeldPayable(
  employeeId: string,
  businessId: string,
  suffix: string,
  status: EmployeeTipPayableStatus,
  opts?: { updatedAt?: Date },
) {
  const tip = await prisma.transaction.create({
    data: {
      amount: 10,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_inj_${suffix}`,
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
      grossCents: 1000,
      platformFeeCents: 100,
      payableCents: 900,
      stripePaymentIntentId: `pi_inj_${suffix}`,
      stripeChargeId: `ch_inj_${suffix}`,
      updatedAt: opts?.updatedAt ?? new Date(),
    },
  });
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

async function main() {
  const suffix = `inj_${Date.now()}`;
  installMockEmptyEmployeeTipTransferList();

  // DB persist fails after Stripe succeeds → stays transferring, reconcile completes
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_db`);
    const payable = await seedHeldPayable(
      employee.id,
      business.id,
      `${suffix}_db`,
      EmployeeTipPayableStatus.held_platform,
    );
    let stripeCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async (params, options) => {
      stripeCalls += 1;
      assert.equal(options.idempotencyKey, baseEmployeeTipReleaseIdempotencyKey(payable.id));
      return { id: `tr_inj_db_${suffix}`, amount: params.amount ?? 0 };
    });
    let persistCalls = 0;
    __setEmployeeTipPayablePersistFnForTests(async () => {
      persistCalls += 1;
      if (persistCalls === 1) throw new Error("simulated_db_write_failure");
    });

    const first = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(first.released, 0);
    assert.equal(first.uncertain, 1);
    assert.equal(stripeCalls, 1);
    const mid = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(mid?.status, EmployeeTipPayableStatus.transferring);
    assert.equal(mid?.stripeTransferId, null);

    __setEmployeeTipPayablePersistFnForTests(null);
    const reconciled = await reconcileEmployeeTipReleaseTransfer({
      payableId: payable.id,
      employeeId: employee.id,
      destinationAccountId: `acct_inj_emp_${suffix}_db`,
    });
    assert.equal(reconciled, "reconciled");
    assert.equal(stripeCalls, 2, "reconcile reuses base idempotency key (mock counts as second call)");
    const after = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(after?.status, EmployeeTipPayableStatus.transferred);
    assert.equal(after?.stripeTransferId, `tr_inj_db_${suffix}`);
    pass("db-fail-then-reconcile", "Stripe success + DB fail leaves transferring; reconcile persists without new transfer");

    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Uncertain Stripe outcome → not transfer_failed; retry with same base key
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_timeout`);
    const payable = await seedHeldPayable(
      employee.id,
      business.id,
      `${suffix}_timeout`,
      EmployeeTipPayableStatus.held_platform,
    );
    let stripeCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async (_params, options) => {
      stripeCalls += 1;
      assert.equal(options.idempotencyKey, baseEmployeeTipReleaseIdempotencyKey(payable.id));
      if (stripeCalls === 1) {
        const err = new Error("Request timed out");
        (err as { type: string }).type = "StripeConnectionError";
        throw err;
      }
      return { id: `tr_inj_to_${suffix}`, amount: 900 };
    });

    const first = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(first.uncertain, 1);
    const mid = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(mid?.status, EmployeeTipPayableStatus.transferring);
    assert.notEqual(mid?.status, EmployeeTipPayableStatus.transfer_failed);

    const second = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(second.released, 1);
    assert.equal(stripeCalls, 2);
    const after = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(after?.stripeTransferId, `tr_inj_to_${suffix}`);
    pass("uncertain-then-retry", "Timeout keeps transferring; same base idempotency key on retry");

    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Concurrent release on one held payable
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_conc`);
    const payable = await seedHeldPayable(
      employee.id,
      business.id,
      `${suffix}_conc`,
      EmployeeTipPayableStatus.held_platform,
    );
    let stripeCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      stripeCalls += 1;
      return { id: `tr_inj_conc_${suffix}`, amount: 900 };
    });

    const [a, b] = await Promise.all([
      releaseHeldPlatformPayablesForEmployee(employee.id),
      releaseHeldPlatformPayablesForEmployee(employee.id),
    ]);
    assert.equal(stripeCalls, 1, "only one Stripe transfer for concurrent workers");
    assert.equal((a.released + b.released), 1);
    const after = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(after?.stripeTransferId, `tr_inj_conc_${suffix}`);
    pass("concurrent-held", "Concurrent release did not double-transfer");

    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Definite failure → transfer_failed; fresh retry key succeeds
  {
    installMockEmptyEmployeeTipTransferList();
    const { manager, business, employee } = await seedEmployee(`${suffix}_fail`);
    const failedAt = new Date("2026-02-01T12:00:00Z");
    const payable = await seedHeldPayable(
      employee.id,
      business.id,
      `${suffix}_fail`,
      EmployeeTipPayableStatus.transfer_failed,
      { updatedAt: failedAt },
    );
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: { lastTransferError: "capability_missing" },
    });
    const keys: string[] = [];
    __setEmployeeTipTransferCreateFnForTests(async (_params, options) => {
      keys.push(options.idempotencyKey);
      if (keys.length === 1) {
        const err = new Error("Insufficient permissions");
        (err as { type: string }).type = "StripeInvalidRequestError";
        throw err;
      }
      return { id: `tr_inj_fail_${suffix}`, amount: 900 };
    });

    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.released, 1);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], baseEmployeeTipReleaseIdempotencyKey(payable.id));
    assert.ok(keys[1].includes(":r"), "retry uses fresh idempotency key after definite base failure");
    pass("definite-fail-retry", "Genuine failure retried with fresh key after base reconcile attempt");

    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Recovery invoked twice on already transferred payable
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_twice`);
    await seedHeldPayable(
      employee.id,
      business.id,
      `${suffix}_twice`,
      EmployeeTipPayableStatus.transferred,
    );
    await prisma.employeeTipPayable.updateMany({
      where: { employeeId: employee.id },
      data: {
        status: EmployeeTipPayableStatus.transferred,
        stripeTransferId: `tr_already_${suffix}`,
        transferredCents: 900,
      },
    });
    let stripeCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      stripeCalls += 1;
      return { id: `tr_dup_${suffix}`, amount: 900 };
    });
    await releaseHeldPlatformPayablesForEmployee(employee.id);
    await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(stripeCalls, 0);
    pass("recovery-twice-transferred", "No Stripe call when already transferred");

    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  clearMockEmployeeTipStripeTransferList();
  console.log("\nemployee-transfer-failure-injection-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
