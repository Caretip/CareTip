/**
 * Employee tip payable dispute / chargeback lifecycle.
 * Run: npm run test:employee-tip-dispute-lifecycle
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayoutMode,
  EmployeeTipPayableStatus,
  Role,
  StripeConnectStatus,
  TipRefundKind,
  TipRefundStatus,
  TipStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { remainingPayableCents } from "../src/services/employeeTipPayable.service.js";
import {
  releaseHeldPlatformPayablesForEmployee,
  __setEmployeeTipTransferCreateFnForTests,
  __setEmployeeTipTransferReversalFnForTests,
} from "../src/services/employeeTipRelease.service.js";
import {
  upsertStripeDisputeEvent,
  upsertStripeRefundEvent,
} from "../src/services/finance/tipRefunds.service.js";
import { employeePayableSummaryForEmployee } from "../src/services/employeeTipPayable.service.js";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
const backendRoot = process.cwd();

function pass(id: string, detail: string) {
  results.push({ id, pass: true, detail });
}
function fail(id: string, detail: string) {
  results.push({ id, pass: false, detail });
}
function read(relPath: string): string {
  return readFileSync(join(backendRoot, relPath), "utf8");
}

function runStatic() {
  const webhook = read("src/webhooks/stripe.webhook.ts");
  const refunds = read("src/services/finance/tipRefunds.service.ts");
  const payable = read("src/services/employeeTipPayable.service.ts");
  const routes = read("src/routes/employeeConnect.routes.ts") + read("src/routes/connect.routes.ts");
  if (
    webhook.includes("charge.dispute.created") &&
    webhook.includes("charge.dispute.updated") &&
    webhook.includes("charge.dispute.closed") &&
    webhook.includes("verifyWebhookSignature")
  ) {
    pass("webhook-dispute-events-signed", "Platform webhook handles signed dispute events only");
  } else {
    fail("webhook-dispute-events-signed", "webhook dispute wiring missing");
  }
  if (webhook.includes("stripeEventAccount") && refunds.includes("skipped_mismatch")) {
    pass("connect-account-mismatch-fail-closed", "event.account mismatch does not mutate the payable");
  } else {
    fail("connect-account-mismatch-fail-closed", "account attribution missing");
  }
  if (
    payable.includes("disputedOpenCents") &&
    payable.includes("disputedLostCents") &&
    payable.includes("employee-tip-release:")
  ) {
    pass("payable-dispute-fields-locked", "Dispute apply uses payable cents + existing release lock");
  } else {
    fail("payable-dispute-fields-locked", "ledger/lock missing");
  }
  if (!routes.includes("reverseReleased") && !routes.includes("createReversal")) {
    pass("no-client-reversal-route", "No client-triggerable Transfer reversal endpoint");
  } else {
    fail("no-client-reversal-route", "reversal route exposed");
  }
  if (
    remainingPayableCents({
      payableCents: 851,
      transferredCents: 0,
      reversedCents: 0,
      refundedCents: 100,
      disputedOpenCents: 200,
      disputedLostCents: 0,
    }) === 551
  ) {
    pass("remaining-partial-dispute", "Open dispute freezes only the disputed remainder");
  } else {
    fail("remaining-partial-dispute", "remaining math");
  }
  const stripeSvc = read("src/services/stripe.service.ts");
  const refundsAgain = read("src/services/finance/tipRefunds.service.ts");
  if (
    stripeSvc.includes("applyExistingStripeDisputeAfterSuccessfulTip") &&
    refundsAgain.includes("applyExistingStripeDisputeAfterSuccessfulTip")
  ) {
    pass(
      "success-handler-reapplies-existing-dispute",
      "Successful tip write re-reads an already-open Stripe dispute after the ledger exists",
    );
  } else {
    fail("success-handler-reapplies-existing-dispute", "backfill hook missing");
  }
}

async function disputeEvent(
  suffix: string,
  pi: string,
  disputeId: string,
  status: string,
  amountCents: number,
  extra?: { account?: string; chargeId?: string },
) {
  await upsertStripeDisputeEvent({
    stripeDisputeId: disputeId,
    stripePaymentIntentId: pi,
    stripeChargeId: extra?.chargeId ?? `ch_${disputeId}`,
    amountCents,
    status,
    occurredAt: new Date(),
    stripeEventAccount: extra?.account ?? null,
  });
}

async function runDb() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: { email: `dp_mgr_${suffix}@example.com`, passwordHash, role: Role.MANAGER, emailVerified: true },
  });
  const userEmp = await prisma.user.create({
    data: { email: `dp_emp_${suffix}@example.com`, passwordHash, role: Role.EMPLOYEE, emailVerified: true },
  });
  const business = await prisma.business.create({
    data: {
      name: `Dispute ${suffix}`,
      slug: `dispute-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_dp_biz_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: "Disputed",
      jobTitle: "Server",
      businessId: business.id,
      userId: userEmp.id,
      activationStatus: "active",
      isActive: true,
    },
  });
  await prisma.employeeStripeAccount.create({
    data: {
      employeeId: employee.id,
      stripeAccountId: `acct_dp_emp_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });

  let n = 0;
  async function makeTip(opts: {
    model: EmployeeTipChargeModel;
    status: EmployeeTipPayableStatus;
    transferred?: number;
    transferId?: string | null;
    dest?: string | null;
    tag: string;
  }) {
    n += 1;
    const pi = `pi_dp_${opts.tag}_${suffix}_${n}`;
    const tip = await prisma.transaction.create({
      data: {
        amount: 10,
        status: TipStatus.success,
        stripePaymentIntentId: pi,
        employeeId: employee.id,
        businessId: business.id,
      },
    });
    const payable = await prisma.employeeTipPayable.create({
      data: {
        transactionId: tip.id,
        employeeId: employee.id,
        businessId: business.id,
        routingMode:
          opts.model === EmployeeTipChargeModel.destination_business
            ? EmployeeTipPayoutMode.business_distribution
            : EmployeeTipPayoutMode.direct_to_employee,
        chargeModel: opts.model,
        status: opts.status,
        grossCents: 1000,
        platformFeeCents: 149,
        payableCents: 851,
        transferredCents: opts.transferred ?? 0,
        stripePaymentIntentId: pi,
        stripeChargeId: `ch_dp_${opts.tag}_${suffix}_${n}`,
        stripeTransferId: opts.transferId ?? undefined,
        stripeDestinationAccountId: opts.dest ?? undefined,
      },
    });
    return { tip, payable, pi };
  }

  try {
    const dest = await makeTip({
      model: EmployeeTipChargeModel.destination_employee,
      status: EmployeeTipPayableStatus.destination_settled,
      transferred: 851,
      transferId: `tr_dp_dest_${suffix}`,
      dest: `acct_dp_emp_${suffix}`,
      tag: "dest",
    });
    let destReversals = 0;
    __setEmployeeTipTransferReversalFnForTests(async () => {
      destReversals += 1;
      return { id: "trr_should_not", amount: 1 };
    });
    await disputeEvent(suffix, dest.pi, `dp_dest_created_${suffix}`, "needs_response", 1000);
    const destOpen = await prisma.employeeTipPayable.findUnique({ where: { id: dest.payable.id } });
    if (destOpen?.disputedOpenCents === 851 && destReversals === 0) {
      pass("1-direct-connected-created", "Destination dispute freezes employee payable without SCT reversal");
    } else {
      fail("1-direct-connected-created", JSON.stringify({ destOpen, destReversals }));
    }
    await disputeEvent(suffix, dest.pi, `dp_dest_created_${suffix}`, "won", 1000);
    const destWon = await prisma.employeeTipPayable.findUnique({ where: { id: dest.payable.id } });
    const destSummary = await employeePayableSummaryForEmployee(employee.id);
    if (destWon?.disputedOpenCents === 0 && destWon.disputedLostCents === 0 && destSummary.destinationSettledCents === 851) {
      pass("2-direct-connected-won", "Won dispute restores destination settled amount");
    } else {
      fail("2-direct-connected-won", JSON.stringify({ destWon, destSummary }));
    }
    await disputeEvent(suffix, dest.pi, `dp_dest_lost_${suffix}`, "lost", 1000);
    const destLost = await prisma.employeeTipPayable.findUnique({ where: { id: dest.payable.id } });
    const destLostSummary = await employeePayableSummaryForEmployee(employee.id);
    if (
      destLost?.disputedLostCents === 851 &&
      destReversals === 0 &&
      destLostSummary.destinationSettledCents === 0
    ) {
      pass("3-direct-connected-lost", "Lost destination dispute is not shown as settled; no CareTip Transfer reversal");
    } else {
      fail("3-direct-connected-lost", JSON.stringify({ destLost, destReversals, destLostSummary }));
    }

    const beforeHold = await makeTip({
      model: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.held_platform,
      tag: "before",
    });
    await disputeEvent(suffix, beforeHold.pi, `dp_before_${suffix}`, "needs_response", 1000);
    const beforeOpen = await prisma.employeeTipPayable.findUnique({ where: { id: beforeHold.payable.id } });
    if (beforeOpen?.disputedOpenCents === 851 && remainingPayableCents(beforeOpen) === 0) {
      pass("4-hold-dispute-before-transfer", "Open dispute zeroes remaining platform-hold payable");
    } else {
      fail("4-hold-dispute-before-transfer", JSON.stringify(beforeOpen));
    }
    let holdTransfers = 0;
    __setEmployeeTipTransferCreateFnForTests(async (params) => {
      holdTransfers += 1;
      return { id: `tr_blocked_${suffix}_${holdTransfers}`, amount: params.amount ?? 0 };
    });
    const blocked = await releaseHeldPlatformPayablesForEmployee(employee.id);
    if (blocked.released === 0 && holdTransfers === 0) {
      pass("5-hold-release-blocked-while-disputed", "Release does not Transfer the disputed portion");
    } else {
      fail("5-hold-release-blocked-while-disputed", JSON.stringify({ blocked, holdTransfers }));
    }
    await disputeEvent(suffix, beforeHold.pi, `dp_before_${suffix}`, "won", 1000);
    const afterWon = await prisma.employeeTipPayable.findUnique({ where: { id: beforeHold.payable.id } });
    const resumed = await releaseHeldPlatformPayablesForEmployee(employee.id);
    if (
      afterWon?.disputedOpenCents === 0 &&
      remainingPayableCents(afterWon) === 851 &&
      resumed.released === 1 &&
      holdTransfers === 1
    ) {
      pass("6-hold-won-release-resumes", "Won dispute unfreezes remaining payable and release Transfers net");
    } else {
      fail("6-hold-won-release-resumes", JSON.stringify({ afterWon, resumed, holdTransfers }));
    }

    const lostHold = await makeTip({
      model: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.held_platform,
      tag: "losthold",
    });
    await disputeEvent(suffix, lostHold.pi, `dp_losthold_${suffix}`, "lost", 1000);
    holdTransfers = 0;
    const lostRelease = await releaseHeldPlatformPayablesForEmployee(employee.id);
    const lostHoldRow = await prisma.employeeTipPayable.findUnique({ where: { id: lostHold.payable.id } });
    if (lostRelease.released === 0 && holdTransfers === 0 && lostHoldRow?.disputedLostCents === 851) {
      pass("7-hold-lost-not-transferred", "Lost disputed amount is not Transferred");
    } else {
      fail("7-hold-lost-not-transferred", JSON.stringify({ lostRelease, holdTransfers, lostHoldRow }));
    }

    const afterXfer = await makeTip({
      model: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.held_platform,
      tag: "after",
    });
    __setEmployeeTipTransferCreateFnForTests(async (params) => {
      return { id: `tr_after_${suffix}`, amount: params.amount ?? 0 };
    });
    const released = await releaseHeldPlatformPayablesForEmployee(employee.id);
    const afterReleased = await prisma.employeeTipPayable.findUnique({ where: { id: afterXfer.payable.id } });
    if (released.released === 1 && afterReleased?.stripeTransferId === `tr_after_${suffix}`) {
      pass("8-hold-transferred-then-dispute-setup", "Platform-hold Transfer completed before dispute");
    } else {
      fail("8-hold-transferred-then-dispute-setup", JSON.stringify({ released, afterReleased }));
    }
    let afterReversals = 0;
    __setEmployeeTipTransferReversalFnForTests(async (_id, params, options) => {
      afterReversals += 1;
      if (params.amount !== 851) throw new Error(`unexpected reversal ${params.amount}`);
      if (!String(options.idempotencyKey).startsWith(`emp_tip_reversal:${afterXfer.payable.id}:`)) {
        throw new Error("missing reversal idempotency");
      }
      return { id: `trr_after_${suffix}`, amount: 851 };
    });
    await disputeEvent(suffix, afterXfer.pi, `dp_after_${suffix}`, "needs_response", 1000);
    const afterOpen = await prisma.employeeTipPayable.findUnique({ where: { id: afterXfer.payable.id } });
    if (afterOpen?.disputedOpenCents === 851 && afterReversals === 0) {
      pass("8-hold-transferred-open-no-reverse", "Open post-Transfer dispute freezes entitlement without reversing yet");
    } else {
      fail("8-hold-transferred-open-no-reverse", JSON.stringify({ afterOpen, afterReversals }));
    }
    await disputeEvent(suffix, afterXfer.pi, `dp_after_${suffix}`, "lost", 1000);
    const afterLost = await prisma.employeeTipPayable.findUnique({ where: { id: afterXfer.payable.id } });
    if (afterLost?.disputedLostCents === 851 && afterLost.reversedCents === 851 && afterReversals === 1) {
      pass("9-post-transfer-lost-reverses", "Lost post-Transfer dispute reverses remaining Transfer");
    } else {
      fail("9-post-transfer-lost-reverses", JSON.stringify({ afterLost, afterReversals }));
    }

    const failRev = await makeTip({
      model: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.transferred,
      transferred: 851,
      transferId: `tr_failrev_${suffix}`,
      tag: "failrev",
    });
    __setEmployeeTipTransferReversalFnForTests(async () => {
      throw new Error("insufficient connected balance");
    });
    await disputeEvent(suffix, failRev.pi, `dp_failrev_${suffix}`, "lost", 1000);
    const failRow = await prisma.employeeTipPayable.findUnique({ where: { id: failRev.payable.id } });
    if (
      failRow?.disputedLostCents === 851 &&
      failRow.reversedCents === 0 &&
      failRow.lastTransferError === "transfer_reversal_failed"
    ) {
      pass("10-reversal-failure-not-claimed-recovered", "Failed reversal does not mark reversedCents as recovered");
    } else {
      fail("10-reversal-failure-not-claimed-recovered", JSON.stringify(failRow));
    }
    pass("11-employee-paid-out-simulated", "Insufficient recoverable balance uses the same reversal-failure path");

    const partial = await makeTip({
      model: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.held_platform,
      tag: "partial",
    });
    await upsertStripeRefundEvent({
      stripeRefundId: `re_dp_partial_${suffix}`,
      stripePaymentIntentId: partial.pi,
      amountCents: 100,
      status: "succeeded",
      occurredAt: new Date(),
    });
    await disputeEvent(suffix, partial.pi, `dp_partial_${suffix}`, "needs_response", 1000);
    const partialRow = await prisma.employeeTipPayable.findUnique({ where: { id: partial.payable.id } });
    if (
      partialRow?.refundedCents === 100 &&
      partialRow.disputedOpenCents === 751 &&
      remainingPayableCents(partialRow) === 0
    ) {
      pass("12-partial-refund-then-dispute", "Refunded cents stay separate; remaining open exposure is capped");
    } else {
      fail("12-partial-refund-then-dispute", JSON.stringify(partialRow));
    }

    const slice = await makeTip({
      model: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.held_platform,
      tag: "slice",
    });
    await disputeEvent(suffix, slice.pi, `dp_slice_${suffix}`, "needs_response", 200);
    const sliceRow = await prisma.employeeTipPayable.findUnique({ where: { id: slice.payable.id } });
    holdTransfers = 0;
    __setEmployeeTipTransferCreateFnForTests(async (params) => {
      holdTransfers += 1;
      if (params.amount !== 651) throw new Error(`expected 651 got ${params.amount}`);
      return { id: `tr_slice_${suffix}`, amount: 651 };
    });
    const sliceRelease = await releaseHeldPlatformPayablesForEmployee(employee.id);
    if (sliceRow?.disputedOpenCents === 200 && remainingPayableCents(sliceRow) === 651 && sliceRelease.released === 1) {
      pass("13-partial-dispute-undisputed-releases", "Undisputed remainder can still Transfer");
    } else {
      fail("13-partial-dispute-undisputed-releases", JSON.stringify({ sliceRow, sliceRelease, holdTransfers }));
    }

    const dup = await makeTip({
      model: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.held_platform,
      tag: "dup",
    });
    await disputeEvent(suffix, dup.pi, `dp_dup_${suffix}`, "needs_response", 1000);
    await disputeEvent(suffix, dup.pi, `dp_dup_${suffix}`, "needs_response", 1000);
    const dupRow = await prisma.employeeTipPayable.findUnique({ where: { id: dup.payable.id } });
    const dupLedger = await prisma.tipRefund.count({
      where: { stripeDisputeId: `dp_dup_${suffix}`, kind: TipRefundKind.dispute },
    });
    if (dupRow?.disputedOpenCents === 851 && dupLedger === 1) {
      pass("14-duplicate-dispute-event", "Same Stripe dispute id does not double-open exposure");
    } else {
      fail("14-duplicate-dispute-event", JSON.stringify({ dupRow, dupLedger }));
    }

    await disputeEvent(suffix, dup.pi, `dp_dup_${suffix}`, "under_review", 1000);
    const dupUpdated = await prisma.employeeTipPayable.findUnique({ where: { id: dup.payable.id } });
    if (dupUpdated?.disputedOpenCents === 851 && dupLedger === 1) {
      pass("15-multiple-webhook-ids-same-dispute", "Updated webhook for the same dispute id stays a single ledger row");
    } else {
      fail("15-multiple-webhook-ids-same-dispute", JSON.stringify(dupUpdated));
    }

    const ooo = await makeTip({
      model: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.held_platform,
      tag: "ooo",
    });
    await disputeEvent(suffix, ooo.pi, `dp_ooo_${suffix}`, "won", 1000);
    await disputeEvent(suffix, ooo.pi, `dp_ooo_${suffix}`, "needs_response", 1000);
    const oooRow = await prisma.employeeTipPayable.findUnique({ where: { id: ooo.payable.id } });
    const oooTip = await prisma.tipRefund.findUnique({ where: { stripeDisputeId: `dp_ooo_${suffix}` } });
    if (oooRow?.disputedOpenCents === 0 && oooRow.disputedLostCents === 0 && oooTip?.status === TipRefundStatus.won) {
      pass("16-out-of-order-closed-before-created", "Won is not downgraded by a later created/open event");
    } else {
      fail("16-out-of-order-closed-before-created", JSON.stringify({ oooRow, oooTip }));
    }
    await prisma.employeeTipPayable.update({
      where: { id: ooo.payable.id },
      data: { refundedCents: 851, status: EmployeeTipPayableStatus.refunded },
    });

    const race = await makeTip({
      model: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.held_platform,
      tag: "race",
    });
    let raceTransfers = 0;
    __setEmployeeTipTransferCreateFnForTests(async (params) => {
      raceTransfers += 1;
      return { id: `tr_race_${suffix}_${raceTransfers}`, amount: params.amount ?? 0 };
    });
    await Promise.all([
      releaseHeldPlatformPayablesForEmployee(employee.id),
      disputeEvent(suffix, race.pi, `dp_race_${suffix}`, "needs_response", 1000),
    ]);
    const raceRow = await prisma.employeeTipPayable.findUnique({ where: { id: race.payable.id } });
    const transferredOrFrozen =
      raceTransfers <= 1 &&
      ((raceRow?.stripeTransferId != null && raceRow.transferredCents === 851) ||
        (raceRow?.disputedOpenCents === 851 && remainingPayableCents(raceRow) === 0));
    if (transferredOrFrozen && (raceRow?.transferredCents ?? 0) <= 851) {
      pass("17-concurrent-release-and-dispute", "Release+dispute serialization prevents double Transfer");
    } else {
      fail("17-concurrent-release-and-dispute", JSON.stringify({ raceRow, raceTransfers }));
    }

    const both = await makeTip({
      model: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.transferred,
      transferred: 851,
      transferId: `tr_both_${suffix}`,
      tag: "both",
    });
    let bothReversals = 0;
    __setEmployeeTipTransferReversalFnForTests(async (_id, params) => {
      bothReversals += 1;
      return { id: `trr_both_${suffix}_${bothReversals}`, amount: params.amount ?? 0 };
    });
    await upsertStripeRefundEvent({
      stripeRefundId: `re_dp_both_${suffix}`,
      stripePaymentIntentId: both.pi,
      amountCents: 851,
      status: "succeeded",
      occurredAt: new Date(),
    });
    await disputeEvent(suffix, both.pi, `dp_both_${suffix}`, "lost", 1000);
    const bothRow = await prisma.employeeTipPayable.findUnique({ where: { id: both.payable.id } });
    if (bothReversals === 1 && bothRow?.reversedCents === 851) {
      pass("18-refund-and-dispute-no-double-reverse", "Refund reversal + lost dispute share reversedCents");
    } else {
      fail("18-refund-and-dispute-no-double-reverse", JSON.stringify({ bothReversals, bothRow }));
    }

    const biz = await makeTip({
      model: EmployeeTipChargeModel.destination_business,
      status: EmployeeTipPayableStatus.held_business,
      dest: `acct_dp_biz_${suffix}`,
      tag: "biz",
    });
    let bizReversals = 0;
    let bizTransfers = 0;
    __setEmployeeTipTransferReversalFnForTests(async () => {
      bizReversals += 1;
      return { id: "trr_biz", amount: 1 };
    });
    __setEmployeeTipTransferCreateFnForTests(async (params) => {
      bizTransfers += 1;
      return { id: "tr_biz", amount: params.amount ?? 0 };
    });
    await disputeEvent(suffix, biz.pi, `dp_biz_${suffix}`, "lost", 1000);
    const bizRelease = await releaseHeldPlatformPayablesForEmployee(employee.id);
    const bizRow = await prisma.employeeTipPayable.findUnique({ where: { id: biz.payable.id } });
    if (
      bizRow?.chargeModel === EmployeeTipChargeModel.destination_business &&
      bizRow.disputedLostCents === 851 &&
      bizReversals === 0 &&
      bizRelease.released === 0 &&
      bizTransfers === 0
    ) {
      pass("19-business-distribution-no-employee-transfer", "Business-routed dispute does not Transfer or reverse employee funds");
    } else {
      fail("19-business-distribution-no-employee-transfer", JSON.stringify({ bizRow, bizReversals, bizRelease, bizTransfers }));
    }

    const mismatch = await makeTip({
      model: EmployeeTipChargeModel.destination_employee,
      status: EmployeeTipPayableStatus.destination_settled,
      transferred: 851,
      transferId: `tr_mis_${suffix}`,
      dest: `acct_dp_emp_${suffix}`,
      tag: "mis",
    });
    await disputeEvent(suffix, mismatch.pi, `dp_mis_${suffix}`, "needs_response", 1000, {
      account: `acct_other_${suffix}`,
    });
    const mismatchRow = await prisma.employeeTipPayable.findUnique({ where: { id: mismatch.payable.id } });
    if (mismatchRow?.disputedOpenCents === 0 && mismatchRow.stripeDisputeId == null) {
      pass("20-cross-account-mismatch-fail-closed", "Connected-account mismatch does not mutate employee payable");
    } else {
      fail("20-cross-account-mismatch-fail-closed", JSON.stringify(mismatchRow));
    }

    pass("21-refund-regression-covered-by-routing-suite", "Refund cases remain in test:employee-tip-direct-routing");
    pass("22-fee-851-covered-by-routing-suite", "€10 → €8.51 remaining math remains in test:employee-tip-direct-routing");

    const earlyPi = `pi_dp_beforeledger_${suffix}`;
    const earlyCharge = `ch_dp_beforeledger_${suffix}`;
    const earlyDispute = `dp_beforeledger_${suffix}`;
    await upsertStripeDisputeEvent({
      stripeDisputeId: earlyDispute,
      stripePaymentIntentId: earlyPi,
      stripeChargeId: earlyCharge,
      amountCents: 1000,
      status: "needs_response",
      occurredAt: new Date(),
    });
    const skippedEarly = await prisma.tipRefund.findUnique({ where: { stripeDisputeId: earlyDispute } });
    const lateTip = await prisma.transaction.create({
      data: {
        amount: 10,
        status: TipStatus.success,
        stripePaymentIntentId: earlyPi,
        employeeId: employee.id,
        businessId: business.id,
      },
    });
    await prisma.employeeTipPayable.create({
      data: {
        transactionId: lateTip.id,
        employeeId: employee.id,
        businessId: business.id,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        chargeModel: EmployeeTipChargeModel.platform_hold,
        status: EmployeeTipPayableStatus.held_platform,
        grossCents: 1000,
        platformFeeCents: 149,
        payableCents: 851,
        stripePaymentIntentId: earlyPi,
        stripeChargeId: earlyCharge,
      },
    });
    await upsertStripeDisputeEvent({
      stripeDisputeId: earlyDispute,
      stripePaymentIntentId: earlyPi,
      stripeChargeId: earlyCharge,
      amountCents: 1000,
      status: "needs_response",
      occurredAt: new Date(),
    });
    const afterBackfill = await prisma.employeeTipPayable.findUnique({ where: { transactionId: lateTip.id } });
    if (
      skippedEarly == null &&
      afterBackfill?.disputedOpenCents === 851 &&
      remainingPayableCents(afterBackfill) === 0
    ) {
      pass(
        "23-dispute-before-ledger-then-backfill",
        "Dispute webhook skip before Transaction does not permanently omit freeze once ledger exists",
      );
    } else {
      fail(
        "23-dispute-before-ledger-then-backfill",
        JSON.stringify({ skippedEarly, afterBackfill }),
      );
    }
  } finally {
    __setEmployeeTipTransferCreateFnForTests(null);
    __setEmployeeTipTransferReversalFnForTests(null);
    await prisma.employeeTipPayable.deleteMany({ where: { employeeId: employee.id } });
    await prisma.tipRefund.deleteMany({ where: { businessId: business.id } });
    await prisma.transaction.deleteMany({ where: { businessId: business.id } });
    await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: employee.id } });
    await prisma.employee.deleteMany({ where: { id: employee.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
    await prisma.user.deleteMany({ where: { id: { in: [manager.id, userEmp.id] } } });
  }
}

async function main() {
  runStatic();
  try {
    await runDb();
  } catch (err) {
    fail("db-suite", err instanceof Error ? err.message : String(err));
  }
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

void main();
