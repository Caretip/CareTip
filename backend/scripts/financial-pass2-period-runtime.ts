/**
 * Pass 2 period-boundary consistency regressions.
 *
 *   npm run test:financial-pass2-period
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
import { loadBusinessFinancialMetrics } from "../src/services/businessFinancialMetrics.service.js";
import { businessUtcRangeForTimeframe } from "../src/utils/businessTime.js";

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

async function main() {
  const suffix = `p2_period_${Date.now()}`;
  const tz = "Europe/Berlin";
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `p2-period-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `P2 Period ${suffix}`,
      slug: `p2-period-${suffix}`,
      userId: manager.id,
      timezone: tz,
      stripeAccountId: `acct_p2_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: "P2 Emp",
      jobTitle: "Staff",
      businessId: business.id,
    },
  });

  const range = businessUtcRangeForTimeframe("month", tz);
  assert.ok(range);
  const startUtc = range.startUtc;
  const endUtc = range.endUtc;
  const beforeStart = DateTime.fromJSDate(startUtc).minus({ milliseconds: 1 }).toJSDate();
  const atStart = startUtc;
  const afterStart = DateTime.fromJSDate(startUtc).plus({ milliseconds: 1 }).toJSDate();
  const atEnd = endUtc;
  const afterEnd = DateTime.fromJSDate(endUtc).plus({ milliseconds: 1 }).toJSDate();

  async function seedTip(createdAt: Date, amount: number, label: string) {
    const tip = await prisma.transaction.create({
      data: {
        amount,
        status: TipStatus.success,
        stripePaymentIntentId: `pi_p2_${label}_${suffix}`,
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
        routingMode: EmployeeTipPayoutMode.business_distribution,
        chargeModel: EmployeeTipChargeModel.destination_business,
        status: EmployeeTipPayableStatus.held_business,
        grossCents: Math.round(amount * 100),
        platformFeeCents: 100,
        payableCents: Math.round(amount * 100) - 100,
        createdAt: DateTime.fromJSDate(createdAt).plus({ hours: 2 }).toJSDate(),
        stripePaymentIntentId: `pi_p2_${label}_${suffix}`,
      },
    });
    return tip;
  }

  await seedTip(beforeStart, 10, "before");
  await seedTip(atStart, 20, "start");
  await seedTip(afterStart, 30, "after");
  await seedTip(atEnd, 40, "end");
  await seedTip(afterEnd, 50, "after_end");

  const metrics = await loadBusinessFinancialMetrics(business.id, {
    period: "month",
    businessTimezone: tz,
  });
  assert.equal(metrics.tipCount, 3, "tips at start/after/end in month");
  assert.equal(metrics.totalCustomerTipsEur, 90, "gross tips in period");
  assert.equal(metrics.feesExact, true, "payables align to tip period via transaction.createdAt");
  assert.equal(metrics.caretipFeesEur, 3, "frozen platform fees from payables");
  pass("period-boundary", "Tips and payables use transaction tip date for period scope");

  await prisma.employeeTipPayable.deleteMany({ where: { businessId: business.id } });
  await prisma.transaction.deleteMany({ where: { businessId: business.id } });
  await prisma.employee.delete({ where: { id: employee.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.user.delete({ where: { id: manager.id } });

  console.log("financial-pass2-period-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
