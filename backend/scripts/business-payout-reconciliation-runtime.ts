/**
 * Business payout reconciliation regressions (Pass 2).
 *
 *   npm run test:business-payout-reconciliation
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
import type Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import {
  __setBusinessStripeChargeListFnForTests,
  __setBusinessStripeTransferListFnForTests,
  reconcileBusinessPayables,
} from "../src/services/businessPayoutReconciliation.service.js";

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

async function seedFixture(suffix: string) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `biz-recon-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `Biz Recon ${suffix}`,
      slug: `biz-recon-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_biz_recon_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: `Biz Recon Emp ${suffix}`,
      jobTitle: "Server",
      businessId: business.id,
    },
  });
  const stripeAccountId = `acct_biz_recon_emp_${suffix}`;
  await prisma.employeeStripeAccount.create({
    data: {
      employeeId: employee.id,
      stripeAccountId,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });
  return { manager, business, employee, stripeAccountId };
}

async function cleanup(ctx: {
  employeeId: string;
  businessId: string;
  managerId: string;
}) {
  await prisma.employeeTipPayable.deleteMany({ where: { businessId: ctx.businessId } });
  await prisma.transaction.deleteMany({ where: { businessId: ctx.businessId } });
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: ctx.employeeId } });
  await prisma.employee.delete({ where: { id: ctx.employeeId } });
  await prisma.business.delete({ where: { id: ctx.businessId } });
  await prisma.user.delete({ where: { id: ctx.managerId } });
}

async function main() {
  const suffix = `biz_recon_${Date.now()}`;
  const { manager, business, employee, stripeAccountId } = await seedFixture(suffix);

  const tipBiz = await prisma.transaction.create({
    data: {
      amount: 40,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_biz_recon_biz_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
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
      stripePaymentIntentId: `pi_biz_recon_biz_${suffix}`,
    },
  });

  const tipHeld = await prisma.transaction.create({
    data: {
      amount: 20,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_biz_recon_held_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipHeld.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.held_platform,
      grossCents: 2000,
      platformFeeCents: 249,
      payableCents: 1751,
      stripePaymentIntentId: `pi_biz_recon_held_${suffix}`,
    },
  });

  const tipFailed = await prisma.transaction.create({
    data: {
      amount: 25,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_biz_recon_fail_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  const payableFailed = await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipFailed.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.transfer_failed,
      grossCents: 2500,
      platformFeeCents: 299,
      payableCents: 2201,
      stripePaymentIntentId: `pi_biz_recon_fail_${suffix}`,
    },
  });

  const tipMatched = await prisma.transaction.create({
    data: {
      amount: 50,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_biz_recon_match_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  const transferId = `tr_biz_recon_match_${suffix}`;
  const payableMatched = await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipMatched.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.transferred,
      grossCents: 5000,
      platformFeeCents: 549,
      payableCents: 4451,
      transferredCents: 4451,
      stripeTransferId: transferId,
      stripeDestinationAccountId: stripeAccountId,
      stripePaymentIntentId: `pi_biz_recon_match_${suffix}`,
    },
  });

  const tipMissing = await prisma.transaction.create({
    data: {
      amount: 35,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_biz_recon_miss_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  const payableMissing = await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipMissing.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.transferred,
      grossCents: 3500,
      platformFeeCents: 399,
      payableCents: 3101,
      transferredCents: 3101,
      stripeTransferId: `tr_biz_recon_missing_${suffix}`,
      stripeDestinationAccountId: stripeAccountId,
      stripePaymentIntentId: `pi_biz_recon_miss_${suffix}`,
    },
  });

  const tipDestSettled = await prisma.transaction.create({
    data: {
      amount: 30,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_biz_recon_dest_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  const destChargeId = `ch_biz_recon_dest_${suffix}`;
  const payableDestSettled = await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipDestSettled.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.destination_employee,
      status: EmployeeTipPayableStatus.destination_settled,
      grossCents: 3000,
      platformFeeCents: 349,
      payableCents: 2651,
      transferredCents: 2651,
      stripeChargeId: destChargeId,
      stripeDestinationAccountId: stripeAccountId,
      stripePaymentIntentId: `pi_biz_recon_dest_${suffix}`,
    },
  });

  __setBusinessStripeTransferListFnForTests(async () => ({
    object: "list",
    data: [
      {
        id: transferId,
        object: "transfer",
        amount: 4451,
        destination: stripeAccountId,
        metadata: { caretip_payable_id: payableMatched.id },
      } as unknown as Stripe.Transfer,
      {
        id: `tr_biz_recon_dest_${suffix}`,
        object: "transfer",
        amount: 3000,
        destination: stripeAccountId,
        source_transaction: destChargeId,
        metadata: {},
      } as unknown as Stripe.Transfer,
    ],
    has_more: false,
    url: "/v1/transfers",
  }));
  __setBusinessStripeChargeListFnForTests(async () => ({
    object: "list",
    data: [],
    has_more: false,
    url: "/v1/charges",
  }));

  const result = await reconcileBusinessPayables(business.id);
  __setBusinessStripeTransferListFnForTests(null);
  __setBusinessStripeChargeListFnForTests(null);

  const byPayable = new Map(result.rows.map((r) => [r.payableId, r]));
  assert.equal(byPayable.get(payableMatched.id)?.status, "MATCHED");
  assert.equal(byPayable.get(payableFailed.id)?.status, "CARETIP_TRANSFER_FAILED");
  assert.equal(
    byPayable.get(
      result.rows.find((r) => r.transactionId === tipHeld.id)?.payableId ?? "",
    )?.status,
    "CARETIP_EXPECTED_PENDING",
  );
  assert.equal(byPayable.get(payableMissing.id)?.status, "STRIPE_TRANSFER_MISSING");
  assert.equal(
    result.rows.find((r) => r.transactionId === tipBiz.id)?.status,
    "BUSINESS_DISTRIBUTION",
  );
  assert.equal(byPayable.get(payableDestSettled.id)?.status, "MATCHED");
  assert.equal(result.complete, true);
  assert.equal(result.needsAttention, true);
  pass("biz-recon-direct", "Direct-to-employee requires Stripe transfer confirmation");
  pass("biz-recon-destination-settled", "destination charge verified by platform transfer source_transaction at gross");

  __setBusinessStripeTransferListFnForTests(async () => {
    throw new Error("stripe_unavailable");
  });
  __setBusinessStripeChargeListFnForTests(async () => ({
    object: "list",
    data: [],
    has_more: false,
    url: "/v1/charges",
  }));
  const unreadableDest = await reconcileBusinessPayables(business.id);
  __setBusinessStripeTransferListFnForTests(null);
  __setBusinessStripeChargeListFnForTests(null);
  const unreadableById = new Map(unreadableDest.rows.map((r) => [r.payableId, r]));
  assert.equal(unreadableById.get(payableDestSettled.id)?.status, "INSUFFICIENT_VERIFICATION");
  assert.equal(unreadableById.get(payableMissing.id)?.status, "INSUFFICIENT_VERIFICATION");
  assert.equal(unreadableById.get(payableMatched.id)?.status, "INSUFFICIENT_VERIFICATION");
  pass("biz-recon-unreadable-destination", "failed transfer listing for a destination is never reported as missing");

  await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });

  const suffixMany = `biz_recon_many_${Date.now()}`;
  const manyCtx = await seedFixture(suffixMany);
  for (let i = 0; i < 105; i += 1) {
    const tip = await prisma.transaction.create({
      data: {
        amount: 10,
        status: TipStatus.success,
        stripePaymentIntentId: `pi_biz_recon_many_${suffixMany}_${i}`,
        employeeId: manyCtx.employee.id,
        businessId: manyCtx.business.id,
      },
    });
    await prisma.employeeTipPayable.create({
      data: {
        transactionId: tip.id,
        employeeId: manyCtx.employee.id,
        businessId: manyCtx.business.id,
        routingMode: EmployeeTipPayoutMode.business_distribution,
        chargeModel: EmployeeTipChargeModel.destination_business,
        status: EmployeeTipPayableStatus.held_business,
        grossCents: 1000,
        platformFeeCents: 149,
        payableCents: 851,
        stripePaymentIntentId: `pi_biz_recon_many_${suffixMany}_${i}`,
      },
    });
  }

  __setBusinessStripeTransferListFnForTests(async () => ({
    object: "list",
    data: [],
    has_more: false,
    url: "/v1/transfers",
  }));
  __setBusinessStripeChargeListFnForTests(async () => ({
    object: "list",
    data: [],
    has_more: false,
    url: "/v1/charges",
  }));

  const manyResult = await reconcileBusinessPayables(manyCtx.business.id);
  __setBusinessStripeTransferListFnForTests(null);
  __setBusinessStripeChargeListFnForTests(null);

  assert.equal(manyResult.totalPayableCount, 105);
  assert.equal(manyResult.examinedPayableCount, 105);
  assert.equal(manyResult.payablesTruncated, false);
  pass("recon-over-100", "All payables examined when count exceeds single batch size");

  await cleanup({
    employeeId: manyCtx.employee.id,
    businessId: manyCtx.business.id,
    managerId: manyCtx.manager.id,
  });

  console.log("business-payout-reconciliation-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
