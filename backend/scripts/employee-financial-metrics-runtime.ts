/**
 * Employee financial metrics regressions — synthetic fixtures only (no Charline mutation).
 *
 *   npm run test:employee-financial-metrics
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
} from "@prisma/client";
import { buildEmployeeTipReleaseIdempotencyKey, formatStripeTransferError } from "../src/lib/stripeTransferError.js";
import { loadEmployeeFinancialMetrics } from "../src/services/employeeFinancialMetrics.service.js";
import { prisma } from "../src/prisma.js";

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

function approx(a: number, b: number, label: string) {
  assert.ok(Math.abs(a - b) < 0.011, `${label}: expected ${b}, got ${a}`);
}

async function main() {
  assert.equal(
    buildEmployeeTipReleaseIdempotencyKey("pay_1", {
      status: EmployeeTipPayableStatus.held_platform,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    }),
    "emp_tip_release:pay_1",
  );
  const failedAt = new Date("2026-09-23T09:17:29.437Z");
  assert.equal(
    buildEmployeeTipReleaseIdempotencyKey("pay_1", {
      status: EmployeeTipPayableStatus.transfer_failed,
      updatedAt: failedAt,
    }),
    `emp_tip_release:pay_1:r${failedAt.getTime()}`,
  );
  pass("idempotency-key", "retry uses failure timestamp suffix");

  const formatted = formatStripeTransferError({
    type: "StripeIdempotencyError",
    code: "idempotency_key_in_use",
    param: "idempotency_key",
    requestId: "req_test",
    message: "Keys for idempotent requests can only be used with the same parameters",
  });
  assert.match(formatted, /IdempotencyError/);
  assert.match(formatted, /req_test/);
  pass("stripe-error-format", "structured Stripe error preserved in compact form");

  const suffix = `fin_met_${Date.now()}`;
  const manager = await prisma.user.create({
    data: {
      email: `fin-met-${suffix}@example.com`,
      passwordHash: "x",
      role: "MANAGER",
      emailVerified: true,
    },
  });
  const biz = await prisma.business.create({
    data: {
      name: `Fin Met ${suffix}`,
      slug: `fin-met-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_fin_met_${suffix}`,
      stripeConnectStatus: "ready",
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const empUser = await prisma.user.create({
    data: {
      email: `fin-met-emp-${suffix}@example.com`,
      passwordHash: "x",
      role: "EMPLOYEE",
      emailVerified: true,
    },
  });
  const emp = await prisma.employee.create({
    data: {
      name: "Fin Met Emp",
      jobTitle: "Server",
      businessId: biz.id,
      userId: empUser.id,
    },
  });

  const tipGross = await prisma.transaction.create({
    data: {
      amount: 60,
      status: "success",
      employeeId: emp.id,
      businessId: biz.id,
      stripePaymentIntentId: `pi_fin_gross_${suffix}`,
    },
  });
  await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipGross.id,
      employeeId: emp.id,
      businessId: biz.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.transfer_failed,
      grossCents: 6000,
      platformFeeCents: 649,
      payableCents: 5351,
      stripePaymentIntentId: `pi_fin_gross_${suffix}`,
    },
  });
  const tipDest = await prisma.transaction.create({
    data: {
      amount: 50,
      status: "success",
      employeeId: emp.id,
      businessId: biz.id,
      stripePaymentIntentId: `pi_fin_dest_${suffix}`,
    },
  });
  await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipDest.id,
      employeeId: emp.id,
      businessId: biz.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.destination_employee,
      status: EmployeeTipPayableStatus.destination_settled,
      grossCents: 5000,
      platformFeeCents: 549,
      payableCents: 4451,
      transferredCents: 4451,
      stripePaymentIntentId: `pi_fin_dest_${suffix}`,
    },
  });
  const tipBiz = await prisma.transaction.create({
    data: {
      amount: 40,
      status: "success",
      employeeId: emp.id,
      businessId: biz.id,
      stripePaymentIntentId: `pi_fin_biz_${suffix}`,
    },
  });
  await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipBiz.id,
      employeeId: emp.id,
      businessId: biz.id,
      routingMode: EmployeeTipPayoutMode.business_distribution,
      chargeModel: EmployeeTipChargeModel.destination_business,
      status: EmployeeTipPayableStatus.held_business,
      grossCents: 4000,
      platformFeeCents: 449,
      payableCents: 3551,
      stripePaymentIntentId: `pi_fin_biz_${suffix}`,
    },
  });
  const tipLegacy = await prisma.transaction.create({
    data: {
      amount: 15,
      status: "success",
      employeeId: emp.id,
      businessId: biz.id,
      stripePaymentIntentId: `pi_fin_legacy_${suffix}`,
    },
  });
  void tipLegacy;

  const synth = await loadEmployeeFinancialMetrics(emp.id);
  approx(synth.grossTipsEur, 165, "synthetic gross");
  approx(synth.employeeEarningsEur, 98.02, "synthetic net (5351+4451)/100");
  approx(synth.paidToStripeEur, 44.51, "synthetic paid");
  approx(synth.pendingReleaseEur, 53.51, "synthetic pending");
  approx(synth.employeeEarningsEur, synth.paidToStripeEur + synth.pendingReleaseEur, "synthetic reconcile");
  approx(synth.prePayableGrossTipsEur, 15, "legacy tip without payable");
  assert.ok(synth.grossTipsEur > synth.employeeEarningsEur, "gross must exceed net earnings");
  pass("synthetic-fixture", "business_distribution excluded; failed counts pending; legacy gross isolated");

  await prisma.employeeTipPayable.deleteMany({ where: { employeeId: emp.id } });
  await prisma.transaction.deleteMany({ where: { employeeId: emp.id } });
  await prisma.employee.delete({ where: { id: emp.id } });
  await prisma.business.delete({ where: { id: biz.id } });
  await prisma.user.deleteMany({ where: { id: { in: [empUser.id, manager.id] } } });

  console.log("employee-financial-metrics-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
