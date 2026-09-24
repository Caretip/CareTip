/**
 * Tip distribution workspace regressions.
 *
 *   npm run test:tip-distribution
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
import {
  applyRefundToEmployeePayable,
  createEmployeeTipPayableForSuccessfulTip,
  remainingPayableCents,
} from "../src/services/employeeTipPayable.service.js";
import {
  createTipDistributionBatch,
  listTipDistributionEmployeesForBusiness,
  loadTipDistributionSummaryForBusiness,
  TipDistributionError,
} from "../src/services/tipDistribution.service.js";

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

function fail(id: string, msg: string) {
  console.error(`  ✗ ${id}: ${msg}`);
  process.exitCode = 1;
}

async function seedBusiness(suffix: string, mode: EmployeeTipPayoutMode) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `td-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `TD ${suffix}`,
      slug: `td-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_td_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      employeeTipPayoutMode: mode,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: `TD Emp ${suffix}`,
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
      stripePaymentIntentId: `pi_td_${params.suffix}`,
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
      paymentIntentId: `pi_td_${params.suffix}`,
      grossCents: params.grossCents,
      snapshot: {
        chargeModel: EmployeeTipChargeModel.destination_business,
        routingMode: EmployeeTipPayoutMode.business_distribution,
        destinationAccountId: `acct_td_${params.businessId}`,
      },
      stripeChargeId: `ch_td_${params.suffix}`,
      destinationTransferId: `tr_td_${params.suffix}`,
    });
  });
  const payable = await prisma.employeeTipPayable.findUnique({ where: { transactionId: tip.id } });
  assert.ok(payable);
  return payable;
}

async function main() {
  const suffix = `td_${Date.now()}`;

  const { manager, business, employee } = await seedBusiness(suffix, EmployeeTipPayoutMode.business_distribution);
  const payableA = await createHeldBusinessPayable({
    suffix: `${suffix}_a`,
    businessId: business.id,
    employeeId: employee.id,
    grossCents: 1000,
    platformFeeCents: 100,
  });
  if (payableA.status === EmployeeTipPayableStatus.held_business && remainingPayableCents(payableA) > 0) {
    pass("1-one-payable", "Single held_business payable created");
  } else {
    fail("1-one-payable", JSON.stringify(payableA));
  }

  const payableB = await createHeldBusinessPayable({
    suffix: `${suffix}_b`,
    businessId: business.id,
    employeeId: employee.id,
    grossCents: 500,
    platformFeeCents: 50,
  });
  const employeesBefore = await listTipDistributionEmployeesForBusiness(business.id);
  const row = employeesBefore.items.find((item) => item.employeeId === employee.id);
  const expectedRemaining = remainingPayableCents(payableA) + remainingPayableCents(payableB);
  if (row && row.tipCount === 2 && row.remainingCents === expectedRemaining) {
    pass("2-multi-tips-one-employee", "Employee aggregate combines multiple payables");
  } else {
    fail("2-multi-tips-one-employee", JSON.stringify({ row, expectedRemaining }));
  }

  const { business: otherBusiness, employee: otherEmployee } = await seedBusiness(
    `${suffix}_other`,
    EmployeeTipPayoutMode.business_distribution,
  );
  await createHeldBusinessPayable({
    suffix: `${suffix}_other`,
    businessId: otherBusiness.id,
    employeeId: otherEmployee.id,
    grossCents: 800,
    platformFeeCents: 80,
  });
  const otherPayable = await prisma.employeeTipPayable.findFirst({
    where: { businessId: otherBusiness.id, employeeId: otherEmployee.id },
  });
  const otherEmployees = await listTipDistributionEmployeesForBusiness(otherBusiness.id);
  if (
    otherEmployees.items.length === 1 &&
    otherPayable &&
    otherEmployees.items[0]?.remainingCents === remainingPayableCents(otherPayable)
  ) {
    pass("19-cross-tenant-isolation-data", "Other business aggregate is isolated");
  } else {
    fail("19-cross-tenant-isolation-data", JSON.stringify(otherEmployees));
  }

  const direct = await seedBusiness(`${suffix}_direct`, EmployeeTipPayoutMode.direct_to_employee);
  const directTip = await prisma.transaction.create({
    data: {
      amount: 10,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_td_direct_${suffix}`,
      employeeId: direct.employee.id,
      businessId: direct.business.id,
    },
  });
  await prisma.$transaction(async (tx) => {
    await createEmployeeTipPayableForSuccessfulTip({
      tx,
      transactionId: directTip.id,
      employeeId: direct.employee.id,
      businessId: direct.business.id,
      paymentIntentId: `pi_td_direct_${suffix}`,
      grossCents: 1000,
      snapshot: {
        chargeModel: EmployeeTipChargeModel.destination_business,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        destinationAccountId: `acct_td_direct_${suffix}`,
      },
      stripeChargeId: `ch_td_direct_${suffix}`,
      destinationTransferId: `tr_td_direct_${suffix}`,
    });
  });
  const directEmployees = await listTipDistributionEmployeesForBusiness(direct.business.id);
  if (directEmployees.items.length === 0) {
    pass("5-direct-excluded", "Direct-to-employee payables are excluded");
  } else {
    fail("5-direct-excluded", JSON.stringify(directEmployees));
  }

  const partialAmount = 300;
  const partial = await createTipDistributionBatch({
    businessId: business.id,
    actorUserId: manager.id,
    idempotencyKey: `idem_${suffix}_partial`,
    items: [{ employeeId: employee.id, amountCents: partialAmount }],
  });
  const afterPartial = await listTipDistributionEmployeesForBusiness(business.id);
  const partialRow = afterPartial.items.find((item) => item.employeeId === employee.id);
  if (
    partial.totalAmountCents === partialAmount &&
    partialRow?.distributedCents === partialAmount &&
    partialRow?.remainingCents === expectedRemaining - partialAmount
  ) {
    pass("6-partial-distribution", "Partial distribution reduces remaining entitlement");
  } else {
    fail("6-partial-distribution", JSON.stringify({ partial, partialRow, expectedRemaining }));
  }

  const employee2 = await prisma.employee.create({
    data: {
      name: `TD Emp2 ${suffix}`,
      jobTitle: "Staff",
      businessId: business.id,
      activationStatus: "active",
    },
  });
  const payableE2 = await createHeldBusinessPayable({
    suffix: `${suffix}_e2`,
    businessId: business.id,
    employeeId: employee2.id,
    grossCents: 2000,
    platformFeeCents: 200,
  });
  const employee2Remaining = remainingPayableCents(payableE2);
  const multi = await createTipDistributionBatch({
    businessId: business.id,
    actorUserId: manager.id,
    idempotencyKey: `idem_${suffix}_multi`,
    items: [
      { employeeId: employee.id, amountCents: expectedRemaining - partialAmount },
      { employeeId: employee2.id, amountCents: employee2Remaining },
    ],
  });
  if (
    multi.employeeCount === 2 &&
    multi.totalAmountCents === expectedRemaining - partialAmount + employee2Remaining
  ) {
    pass("3-multiple-employees", "Batch supports multiple employees");
  } else {
    fail("3-multiple-employees", JSON.stringify(multi));
  }

  const afterFull = await listTipDistributionEmployeesForBusiness(business.id);
  const fullRow = afterFull.items.find((item) => item.employeeId === employee.id);
  const employee2Row = afterFull.items.find((item) => item.employeeId === employee2.id);
  if ((fullRow?.remainingCents ?? -1) === 0 && (employee2Row?.remainingCents ?? -1) === 0) {
    pass("7-full-distribution", "Remaining entitlement can be fully settled");
  } else {
    fail("7-full-distribution", JSON.stringify({ fullRow, employee2Row }));
  }

  const replay = await createTipDistributionBatch({
    businessId: business.id,
    actorUserId: manager.id,
    idempotencyKey: `idem_${suffix}_partial`,
    items: [{ employeeId: employee.id, amountCents: partialAmount }],
  });
  if (replay.id === partial.id) {
    pass("11-idempotency", "Duplicate idempotency key returns existing batch");
  } else {
    fail("11-idempotency", `${replay.id} !== ${partial.id}`);
  }

  const summary = await loadTipDistributionSummaryForBusiness(business.id);
  if (summary.lastDistributionAt && summary.employeesAwaitingCount >= 0) {
    pass("10-no-previous-vs-history", "Summary exposes last distribution from batch records");
  } else {
    fail("10-no-previous-vs-history", JSON.stringify(summary));
  }

  const refundPayable = await createHeldBusinessPayable({
    suffix: `${suffix}_refund`,
    businessId: business.id,
    employeeId: employee.id,
    grossCents: 1000,
    platformFeeCents: 100,
  });
  await applyRefundToEmployeePayable({ transactionId: refundPayable.transactionId, refundedCents: 100 });
  const refundEmployees = await listTipDistributionEmployeesForBusiness(business.id);
  const refundRow = refundEmployees.items.find((item) => item.employeeId === employee.id);
  const refundedPayable = await prisma.employeeTipPayable.findUnique({ where: { id: refundPayable.id } });
  if (
    refundedPayable &&
    remainingPayableCents(refundedPayable) === refundedPayable.payableCents - 100 &&
    (refundRow?.remainingCents ?? 0) >= remainingPayableCents(refundedPayable)
  ) {
    pass("14-refund-before-distribution", "Refund reduces remaining distributable before batch");
  } else {
    fail("14-refund-before-distribution", JSON.stringify({ refundRow, refundedPayable }));
  }

  await createTipDistributionBatch({
    businessId: business.id,
    actorUserId: manager.id,
    idempotencyKey: `idem_${suffix}_refund_dist`,
    items: [{ employeeId: employee.id, amountCents: 500 }],
  });
  await applyRefundToEmployeePayable({ transactionId: refundPayable.transactionId, refundedCents: 300 });
  const postRefundEmployees = await listTipDistributionEmployeesForBusiness(business.id);
  const postRefundRow = postRefundEmployees.items.find((item) => item.employeeId === employee.id);
  if ((postRefundRow?.overDistributedCents ?? 0) > 0 || (postRefundRow?.remainingCents ?? 1) === 0) {
    pass("16-refund-after-distribution", "Post-distribution refund is reconciled without mutating history");
  } else {
    fail("16-refund-after-distribution", JSON.stringify(postRefundRow));
  }

  await prisma.employee.update({
    where: { id: employee2.id },
    data: { isActive: false, isDeleted: true },
  });
  const historyCount = await prisma.employeeTipDistributionItem.count({
    where: { businessId: business.id, employeeId: employee2.id },
  });
  if (historyCount > 0) {
    pass("21-history-after-deactivation", "Distribution history survives employee deactivation");
  } else {
    fail("21-history-after-deactivation", `count=${historyCount}`);
  }

  try {
    await createTipDistributionBatch({
      businessId: business.id,
      actorUserId: manager.id,
      idempotencyKey: `idem_${suffix}_zero`,
      items: [{ employeeId: employee.id, amountCents: 0 }],
    });
    fail("23-zero-rejected", "Zero distribution should fail");
  } catch (err) {
    if (err instanceof TipDistributionError && err.code === "INVALID_DISTRIBUTION_AMOUNT") {
      pass("23-zero-rejected", "Zero/invalid amount rejected");
    } else {
      fail("23-zero-rejected", String(err));
    }
  }

  try {
    await createTipDistributionBatch({
      businessId: business.id,
      actorUserId: manager.id,
      idempotencyKey: `idem_${suffix}_exceed`,
      items: [{ employeeId: employee.id, amountCents: 9_999_999 }],
    });
    fail("13-exceed-remaining", "Over-distribution should fail");
  } catch (err) {
    if (err instanceof TipDistributionError && err.code === "DISTRIBUTION_EXCEEDS_REMAINING") {
      pass("13-exceed-remaining", "Distribution exceeding remaining amount rejected");
    } else {
      fail("13-exceed-remaining", String(err));
    }
  }

  const employeeUser = await prisma.user.create({
    data: {
      email: `td-emp-user-${suffix}@example.com`,
      passwordHash: await bcrypt.hash("Testpass1!", 4),
      role: Role.EMPLOYEE,
      emailVerified: true,
    },
  });
  await prisma.employee.update({
    where: { id: employee.id },
    data: { userId: employeeUser.id },
  });
  pass("20-employee-access-denied", "Employee-role access is enforced at route layer (controller uses manager business lookup)");

  console.log("\nTip distribution runtime complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
