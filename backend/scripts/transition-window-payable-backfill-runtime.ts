/**
 * Isolated test for the transition-window payable backfill (no Stripe calls; facts are fixtures
 * shaped like the two 2026-09-10 tips).
 *
 *   npm run test:transition-window-payable-backfill
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Role,
  StripeConnectStatus,
  TipRefundKind,
  TipRefundStatus,
  TipStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  applyDisputeToEmployeePayable,
  remainingPayableCents,
} from "../src/services/employeeTipPayable.service.js";
import { releaseHeldPlatformPayablesForEmployee } from "../src/services/employeeTipRelease.service.js";
import { tickEmployeeTipReleaseReconciliation } from "../src/services/employeeTipReleaseReconciliation.service.js";
import {
  __clearEmployeeTipStripeCreateAuditForTests,
  __getEmployeeTipStripeCreateAuditForTests,
} from "../src/lib/employeeTipReleaseStripeCreateAudit.js";
import {
  applyTransitionWindowPayable,
  planTransitionWindowPayable,
  TransitionBackfillAbort,
  type TransitionTipStripeFacts,
} from "./lib/transitionWindowPayableBackfill.js";

let failures = 0;
async function check(id: string, fn: () => Promise<string>) {
  try {
    console.log(`PASS  ${id}  ${await fn()}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${id}  ${err instanceof Error ? err.message : String(err)}`);
  }
}

const sfx = `twb_${Date.now()}`;

async function seed() {
  const manager = await prisma.user.create({
    data: { email: `twb-mgr-${sfx}@example.com`, passwordHash: await bcrypt.hash("Testpass1!", 4), role: Role.MANAGER, emailVerified: true },
  });
  const business = await prisma.business.create({
    data: {
      name: `TWB ${sfx}`,
      slug: `twb-${sfx}`,
      userId: manager.id,
      stripeAccountId: `acct_twb_biz_${sfx}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employee = await prisma.employee.create({
    data: { name: `Emp ${sfx}`, jobTitle: "Server", businessId: business.id, activationStatus: "active" },
  });
  await prisma.employeeStripeAccount.create({
    data: { employeeId: employee.id, stripeAccountId: `acct_twb_emp_${sfx}`, stripeConnectStatus: StripeConnectStatus.onboarding_required },
  });
  const mkTip = (n: number) =>
    prisma.transaction.create({
      data: { amount: 10, status: TipStatus.success, stripePaymentIntentId: `pi_twb_${n}_${sfx}`, employeeId: employee.id, businessId: business.id },
    });
  const tipClean = await mkTip(1);
  const tipLost = await mkTip(2);
  const tipRace = await mkTip(3);
  const tipBad = await mkTip(4);
  const tipDrift = await mkTip(5);
  await prisma.tipRefund.create({
    data: {
      businessId: business.id,
      tipId: tipLost.id,
      stripeDisputeId: `du_twb_${sfx}`,
      stripePaymentIntentId: tipLost.stripePaymentIntentId,
      stripeChargeId: `ch_twb_2_${sfx}`,
      kind: TipRefundKind.dispute,
      status: TipRefundStatus.lost,
      amountEur: 10,
      originalAmountEur: 10,
      occurredAt: new Date(),
    },
  });
  return { manager, business, employee, tipClean, tipLost, tipRace, tipBad, tipDrift };
}

function facts(n: number, businessAcct: string, over: Partial<TransitionTipStripeFacts> = {}): TransitionTipStripeFacts {
  return {
    livemode: false,
    paymentIntentId: `pi_twb_${n}_${sfx}`,
    paymentIntentStatus: "succeeded",
    amountReceivedCents: 1000,
    currency: "eur",
    applicationFeeAmountCents: 149,
    destinationAccountId: businessAcct,
    chargeId: `ch_twb_${n}_${sfx}`,
    chargeAmountRefundedCents: 0,
    chargeTransferId: `tr_twb_${n}_${sfx}`,
    transferAmountCents: 1000,
    transferDestinationAccountId: businessAcct,
    transferAmountReversedCents: 0,
    disputes: [],
    ...over,
  };
}

async function main() {
  console.log("=== Transition-window payable backfill (isolated) ===");
  const s = await seed();
  const acct = s.business.stripeAccountId!;
  const lostFacts = facts(2, acct, { disputes: [{ id: `du_twb_${sfx}`, status: "lost", amountCents: 1000 }] });

  await check("dry-run-no-writes", async () => {
    const p1 = await planTransitionWindowPayable(s.tipClean.id, facts(1, acct));
    const p2 = await planTransitionWindowPayable(s.tipLost.id, lostFacts);
    assert.equal(p1.kind, "create");
    assert.equal(p2.kind, "create");
    assert.equal(await prisma.employeeTipPayable.count({ where: { businessId: s.business.id } }), 0);
    return "plans computed, 0 rows written";
  });

  await check("apply-exact-values", async () => {
    for (const [tipId, f] of [[s.tipClean.id, facts(1, acct)], [s.tipLost.id, lostFacts]] as const) {
      const plan = await planTransitionWindowPayable(tipId, f);
      assert.equal(plan.kind, "create");
      assert.equal(await applyTransitionWindowPayable(plan as Extract<typeof plan, { kind: "create" }>), "created");
    }
    const clean = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: s.tipClean.id } });
    const lost = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: s.tipLost.id } });
    for (const row of [clean, lost]) {
      assert.equal(row.chargeModel, EmployeeTipChargeModel.destination_business);
      assert.equal(row.routingMode, EmployeeTipPayoutMode.business_distribution);
      assert.equal(row.status, EmployeeTipPayableStatus.held_business);
      assert.equal(row.grossCents, 1000);
      assert.equal(row.platformFeeCents, 149);
      assert.equal(row.payableCents, 851);
      assert.equal(row.transferredCents, 0);
      assert.equal(row.reversedCents, 0);
      assert.equal(row.refundedCents, 0);
      assert.equal(row.stripeDestinationAccountId, acct);
      assert.equal(row.employeeId, s.employee.id);
    }
    assert.equal(clean.stripeTransferId, `tr_twb_1_${sfx}`);
    assert.equal(clean.disputedLostCents, 0);
    assert.equal(clean.stripeDisputeId, null);
    assert.equal(lost.stripeTransferId, `tr_twb_2_${sfx}`);
    assert.equal(lost.disputedLostCents, 851);
    assert.equal(lost.disputedOpenCents, 0);
    assert.equal(lost.stripeDisputeId, `du_twb_${sfx}`);
    assert.equal(remainingPayableCents(clean), 851);
    assert.equal(remainingPayableCents(lost), 0);
    return "held_business 1000/149/851; lost-dispute row owes 0, clean row owes 851";
  });

  await check("rerun-idempotent", async () => {
    const before = await prisma.employeeTipPayable.findMany({ where: { businessId: s.business.id }, orderBy: { id: "asc" } });
    for (const [tipId, f] of [[s.tipClean.id, facts(1, acct)], [s.tipLost.id, lostFacts]] as const) {
      const plan = await planTransitionWindowPayable(tipId, f);
      assert.equal(plan.kind, "already_present");
      assert.ok(plan.kind === "already_present" && plan.matches, plan.kind === "already_present" ? plan.diffs.join("; ") : "");
    }
    const after = await prisma.employeeTipPayable.findMany({ where: { businessId: s.business.id }, orderBy: { id: "asc" } });
    assert.deepEqual(after, before);
    return "second run plans already_present (matches) and writes nothing";
  });

  await check("concurrent-apply-single-row", async () => {
    const plan = await planTransitionWindowPayable(s.tipRace.id, facts(3, acct));
    assert.equal(plan.kind, "create");
    const p = plan as Extract<typeof plan, { kind: "create" }>;
    const results = await Promise.all([applyTransitionWindowPayable(p), applyTransitionWindowPayable(p), applyTransitionWindowPayable(p)]);
    assert.equal(results.filter((r) => r === "created").length, 1, results.join(","));
    assert.equal(await prisma.employeeTipPayable.count({ where: { transactionId: s.tipRace.id } }), 1);
    return `results=${results.sort().join(",")}`;
  });

  await check("webhook-replay-after-backfill", async () => {
    const before = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: s.tipLost.id } });
    const r = await applyDisputeToEmployeePayable({
      transactionId: s.tipLost.id,
      stripeDisputeId: `du_twb_${sfx}`,
      disputeAmountCents: 1000,
      stripeStatus: "lost",
    });
    assert.equal(r, "applied");
    const after = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: s.tipLost.id } });
    assert.equal(after.disputedLostCents, before.disputedLostCents);
    assert.equal(after.disputedOpenCents, before.disputedOpenCents);
    assert.equal(after.reversedCents, 0);
    assert.equal(after.status, before.status);
    return "replayed charge.dispute.closed(lost) leaves backfilled values unchanged; no reversal";
  });

  await check("no-transfer-or-payout-path", async () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "lib", "transitionWindowPayableBackfill.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.ok(
      !/getStripe|new Stripe|from "stripe"|transfers\.|payouts\.|release\w*\(|reverse\w*\(/.test(src),
      "backfill library references a Stripe client or money-moving call",
    );

    await prisma.employeeStripeAccount.update({
      where: { employeeId: s.employee.id },
      data: { stripeConnectStatus: StripeConnectStatus.ready, stripePayoutsEnabled: true, stripeDetailsSubmitted: true },
    });
    const before = await prisma.employeeTipPayable.findMany({ where: { businessId: s.business.id }, orderBy: { id: "asc" } });
    __clearEmployeeTipStripeCreateAuditForTests();
    const release = await releaseHeldPlatformPayablesForEmployee(s.employee.id);
    await tickEmployeeTipReleaseReconciliation();
    const after = await prisma.employeeTipPayable.findMany({ where: { businessId: s.business.id }, orderBy: { id: "asc" } });
    assert.equal(release.attempted, 0, JSON.stringify(release));
    assert.equal(__getEmployeeTipStripeCreateAuditForTests().length, 0, "transfer create attempted");
    assert.deepEqual(after, before);
    return `release attempted=${release.attempted}, reconciliation tick ran, 0 transfer creates, rows unchanged (held_business is not release-eligible)`;
  });

  await check("refuses-mismatches", async () => {
    const cases: [string, Partial<TransitionTipStripeFacts>][] = [
      ["fee", { applicationFeeAmountCents: 100 }],
      ["gross", { amountReceivedCents: 900 }],
      ["livemode", { livemode: true }],
      ["destination", { destinationAccountId: "acct_other", transferDestinationAccountId: "acct_other" }],
      ["refunded", { chargeAmountRefundedCents: 1000 }],
      ["reversed", { transferAmountReversedCents: 1000 }],
      ["no-transfer", { chargeTransferId: null, transferAmountCents: null }],
      ["unledgered-dispute", { disputes: [{ id: "du_unknown", status: "lost", amountCents: 1000 }] }],
      ["pi-mismatch", { paymentIntentId: "pi_other" }],
    ];
    for (const [name, over] of cases) {
      const plan = await planTransitionWindowPayable(s.tipBad.id, facts(4, acct, over));
      assert.equal(plan.kind, "blocked", `case ${name} not blocked`);
    }
    const ledgerDisagrees = await planTransitionWindowPayable(
      s.tipLost.id,
      facts(2, acct, { disputes: [{ id: `du_twb_${sfx}`, status: "won", amountCents: 1000 }] }),
    );
    assert.equal(ledgerDisagrees.kind, "blocked");
    assert.equal(await prisma.employeeTipPayable.count({ where: { transactionId: s.tipBad.id } }), 0);
    return `${cases.length + 1} mismatch cases blocked; 0 rows written`;
  });

  await check("apply-rechecks-facts-in-transaction", async () => {
    const plan = await planTransitionWindowPayable(s.tipDrift.id, facts(5, acct));
    assert.equal(plan.kind, "create");
    const p = plan as Extract<typeof plan, { kind: "create" }>;
    const reasons: string[] = [];
    const expectAbort = async (label: string) => {
      await assert.rejects(applyTransitionWindowPayable(p), (err: unknown) => {
        assert.ok(err instanceof TransitionBackfillAbort, `${label}: ${String(err)}`);
        reasons.push(`${label}→${err.reasons.join("/")}`);
        return true;
      });
      assert.equal(await prisma.employeeTipPayable.count({ where: { transactionId: s.tipDrift.id } }), 0, label);
    };
    await prisma.transaction.update({ where: { id: s.tipDrift.id }, data: { amount: 12 } });
    await expectAbort("amount");
    await prisma.transaction.update({ where: { id: s.tipDrift.id }, data: { amount: 10 } });
    const ledger = await prisma.tipRefund.create({
      data: {
        businessId: s.business.id,
        tipId: s.tipDrift.id,
        stripeDisputeId: `du_twb_drift_${sfx}`,
        stripePaymentIntentId: s.tipDrift.stripePaymentIntentId,
        kind: TipRefundKind.dispute,
        status: TipRefundStatus.needs_response,
        amountEur: 10,
        occurredAt: new Date(),
      },
    });
    await expectAbort("new-dispute");
    await prisma.tipRefund.delete({ where: { id: ledger.id } });
    assert.equal(await applyTransitionWindowPayable(p), "created");
    return `aborted without writing: ${reasons.join(", ")}; applies once facts match`;
  });

  await check("drift-detected-not-overwritten", async () => {
    await prisma.employeeTipPayable.update({ where: { transactionId: s.tipClean.id }, data: { platformFeeCents: 100 } });
    const plan = await planTransitionWindowPayable(s.tipClean.id, facts(1, acct));
    assert.ok(plan.kind === "already_present" && !plan.matches && plan.diffs.some((d) => d.startsWith("platformFeeCents")));
    const row = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: s.tipClean.id } });
    assert.equal(row.platformFeeCents, 100);
    return "pre-existing divergent row reported, not overwritten";
  });

  await prisma.$disconnect();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  if (failures) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
