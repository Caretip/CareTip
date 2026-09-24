/**
 * CareTip ↔ Stripe payable reconciliation regressions (read-only classifier).
 *
 *   npm run test:employee-payout-reconciliation
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
  __setEmployeeStripeTransferListFnForTests,
  reconcileEmployeeDirectPayables,
} from "../src/services/employeePayoutReconciliation.service.js";

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

async function seedFixture(suffix: string) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `recon-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `Recon ${suffix}`,
      slug: `recon-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_recon_biz_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employeeUser = await prisma.user.create({
    data: {
      email: `recon-emp-${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: `Recon Emp ${suffix}`,
      jobTitle: "Server",
      businessId: business.id,
      userId: employeeUser.id,
    },
  });
  const stripeAccountId = `acct_recon_emp_${suffix}`;
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
  employee: { id: string; userId: string | null };
  businessId: string;
  managerId: string;
}) {
  await prisma.employeeTipPayable.deleteMany({ where: { employeeId: ctx.employee.id } });
  await prisma.transaction.deleteMany({ where: { employeeId: ctx.employee.id } });
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: ctx.employee.id } });
  await prisma.employee.delete({ where: { id: ctx.employee.id } });
  await prisma.business.delete({ where: { id: ctx.businessId } });
  const userIds = [ctx.managerId, ctx.employee.userId].filter((id): id is string => Boolean(id));
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  const suffix = `recon_${Date.now()}`;
  const { manager, business, employee, stripeAccountId } = await seedFixture(suffix);

  const tipPending = await prisma.transaction.create({
    data: {
      amount: 30,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_recon_pend_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  const payablePending = await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipPending.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.transfer_failed,
      grossCents: 3000,
      platformFeeCents: 349,
      payableCents: 2651,
      stripePaymentIntentId: `pi_recon_pend_${suffix}`,
    },
  });

  const tipMatched = await prisma.transaction.create({
    data: {
      amount: 50,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_recon_match_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  const transferMatchedId = `tr_recon_match_${suffix}`;
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
      stripeTransferId: transferMatchedId,
      stripeDestinationAccountId: stripeAccountId,
      stripePaymentIntentId: `pi_recon_match_${suffix}`,
    },
  });

  const tipMismatch = await prisma.transaction.create({
    data: {
      amount: 40,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_recon_mis_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  const transferMismatchId = `tr_recon_mis_${suffix}`;
  await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipMismatch.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.transferred,
      grossCents: 4000,
      platformFeeCents: 449,
      payableCents: 3551,
      transferredCents: 3551,
      stripeTransferId: transferMismatchId,
      stripeDestinationAccountId: stripeAccountId,
      stripePaymentIntentId: `pi_recon_mis_${suffix}`,
    },
  });

  const tipDup = await prisma.transaction.create({
    data: {
      amount: 35,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_recon_dup_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  const payableDup = await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipDup.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.transferred,
      grossCents: 3500,
      platformFeeCents: 399,
      payableCents: 3101,
      transferredCents: 3101,
      stripeTransferId: `tr_recon_dup_a_${suffix}`,
      stripeDestinationAccountId: stripeAccountId,
      stripePaymentIntentId: `pi_recon_dup_${suffix}`,
    },
  });

  __setEmployeeStripeTransferListFnForTests(async () => ({
    object: "list",
    data: [
      {
        id: transferMatchedId,
        object: "transfer",
        amount: 4451,
        destination: stripeAccountId,
        metadata: { caretip_payable_id: payableMatched.id },
      } as Stripe.Transfer,
      {
        id: transferMismatchId,
        object: "transfer",
        amount: 3000,
        destination: stripeAccountId,
        metadata: {},
      } as Stripe.Transfer,
      {
        id: `tr_recon_dup_a_${suffix}`,
        object: "transfer",
        amount: 3101,
        destination: stripeAccountId,
        metadata: { caretip_payable_id: payableDup.id },
      } as Stripe.Transfer,
      {
        id: `tr_recon_dup_b_${suffix}`,
        object: "transfer",
        amount: 3101,
        destination: stripeAccountId,
        metadata: { caretip_payable_id: payableDup.id },
      } as Stripe.Transfer,
    ],
    has_more: false,
    url: "/v1/transfers",
  }));

  const result = await reconcileEmployeeDirectPayables(employee.id);
  __setEmployeeStripeTransferListFnForTests(null);

  const byPayable = new Map(result.rows.map((r) => [r.payableId, r]));
  assert.equal(byPayable.get(payablePending.id)?.status, "CARETIP_PENDING");
  assert.equal(byPayable.get(payableMatched.id)?.status, "MATCHED");
  assert.equal(
    byPayable.get(
      result.rows.find((r) => r.transactionId === tipMismatch.id)?.payableId ?? "",
    )?.status,
    "AMOUNT_MISMATCH",
  );
  assert.equal(byPayable.get(payableDup.id)?.status, "DUPLICATE_TRANSFER");
  assert.equal(result.needsAttention, true);
  pass("reconciliation-classifier", "matched, pending, amount mismatch, duplicate detected");

  await cleanup({ employee, businessId: business.id, managerId: manager.id });
  console.log("employee-payout-reconciliation-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
