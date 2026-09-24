/**
 * P0 financial source-of-truth remediation regressions.
 *
 *   npm run test:financial-p0-remediation
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
import { loadBusinessFinancialMetrics } from "../src/services/businessFinancialMetrics.service.js";
import { loadBusinessFinancialSummaryForBusiness } from "../src/services/businessFinancialSummary.service.js";
import {
  createEmployeeTipPayableForSuccessfulTip,
  employeePayableTransferNotificationEligible,
  remainingPayableCents,
} from "../src/services/employeeTipPayable.service.js";
import { listGlobalTransactions } from "../src/services/platform.service.js";
import {
  createTipDistributionBatch,
  loadTipDistributionSummaryForBusiness,
} from "../src/services/tipDistribution.service.js";
import { calculateTipPlatformFeeCents } from "../src/config/fees.js";

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

function fail(id: string, msg: string) {
  console.error(`  ✗ ${id}: ${msg}`);
  process.exitCode = 1;
}

function approxCents(a: number, b: number, label: string) {
  assert.equal(a, b, `${label}: expected ${b} cents, got ${a}`);
}

async function seedBusiness(suffix: string) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `p0-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `P0 ${suffix}`,
      slug: `p0-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_p0_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: `P0 Emp ${suffix}`,
      jobTitle: "Staff",
      businessId: business.id,
      activationStatus: "active",
    },
  });
  return { manager, business, employee };
}

async function createHeldBusinessPayable(params: {
  suffix: string;
  businessId: string;
  employeeId: string;
  grossCents: number;
  platformFeeCents: number;
}) {
  const tip = await prisma.transaction.create({
    data: {
      amount: params.grossCents / 100,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_p0_${params.suffix}`,
      employeeId: params.employeeId,
      businessId: params.businessId,
    },
  });
  await prisma.$transaction(async (tx) => {
    await createEmployeeTipPayableForSuccessfulTip({
      tx,
      transactionId: tip.id,
      employeeId: params.employeeId,
      businessId: params.businessId,
      paymentIntentId: `pi_p0_${params.suffix}`,
      grossCents: params.grossCents,
      snapshot: {
        chargeModel: EmployeeTipChargeModel.destination_business,
        routingMode: EmployeeTipPayoutMode.business_distribution,
        destinationAccountId: `acct_p0_${params.businessId}`,
      },
      stripeChargeId: `ch_p0_${params.suffix}`,
      destinationTransferId: `tr_p0_${params.suffix}`,
    });
  });
  const payable = await prisma.employeeTipPayable.findUnique({ where: { transactionId: tip.id } });
  assert.ok(payable);
  await prisma.employeeTipPayable.update({
    where: { id: payable.id },
    data: { platformFeeCents: params.platformFeeCents },
  });
  return { tip, payable: { ...payable, platformFeeCents: params.platformFeeCents } };
}

async function testP01DistributionObligation(suffix: string) {
  const { manager, business, employee } = await seedBusiness(`${suffix}_p01`);
  const { payable } = await createHeldBusinessPayable({
    suffix: `${suffix}_a`,
    businessId: business.id,
    employeeId: employee.id,
    grossCents: 4000,
    platformFeeCents: 449,
  });
  const remaining = remainingPayableCents(payable);

  const metricsNoDist = await loadBusinessFinancialMetrics(business.id);
  const summaryNoDist = await loadBusinessFinancialSummaryForBusiness(business.id, { section: "ledger" });
  const tdNoDist = await loadTipDistributionSummaryForBusiness(business.id);
  approxCents(Math.round(metricsNoDist.employeeDistributionObligationEur * 100), remaining, "P0-1 no distribution metrics");
  approxCents(summaryNoDist.routing.heldBusinessCents, remaining, "P0-1 no distribution summary routing");
  approxCents(tdNoDist.totalToDistributeCents, remaining, "P0-1 no distribution tip distribution");
  pass("P0-1-no-distribution", "Summary matches Tip Distribution before distributions");

  const partialAmount = 1000;
  await createTipDistributionBatch({
    businessId: business.id,
    actorUserId: manager.id,
    idempotencyKey: `p0_${suffix}_partial`,
    items: [{ employeeId: employee.id, amountCents: partialAmount }],
  });
  const afterPartialRemaining = remaining - partialAmount;
  const metricsPartial = await loadBusinessFinancialMetrics(business.id);
  const summaryPartial = await loadBusinessFinancialSummaryForBusiness(business.id, { section: "ledger" });
  const tdPartial = await loadTipDistributionSummaryForBusiness(business.id);
  approxCents(Math.round(metricsPartial.employeeDistributionObligationEur * 100), afterPartialRemaining, "P0-1 partial metrics");
  approxCents(summaryPartial.routing.heldBusinessCents, afterPartialRemaining, "P0-1 partial summary");
  approxCents(tdPartial.totalToDistributeCents, afterPartialRemaining, "P0-1 partial tip distribution");
  pass("P0-1-partial-distribution", "Summary matches remaining after partial distribution");

  await createTipDistributionBatch({
    businessId: business.id,
    actorUserId: manager.id,
    idempotencyKey: `p0_${suffix}_full`,
    items: [{ employeeId: employee.id, amountCents: afterPartialRemaining }],
  });
  const metricsFull = await loadBusinessFinancialMetrics(business.id);
  const summaryFull = await loadBusinessFinancialSummaryForBusiness(business.id, { section: "ledger" });
  const tdFull = await loadTipDistributionSummaryForBusiness(business.id);
  approxCents(Math.round(metricsFull.employeeDistributionObligationEur * 100), 0, "P0-1 full metrics zero");
  approxCents(summaryFull.routing.heldBusinessCents, 0, "P0-1 full summary zero");
  approxCents(tdFull.totalToDistributeCents, 0, "P0-1 full tip distribution zero");
  pass("P0-1-full-distribution", "Obligation reaches zero after full distribution");

  const employee2 = await prisma.employee.create({
    data: {
      name: `P0 Emp2 ${suffix}`,
      jobTitle: "Staff",
      businessId: business.id,
      activationStatus: "active",
    },
  });
  const p2 = await createHeldBusinessPayable({
    suffix: `${suffix}_e2`,
    businessId: business.id,
    employeeId: employee2.id,
    grossCents: 2000,
    platformFeeCents: 200,
  });
  const p3 = await createHeldBusinessPayable({
    suffix: `${suffix}_e3`,
    businessId: business.id,
    employeeId: employee.id,
    grossCents: 1500,
    platformFeeCents: 150,
  });
  const aggregateRemaining =
    remainingPayableCents(p2.payable) + remainingPayableCents(p3.payable);
  const metricsMulti = await loadBusinessFinancialMetrics(business.id);
  const tdMulti = await loadTipDistributionSummaryForBusiness(business.id);
  approxCents(Math.round(metricsMulti.employeeDistributionObligationEur * 100), aggregateRemaining, "P0-1 multi-employee");
  approxCents(tdMulti.totalToDistributeCents, aggregateRemaining, "P0-1 multi-employee tip distribution");
  pass("P0-1-multiple-employees", "Aggregate obligation matches across employees");

  await prisma.employeeTipDistributionAllocation.deleteMany({ where: { businessId: business.id } });
  await prisma.employeeTipDistributionItem.deleteMany({ where: { businessId: business.id } });
  await prisma.employeeTipDistributionBatch.deleteMany({ where: { businessId: business.id } });
  await prisma.employeeTipPayable.deleteMany({ where: { businessId: business.id } });
  await prisma.transaction.deleteMany({ where: { businessId: business.id } });
  await prisma.employee.deleteMany({ where: { businessId: business.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.user.delete({ where: { id: manager.id } });
}

function testP02NotificationGate() {
  assert.equal(
    employeePayableTransferNotificationEligible({
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      status: EmployeeTipPayableStatus.destination_settled,
      payableCents: 4451,
      transferredCents: 4451,
      reversedCents: 0,
      refundedCents: 0,
    }),
    true,
    "direct destination_settled should notify",
  );
  assert.equal(
    employeePayableTransferNotificationEligible({
      routingMode: EmployeeTipPayoutMode.business_distribution,
      status: EmployeeTipPayableStatus.held_business,
      payableCents: 3551,
      transferredCents: 0,
      reversedCents: 0,
      refundedCents: 0,
    }),
    false,
    "business_distribution must not notify",
  );
  assert.equal(
    employeePayableTransferNotificationEligible({
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      status: EmployeeTipPayableStatus.held_platform,
      payableCents: 3551,
      transferredCents: 0,
      reversedCents: 0,
      refundedCents: 0,
    }),
    false,
    "untransferred direct payable must not notify",
  );

  const triggersPath = join(process.cwd(), "src/services/push/notification.triggers.ts");
  const triggersSource = readFileSync(triggersPath, "utf8");
  assert.ok(
    !triggersSource.includes("payoutStatus"),
    "notification trigger must not reference Transaction.payoutStatus",
  );
  pass("P0-2-notification-gate", "Authoritative payable state gates payout notifications");
}

async function testP03PlatformAdminFee(suffix: string) {
  const { business, employee } = await seedBusiness(`${suffix}_p03`);
  const historicalFeeCents = 321;
  const grossCents = 5000;
  const { tip } = await createHeldBusinessPayable({
    suffix: `${suffix}_fee`,
    businessId: business.id,
    employeeId: employee.id,
    grossCents,
    platformFeeCents: historicalFeeCents,
  });

  const recalculated = calculateTipPlatformFeeCents(grossCents);
  assert.notEqual(recalculated, historicalFeeCents, "test fee must differ from current config for regression");

  const { items } = await listGlobalTransactions({ take: 500, skip: 0, q: tip.id });
  const row = items.find((item) => item.id === tip.id);
  assert.ok(row, "platform transaction row exists");
  assert.equal(row.caretipFeeEur, historicalFeeCents / 100, "fee from persisted platformFeeCents");
  assert.notEqual(row.caretipFeeEur, recalculated / 100, "fee must not follow current fee config");
  assert.equal(row.payoutStatus, EmployeeTipPayableStatus.held_business, "tip ledger status from payable");

  const legacyTip = await prisma.transaction.create({
    data: {
      amount: 12,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_p0_legacy_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
      payoutStatus: "pending",
    },
  });
  const { items: legacyItems } = await listGlobalTransactions({
    take: 500,
    skip: 0,
    q: legacyTip.id,
  });
  const legacyRow = legacyItems.find((item) => item.id === legacyTip.id);
  assert.ok(legacyRow);
  assert.equal(legacyRow.caretipFeeEur, null, "missing payable must not fabricate fee");
  assert.equal(legacyRow.netToStaffEur, null, "missing payable must not fabricate net");
  assert.equal(legacyRow.payoutStatus, "no_payable", "missing payable identified explicitly");
  pass("P0-3-platform-fee", "Platform admin uses persisted platformFeeCents");

  await prisma.employeeTipPayable.deleteMany({ where: { businessId: business.id } });
  await prisma.transaction.deleteMany({ where: { businessId: business.id } });
  await prisma.employee.delete({ where: { id: employee.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.user.deleteMany({ where: { email: { contains: `p0-mgr-${suffix}_p03` } } });
}

async function main() {
  const suffix = `p0_${Date.now()}`;
  await testP01DistributionObligation(suffix);
  testP02NotificationGate();
  await testP03PlatformAdminFee(suffix);
  console.log("financial-p0-remediation-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
