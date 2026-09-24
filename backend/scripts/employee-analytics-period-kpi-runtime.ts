/**
 * Employee analytics period KPI full-population regressions (P0 closure).
 *
 *   npm run test:employee-analytics-period-kpi
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
      email: `ea-kpi-emp-${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: `ea-kpi-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `EA KPI ${suffix}`,
      slug: `ea-kpi-${suffix}`,
      userId: manager.id,
      timezone: "Europe/Berlin",
      stripeAccountId: `acct_ea_kpi_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: "EA KPI Emp",
      jobTitle: "Staff",
      businessId: business.id,
      userId: empUser.id,
    },
  });
  return { empUser, manager, business, employee };
}

async function main() {
  const suffix = `ea_kpi_${Date.now()}`;
  const tz = "Europe/Berlin";
  const { empUser, manager, business, employee } = await seedEmployee(suffix);

  const monthRange = businessUtcRangeForTimeframe("month", tz);
  assert.ok(monthRange);
  const tipCount = 105;
  const amountEur = 10;
  const platformFeeCents = 100;
  const payableCents = Math.round(amountEur * 100) - platformFeeCents;
  const createdAt = new Date(monthRange.startUtc.getTime() + 60 * 60 * 1000);

  for (let i = 0; i < tipCount; i += 1) {
    const tip = await prisma.transaction.create({
      data: {
        amount: amountEur,
        status: TipStatus.success,
        stripePaymentIntentId: `pi_ea_kpi_${suffix}_${i}`,
        employeeId: employee.id,
        businessId: business.id,
        createdAt,
      },
    });
    await prisma.employeeTipPayable.create({
      data: {
        transactionId: tip.id,
        employeeId: employee.id,
        businessId: business.id,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        chargeModel: EmployeeTipChargeModel.destination_employee,
        status: EmployeeTipPayableStatus.destination_settled,
        grossCents: Math.round(amountEur * 100),
        platformFeeCents,
        payableCents,
        transferredCents: payableCents,
        stripePaymentIntentId: `pi_ea_kpi_${suffix}_${i}`,
      },
    });
  }

  const analytics = await loadEmployeeAnalyticsForUser(empUser.id, { period: "month" });
  const expectedGross = tipCount * amountEur;
  const chartGross = analytics.chartSeries.reduce((sum, row) => sum + row.grossEur, 0);

  assert.equal(analytics.metrics.tipCount, tipCount, "full-period tip count");
  assert.equal(analytics.metrics.grossTipsEur, expectedGross, "full-period gross tips");
  assert.equal(chartGross, analytics.metrics.grossTipsEur, "chart gross matches KPI");
  assert.equal(analytics.metrics.averageTipEur, amountEur, "full-period average");
  assert.equal(analytics.metrics.largestTipEur, amountEur, "full-period largest");
  assert.equal(analytics.metrics.feesExact, true, "all tips have payables");
  assert.equal(
    analytics.metrics.caretipFeesFromPayablesEur,
    (tipCount * platformFeeCents) / 100,
    "full-period frozen fees",
  );
  assert.equal(
    analytics.metrics.employeeEarningsEur,
    (tipCount * payableCents) / 100,
    "full-period direct_to_employee entitlement",
  );
  assert.equal(analytics.tipRecords.length, 100, "table remains capped at 100 recent tips");
  pass("month-over-100-tips", "Period KPIs use full population while tip table stays at 100 rows");

  await prisma.employeeTipPayable.deleteMany({ where: { businessId: business.id } });
  await prisma.transaction.deleteMany({ where: { businessId: business.id } });
  await prisma.employee.delete({ where: { id: employee.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.user.deleteMany({ where: { id: { in: [empUser.id, manager.id] } } });

  console.log("employee-analytics-period-kpi-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
