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
  RECONCILIATION_MAX_TRANSFER_PAGES,
  reconcileEmployeeDirectPayables,
} from "../src/services/employeePayoutReconciliation.service.js";
import { destinationTransferIdFromPaymentIntent } from "../src/services/employeeTipRouting.service.js";

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

async function seedDestinationChargeFixture(suffix: string) {
  const ctx = await seedFixture(suffix);
  const chargeBySource = `ch_dest_src_${suffix}`;
  const chargeById = `ch_dest_id_${suffix}`;
  const transferIdStored = `tr_dest_id_${suffix}`;
  const create = async (
    tag: string,
    grossCents: number,
    feeCents: number,
    stripeChargeId: string | null,
    stripeTransferId: string | null,
  ) => {
    const tip = await prisma.transaction.create({
      data: {
        amount: grossCents / 100,
        status: TipStatus.success,
        stripePaymentIntentId: `pi_dest_${tag}_${suffix}`,
        employeeId: ctx.employee.id,
        businessId: ctx.business.id,
      },
    });
    const payable = await prisma.employeeTipPayable.create({
      data: {
        transactionId: tip.id,
        employeeId: ctx.employee.id,
        businessId: ctx.business.id,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        chargeModel: EmployeeTipChargeModel.destination_employee,
        status: EmployeeTipPayableStatus.destination_settled,
        grossCents,
        platformFeeCents: feeCents,
        payableCents: grossCents - feeCents,
        transferredCents: grossCents - feeCents,
        stripePaymentIntentId: `pi_dest_${tag}_${suffix}`,
        stripeChargeId,
        stripeTransferId,
        stripeDestinationAccountId: ctx.stripeAccountId,
      },
    });
    return payable.id;
  };
  return {
    ...ctx,
    suffix,
    chargeBySource,
    chargeById,
    transferIdStored,
    payableBySource: await create("src", 2000, 249, chargeBySource, null),
    payableById: await create("id", 3000, 349, chargeById, transferIdStored),
    payableNoLink: await create("nolink", 1500, 199, null, null),
    payableMissing: await create("missing", 2500, 299, `ch_dest_missing_${suffix}`, null),
  };
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
      } as unknown as Stripe.Transfer,
      {
        id: transferMismatchId,
        object: "transfer",
        amount: 3000,
        destination: stripeAccountId,
        metadata: {},
      } as unknown as Stripe.Transfer,
      {
        id: `tr_recon_dup_a_${suffix}`,
        object: "transfer",
        amount: 3101,
        destination: stripeAccountId,
        metadata: { caretip_payable_id: payableDup.id },
      } as unknown as Stripe.Transfer,
      {
        id: `tr_recon_dup_b_${suffix}`,
        object: "transfer",
        amount: 3101,
        destination: stripeAccountId,
        metadata: { caretip_payable_id: payableDup.id },
      } as unknown as Stripe.Transfer,
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
  assert.equal(result.complete, true);
  assert.equal(result.examinedPayableCount, 4);
  assert.equal(result.totalPayableCount, 4);
  assert.equal(result.payablesTruncated, false);
  assert.equal(result.transfersHasMore, false);
  pass("reconciliation-classifier", "matched, pending, amount mismatch, duplicate detected");

  __setEmployeeStripeTransferListFnForTests(async () => {
    throw new Error("stripe_unavailable");
  });
  const unreadable = await reconcileEmployeeDirectPayables(employee.id);
  __setEmployeeStripeTransferListFnForTests(null);
  assert.equal(unreadable.stripeReadable, false);
  assert.equal(
    unreadable.rows.find((r) => r.payableId === payableMatched.id)?.status,
    "STRIPE_VERIFICATION_INCOMPLETE",
  );
  assert.equal(unreadable.needsAttention, false, "unreadable stripe cannot confirm attention rows");
  assert.equal(unreadable.complete, false);
  pass("reconciliation-unreadable-incomplete", "unreadable Stripe yields VERIFICATION_INCOMPLETE, never MISSING");

  const dest = await seedDestinationChargeFixture(`recon_dest_${Date.now()}`);
  const destTransfers = {
    matchedBySource: {
      id: `tr_dest_src_${dest.suffix}`,
      object: "transfer",
      amount: 2000,
      destination: dest.stripeAccountId,
      source_transaction: dest.chargeBySource,
      created: 1_700_000_000,
      metadata: {},
    } as unknown as Stripe.Transfer,
    matchedById: {
      id: dest.transferIdStored,
      object: "transfer",
      amount: 3000,
      destination: dest.stripeAccountId,
      source_transaction: dest.chargeById,
      created: 1_700_000_100,
      metadata: {},
    } as unknown as Stripe.Transfer,
  };
  let destCalls: Stripe.TransferListParams[] = [];
  __setEmployeeStripeTransferListFnForTests(async (params) => {
    destCalls.push(params);
    const firstPage = !params.starting_after;
    return {
      object: "list",
      data: firstPage ? [destTransfers.matchedById] : [destTransfers.matchedBySource],
      has_more: firstPage,
      url: "/v1/transfers",
    };
  });
  const destResult = await reconcileEmployeeDirectPayables(dest.employee.id);
  const destById = new Map(destResult.rows.map((r) => [r.payableId, r]));
  assert.equal(destCalls.length, 2, "second page requested via starting_after");
  assert.equal(destCalls[1].starting_after, dest.transferIdStored);
  assert.ok(typeof (destCalls[0].created as { gte?: number })?.gte === "number", "listing bounded by created.gte");
  assert.equal(destById.get(dest.payableBySource)?.status, "MATCHED", "linked by source_transaction at gross amount");
  assert.equal(destById.get(dest.payableBySource)?.stripeTransferId, destTransfers.matchedBySource.id);
  assert.equal(destById.get(dest.payableById)?.status, "MATCHED", "stored destination transfer id at gross amount");
  assert.equal(destById.get(dest.payableNoLink)?.status, "STRIPE_VERIFICATION_INCOMPLETE");
  assert.equal(destById.get(dest.payableMissing)?.status, "STRIPE_TRANSFER_MISSING");
  assert.equal(destResult.complete, false, "unlinkable row keeps the result incomplete");
  pass("reconciliation-destination-charge", "gross-amount destination transfers match by id or source charge across pages");

  destCalls = [];
  __setEmployeeStripeTransferListFnForTests(async (params) => {
    destCalls.push(params);
    return { object: "list", data: [destTransfers.matchedById], has_more: true, url: "/v1/transfers" };
  });
  const bounded = await reconcileEmployeeDirectPayables(dest.employee.id);
  __setEmployeeStripeTransferListFnForTests(null);
  assert.equal(destCalls.length, RECONCILIATION_MAX_TRANSFER_PAGES);
  assert.equal(bounded.transfersHasMore, true);
  assert.equal(bounded.complete, false);
  assert.equal(
    bounded.rows.find((r) => r.payableId === dest.payableMissing)?.status,
    "STRIPE_VERIFICATION_INCOMPLETE",
    "truncated listing cannot prove a transfer is missing",
  );
  assert.equal(bounded.needsAttention, false);
  pass("reconciliation-page-bound", "page bound reached -> incomplete, not missing");

  const piWithCharge = {
    id: "pi_unit",
    object: "payment_intent",
    latest_charge: { id: "ch_unit", object: "charge", transfer: "tr_unit_from_charge" },
  } as unknown as Stripe.PaymentIntent;
  assert.equal(destinationTransferIdFromPaymentIntent(piWithCharge), "tr_unit_from_charge");
  assert.equal(
    destinationTransferIdFromPaymentIntent({ ...piWithCharge, latest_charge: "ch_unit" } as Stripe.PaymentIntent),
    null,
  );
  pass("destination-transfer-id-from-charge", "destination Transfer id read from expanded latest_charge.transfer");
  await cleanup({ employee: dest.employee, businessId: dest.business.id, managerId: dest.manager.id });

  const suffixUnread = `recon_unread_${Date.now()}`;
  const unreadCtx = await seedFixture(suffixUnread);
  const tipSettled = await prisma.transaction.create({
    data: {
      amount: 20,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_recon_set_${suffixUnread}`,
      employeeId: unreadCtx.employee.id,
      businessId: unreadCtx.business.id,
    },
  });
  await prisma.employeeTipPayable.create({
    data: {
      transactionId: tipSettled.id,
      employeeId: unreadCtx.employee.id,
      businessId: unreadCtx.business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.destination_settled,
      grossCents: 2000,
      platformFeeCents: 249,
      payableCents: 1751,
      transferredCents: 1751,
      stripePaymentIntentId: `pi_recon_set_${suffixUnread}`,
    },
  });
  __setEmployeeStripeTransferListFnForTests(async () => {
    throw new Error("stripe_unavailable");
  });
  const unreadableOnly = await reconcileEmployeeDirectPayables(unreadCtx.employee.id);
  __setEmployeeStripeTransferListFnForTests(null);
  assert.equal(unreadableOnly.stripeReadable, false);
  assert.equal(unreadableOnly.needsAttention, false);
  pass("reconciliation-unreadable-no-false-positive", "unreadable missing transfer does not need attention");

  await cleanup({
    employee: unreadCtx.employee,
    businessId: unreadCtx.business.id,
    managerId: unreadCtx.manager.id,
  });
  await cleanup({ employee, businessId: business.id, managerId: manager.id });
  console.log("employee-payout-reconciliation-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
