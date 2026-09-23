/**
 * transfer_failed recovery regressions (no live Stripe).
 *
 *   npm run test:employee-transfer-failed-recovery
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import {
  employeePayableActivityTimestamp,
  employeePayableSummaryForEmployee,
  isRecoverablePlatformHoldPayableStatus,
} from "../src/services/employeeTipPayable.service.js";
import {
  __setEmployeeTipTransferCreateFnForTests,
  releaseHeldPlatformPayablesForEmployee,
} from "../src/services/employeeTipRelease.service.js";

const backendRoot = process.cwd();

function read(relPath: string): string {
  return readFileSync(join(backendRoot, relPath), "utf8");
}

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

async function main() {
  assert.equal(isRecoverablePlatformHoldPayableStatus(EmployeeTipPayableStatus.held_platform), true);
  assert.equal(isRecoverablePlatformHoldPayableStatus(EmployeeTipPayableStatus.transfer_failed), true);
  assert.equal(isRecoverablePlatformHoldPayableStatus(EmployeeTipPayableStatus.transferred), false);

  const created = new Date("2026-09-23T09:12:36.060Z");
  const failed = new Date("2026-09-23T09:17:29.437Z");
  assert.equal(
    employeePayableActivityTimestamp({
      status: EmployeeTipPayableStatus.transfer_failed,
      createdAt: created,
      updatedAt: failed,
    }).toISOString(),
    failed.toISOString(),
  );
  pass("activity-timestamp", "transfer_failed uses updatedAt for display");

  assert.match(read("src/services/employeeTipPayable.service.ts"), /isRecoverablePlatformHoldPayableStatus\(row\.status\)/);
  assert.match(read("src/services/employeeTipRelease.service.ts"), /scheduleReleaseRecoverablePlatformPayablesForEmployee/);
  assert.match(read("src/controllers/employeeConnect.controller.ts"), /scheduleReleaseRecoverablePlatformPayablesForEmployee\(actor\.employeeId\)/);
  pass("wiring", "heldPlatformCents + schedule release wired in controller");

  const suffix = `tf_rec_${Date.now()}`;
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `tf-rec-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `TF Recovery ${suffix}`,
      slug: `tf-rec-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_tf_rec_biz_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: "TF Recovery Emp",
      jobTitle: "Staff",
      businessId: business.id,
      activationStatus: "active",
    },
  });
  await prisma.employeeStripeAccount.create({
    data: {
      employeeId: employee.id,
      stripeAccountId: `acct_tf_rec_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });

  const tip = await prisma.transaction.create({
    data: {
      amount: 60,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_tf_rec_${suffix}`,
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
      status: EmployeeTipPayableStatus.transfer_failed,
      grossCents: 6000,
      platformFeeCents: 649,
      payableCents: 5351,
      stripePaymentIntentId: `pi_tf_rec_${suffix}`,
      stripeChargeId: `ch_tf_rec_${suffix}`,
      lastTransferError: "capability_missing",
    },
  });

  const summary = await employeePayableSummaryForEmployee(employee.id);
  assert.equal(summary.heldPlatformCents, 5351, "transfer_failed must count toward heldPlatformCents");
  pass("held-platform-cents", "transfer_failed included in heldPlatformCents");

  let attempts = 0;
  __setEmployeeTipTransferCreateFnForTests(async (params, options) => {
    attempts += 1;
    assert.equal(params.amount, 5351);
    assert.equal(options.idempotencyKey, `emp_tip_release:${payable.id}`);
    return { id: `tr_tf_rec_${suffix}`, amount: 5351 };
  });

  const released = await releaseHeldPlatformPayablesForEmployee(employee.id);
  assert.equal(released.released, 1);
  const after = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
  assert.equal(after?.status, EmployeeTipPayableStatus.transferred);
  assert.equal(after?.stripeTransferId, `tr_tf_rec_${suffix}`);
  assert.equal(after?.transferredCents, 5351);
  assert.equal(attempts, 1);
  pass("retry-release", "transfer_failed payable retried once with stable idempotency key");

  const second = await releaseHeldPlatformPayablesForEmployee(employee.id);
  assert.equal(second.released, 0);
  assert.equal(attempts, 1, "no second Stripe call after transferred");
  pass("no-double-transfer", "already transferred payable not released again");

  await prisma.employeeTipPayable.deleteMany({ where: { employeeId: employee.id } });
  await prisma.transaction.deleteMany({ where: { employeeId: employee.id } });
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: employee.id } });
  await prisma.employee.delete({ where: { id: employee.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.user.delete({ where: { id: manager.id } });
  __setEmployeeTipTransferCreateFnForTests(null);

  console.log("employee-transfer-failed-recovery-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
