/**
 * Employee analytics final closure regressions (routing, refunds, table semantics).
 *
 *   npm run test:employee-analytics-final-closure
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
import { loadEmployeeAnalyticsForUser } from "../src/services/employeeAnalytics.service.js";
import { businessUtcRangeForTimeframe } from "../src/utils/businessTime.js";

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

async function seedEmployee(suffix: string) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const empUser = await prisma.user.create({
    data: {
      email: `ea-closure-emp-${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: `ea-closure-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `EA Closure ${suffix}`,
      slug: `ea-closure-${suffix}`,
      userId: manager.id,
      timezone: "Europe/Berlin",
      stripeAccountId: `acct_ea_closure_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: "EA Closure Emp",
      jobTitle: "Staff",
      businessId: business.id,
      userId: empUser.id,
    },
  });
  return { empUser, manager, business, employee };
}

async function createTip(params: {
  suffix: string;
  employeeId: string;
  businessId: string;
  amount: number;
  createdAt: Date;
  routingMode: EmployeeTipPayoutMode;
  payableCents: number;
  platformFeeCents: number;
  refundedCents?: number;
}) {
  const tip = await prisma.transaction.create({
    data: {
      amount: params.amount,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_ea_closure_${params.suffix}`,
      employeeId: params.employeeId,
      businessId: params.businessId,
      createdAt: params.createdAt,
    },
  });
  await prisma.employeeTipPayable.create({
    data: {
      transactionId: tip.id,
      employeeId: params.employeeId,
      businessId: params.businessId,
      routingMode: params.routingMode,
      chargeModel:
        params.routingMode === EmployeeTipPayoutMode.business_distribution
          ? EmployeeTipChargeModel.destination_business
          : EmployeeTipChargeModel.destination_employee,
      status:
        params.routingMode === EmployeeTipPayoutMode.business_distribution
          ? EmployeeTipPayableStatus.held_business
          : EmployeeTipPayableStatus.destination_settled,
      grossCents: Math.round(params.amount * 100),
      platformFeeCents: params.platformFeeCents,
      payableCents: params.payableCents,
      refundedCents: params.refundedCents ?? 0,
      transferredCents:
        params.routingMode === EmployeeTipPayoutMode.direct_to_employee
          ? params.payableCents
          : 0,
      stripePaymentIntentId: `pi_ea_closure_${params.suffix}`,
    },
  });
  return tip;
}

async function cleanup(ctx: {
  businessId: string;
  employeeId: string;
  userIds: string[];
}) {
  await prisma.employeeTipPayable.deleteMany({ where: { businessId: ctx.businessId } });
  await prisma.transaction.deleteMany({ where: { businessId: ctx.businessId } });
  await prisma.employee.delete({ where: { id: ctx.employeeId } });
  await prisma.business.delete({ where: { id: ctx.businessId } });
  await prisma.user.deleteMany({ where: { id: { in: ctx.userIds } } });
}

async function main() {
  const suffix = `ea_closure_${Date.now()}`;
  const tz = "Europe/Berlin";
  const { empUser, manager, business, employee } = await seedEmployee(suffix);
  const monthRange = businessUtcRangeForTimeframe("month", tz);
  assert.ok(monthRange);
  const createdAt = new Date(monthRange.startUtc.getTime() + 2 * 60 * 60 * 1000);

  await createTip({
    suffix: `${suffix}_direct`,
    employeeId: employee.id,
    businessId: business.id,
    amount: 50,
    createdAt,
    routingMode: EmployeeTipPayoutMode.direct_to_employee,
    platformFeeCents: 549,
    payableCents: 4451,
  });
  await createTip({
    suffix: `${suffix}_biz`,
    employeeId: employee.id,
    businessId: business.id,
    amount: 40,
    createdAt,
    routingMode: EmployeeTipPayoutMode.business_distribution,
    platformFeeCents: 449,
    payableCents: 3551,
  });

  const mixed = await loadEmployeeAnalyticsForUser(empUser.id, { period: "month" });
  const chartEarnings = mixed.chartSeries.reduce((sum, row) => sum + row.earningsEur, 0);
  assert.equal(mixed.metrics.employeeEarningsEur, 44.51, "KPI excludes business_distribution");
  assert.equal(chartEarnings, mixed.metrics.employeeEarningsEur, "chart earnings matches KPI routing");
  const bizRow = mixed.tipRecords.find((r) => r.routingMode === "business_distribution");
  assert.ok(bizRow);
  assert.equal(bizRow?.employeeEarningsEur, null, "table omits business_distribution as direct earnings");
  pass("mixed-routing", "Chart and KPI exclude business_distribution; table shows null earnings");

  await cleanup({ businessId: business.id, employeeId: employee.id, userIds: [empUser.id, manager.id] });

  const suffixRefund = `ea_closure_ref_${Date.now()}`;
  const refundCtx = await seedEmployee(suffixRefund);
  const refundAt = new Date(monthRange.startUtc.getTime() + 3 * 60 * 60 * 1000);
  const payableCents = 900;
  await createTip({
    suffix: `${suffixRefund}_none`,
    employeeId: refundCtx.employee.id,
    businessId: refundCtx.business.id,
    amount: 10,
    createdAt: refundAt,
    routingMode: EmployeeTipPayoutMode.direct_to_employee,
    platformFeeCents: 100,
    payableCents,
    refundedCents: 0,
  });
  await createTip({
    suffix: `${suffixRefund}_full`,
    employeeId: refundCtx.employee.id,
    businessId: refundCtx.business.id,
    amount: 10,
    createdAt: refundAt,
    routingMode: EmployeeTipPayoutMode.direct_to_employee,
    platformFeeCents: 100,
    payableCents,
    refundedCents: payableCents,
  });
  await createTip({
    suffix: `${suffixRefund}_partial`,
    employeeId: refundCtx.employee.id,
    businessId: refundCtx.business.id,
    amount: 10,
    createdAt: refundAt,
    routingMode: EmployeeTipPayoutMode.direct_to_employee,
    platformFeeCents: 100,
    payableCents,
    refundedCents: 300,
  });

  const refundAnalytics = await loadEmployeeAnalyticsForUser(refundCtx.empUser.id, {
    period: "month",
  });
  assert.equal(refundAnalytics.metrics.employeeEarningsEur, 15, "period earnings refund-adjusted");
  assert.equal(
    refundAnalytics.lifetimeMetrics.employeeEarningsEur,
    15,
    "lifetime and period earnings use same refund formula",
  );
  pass("refund-semantics", "Period earnings subtract refundedCents like lifetime metrics");

  await cleanup({
    businessId: refundCtx.business.id,
    employeeId: refundCtx.employee.id,
    userIds: [refundCtx.empUser.id, refundCtx.manager.id],
  });

  const suffix125 = `ea_closure_125_${Date.now()}`;
  const ctx125 = await seedEmployee(suffix125);
  const tip125At = new Date(monthRange.startUtc.getTime() + 4 * 60 * 60 * 1000);
  for (let i = 0; i < 125; i += 1) {
    const amount = i < 25 ? 5 : 10;
    await createTip({
      suffix: `${suffix125}_${i}`,
      employeeId: ctx125.employee.id,
      businessId: ctx125.business.id,
      amount,
      createdAt: tip125At,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      platformFeeCents: 100,
      payableCents: Math.round(amount * 100) - 100,
    });
  }
  const analytics125 = await loadEmployeeAnalyticsForUser(ctx125.empUser.id, { period: "month" });
  const expectedGross125 = 25 * 5 + 100 * 10;
  assert.equal(analytics125.metrics.tipCount, 125);
  assert.equal(analytics125.metrics.grossTipsEur, expectedGross125);
  assert.equal(analytics125.metrics.largestTipEur, 10);
  assert.equal(
    analytics125.chartSeries.reduce((s, r) => s + r.grossEur, 0),
    expectedGross125,
  );
  pass("125-tips", "Oldest 25 smaller tips included in full-period KPIs");

  await cleanup({
    businessId: ctx125.business.id,
    employeeId: ctx125.employee.id,
    userIds: [ctx125.empUser.id, ctx125.manager.id],
  });

  console.log("employee-analytics-final-closure-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
