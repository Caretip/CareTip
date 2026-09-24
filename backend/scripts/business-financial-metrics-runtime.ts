/**
 * Business financial metrics + reconciliation regressions.
 *
 *   npm run test:business-financial-metrics
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
import { loadBusinessFinancialMetrics } from "../src/services/businessFinancialMetrics.service.js";
import { reconcileBusinessPayables } from "../src/services/businessPayoutReconciliation.service.js";

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

function approx(a: number, b: number, label: string) {
  assert.ok(Math.abs(a - b) < 0.011, `${label}: expected ${b}, got ${a}`);
}

async function main() {
  const suffix = `biz_fin_${Date.now()}`;
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `biz-fin-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `Biz Fin ${suffix}`,
      slug: `biz-fin-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_biz_fin_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution,
    },
  });
  const empUser = await prisma.user.create({
    data: {
      email: `biz-fin-emp-${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: "Biz Fin Emp",
      jobTitle: "Server",
      businessId: business.id,
      userId: empUser.id,
    },
  });

  const tipDirect = await prisma.transaction.create({
    data: {
      amount: 50,
      status: TipStatus.success,
      employeeId: employee.id,
      businessId: business.id,
      stripePaymentIntentId: `pi_biz_fin_dir_${suffix}`,
    },
  });
  await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipDirect.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.destination_employee,
      status: EmployeeTipPayableStatus.destination_settled,
      grossCents: 5000,
      platformFeeCents: 549,
      payableCents: 4451,
      transferredCents: 4451,
      stripePaymentIntentId: `pi_biz_fin_dir_${suffix}`,
    },
  });

  const tipBiz = await prisma.transaction.create({
    data: {
      amount: 40,
      status: TipStatus.success,
      employeeId: employee.id,
      businessId: business.id,
      stripePaymentIntentId: `pi_biz_fin_biz_${suffix}`,
    },
  });
  await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipBiz.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.business_distribution,
      chargeModel: EmployeeTipChargeModel.destination_business,
      status: EmployeeTipPayableStatus.held_business,
      grossCents: 4000,
      platformFeeCents: 449,
      payableCents: 3551,
      stripePaymentIntentId: `pi_biz_fin_biz_${suffix}`,
    },
  });

  const metrics = await loadBusinessFinancialMetrics(business.id);
  approx(metrics.totalCustomerTipsEur, 90, "total customer tips");
  approx(metrics.directToEmployeeGrossTipsEur, 50, "direct gross excluded from distribution");
  approx(metrics.businessDistributionGrossTipsEur, 40, "business distribution gross");
  approx(metrics.employeeDistributionObligationEur, 35.51, "held_business obligation");
  assert.ok(metrics.directToEmployeeGrossTipsEur !== metrics.employeeDistributionObligationEur);
  pass("metrics-routing", "direct and business_distribution separated");

  const recon = await reconcileBusinessPayables(business.id);
  const bizRow = recon.rows.find((r) => r.routingMode === "business_distribution");
  assert.equal(bizRow?.status, "BUSINESS_DISTRIBUTION");
  pass("reconciliation", "business_distribution classified separately");

  await prisma.employeeTipPayable.deleteMany({ where: { businessId: business.id } });
  await prisma.transaction.deleteMany({ where: { businessId: business.id } });
  await prisma.employee.delete({ where: { id: employee.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.user.deleteMany({ where: { id: { in: [manager.id, empUser.id] } } });

  console.log("business-financial-metrics-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
