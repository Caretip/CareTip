/**
 * Employee analytics timezone consistency regressions (Pass 3).
 *
 *   npm run test:employee-analytics-timezone
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
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

async function seedEmployee(suffix: string, timezone: string) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const empUser = await prisma.user.create({
    data: {
      email: `ea-tz-emp-${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: `ea-tz-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `EA TZ ${suffix}`,
      slug: `ea-tz-${suffix}`,
      userId: manager.id,
      timezone,
      stripeAccountId: `acct_ea_tz_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: "EA TZ Emp",
      jobTitle: "Staff",
      businessId: business.id,
      userId: empUser.id,
    },
  });
  return { empUser, manager, business, employee };
}

async function createTip(params: {
  employeeId: string;
  businessId: string;
  amount: number;
  createdAt: Date;
  suffix: string;
}) {
  const tip = await prisma.transaction.create({
    data: {
      amount: params.amount,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_ea_tz_${params.suffix}`,
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
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.destination_employee,
      status: EmployeeTipPayableStatus.destination_settled,
      grossCents: Math.round(params.amount * 100),
      platformFeeCents: 100,
      payableCents: Math.round(params.amount * 100) - 100,
      transferredCents: Math.round(params.amount * 100) - 100,
      stripePaymentIntentId: `pi_ea_tz_${params.suffix}`,
    },
  });
  return tip;
}

async function main() {
  const suffix = `ea_tz_${Date.now()}`;
  const tz = "Europe/Berlin";
  const { empUser, manager, business, employee } = await seedEmployee(suffix, tz);

  const todayRange = businessUtcRangeForTimeframe("today", tz);
  assert.ok(todayRange);
  const justAfterMidnight = new Date(todayRange.startUtc.getTime() + 30 * 60 * 1000);
  const justBeforeMidnight = new Date(todayRange.startUtc.getTime() - 30 * 60 * 1000);
  const expectedDay = DateTime.fromJSDate(todayRange.startUtc, { zone: tz }).toFormat("yyyy-MM-dd");

  await createTip({
    employeeId: employee.id,
    businessId: business.id,
    amount: 25,
    createdAt: justAfterMidnight,
    suffix: `${suffix}_after`,
  });
  await createTip({
    employeeId: employee.id,
    businessId: business.id,
    amount: 15,
    createdAt: justBeforeMidnight,
    suffix: `${suffix}_before`,
  });

  const todayAnalytics = await loadEmployeeAnalyticsForUser(empUser.id, { period: "today" });
  assert.equal(todayAnalytics.businessTimezone, tz, "uses Business.timezone");
  assert.equal(todayAnalytics.metrics.tipCount, 1, "only post-midnight tip in today period");
  assert.equal(todayAnalytics.metrics.grossTipsEur, 25, "KPI gross for today");

  const chartGross = todayAnalytics.chartSeries.reduce((sum, row) => sum + row.grossEur, 0);
  assert.equal(chartGross, todayAnalytics.metrics.grossTipsEur, "chart gross matches KPI");
  assert.equal(todayAnalytics.chartSeries.length, 1, "single business-local day bucket");
  assert.equal(todayAnalytics.chartSeries[0]?.label, expectedDay, "bucket on correct business-local day");
  pass("today-midnight-boundary", "Post-midnight tip buckets on business-local today, not previous UTC day");

  const monthRange = businessUtcRangeForTimeframe("month", tz);
  assert.ok(monthRange);
  const monthAnalytics = await loadEmployeeAnalyticsForUser(empUser.id, { period: "month" });
  const monthChartGross = monthAnalytics.chartSeries.reduce((sum, row) => sum + row.grossEur, 0);
  assert.equal(monthChartGross, monthAnalytics.metrics.grossTipsEur, "month chart gross matches KPI");
  pass("month-kpi-chart-parity", "Monthly KPI totals match chart aggregation");

  await prisma.employeeTipPayable.deleteMany({ where: { businessId: business.id } });
  await prisma.transaction.deleteMany({ where: { businessId: business.id } });
  await prisma.employee.delete({ where: { id: employee.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.user.deleteMany({ where: { id: { in: [empUser.id, manager.id] } } });

  const suffixNz = `ea_tz_nz_${Date.now()}`;
  const nzTz = "Pacific/Auckland";
  const nz = await seedEmployee(suffixNz, nzTz);
  const nzRange = businessUtcRangeForTimeframe("today", nzTz);
  assert.ok(nzRange);
  await createTip({
    employeeId: nz.employee.id,
    businessId: nz.business.id,
    amount: 42,
    createdAt: new Date(nzRange.startUtc.getTime() + 60 * 1000),
    suffix: suffixNz,
  });
  const nzAnalytics = await loadEmployeeAnalyticsForUser(nz.empUser.id, { period: "today" });
  assert.equal(nzAnalytics.businessTimezone, nzTz, "non-European business timezone respected");
  pass("business-timezone-source", "Analytics loads timezone from Business.timezone");

  await prisma.employeeTipPayable.deleteMany({ where: { businessId: nz.business.id } });
  await prisma.transaction.deleteMany({ where: { businessId: nz.business.id } });
  await prisma.employee.delete({ where: { id: nz.employee.id } });
  await prisma.business.delete({ where: { id: nz.business.id } });
  await prisma.user.deleteMany({ where: { id: { in: [nz.empUser.id, nz.manager.id] } } });

  console.log("employee-analytics-timezone-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
