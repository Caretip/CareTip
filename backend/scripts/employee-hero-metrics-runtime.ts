/**
 * Employee hero metrics (Gross tips / Paid to you / Pending): financial source-of-truth regressions.
 * Synthetic fixtures only; run against an isolated database:
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=... node scripts/safe-test.mjs test:employee-hero-metrics
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  TipRefundKind,
  TipRefundStatus,
} from "@prisma/client";
import { loadEmployeeFinancialMetrics } from "../src/services/employeeFinancialMetrics.service.js";
import { upsertStripeRefundEvent } from "../src/services/finance/tipRefunds.service.js";
import { businessDistributionRemainingObligationForBusiness } from "../src/services/tipDistribution.service.js";
import { prisma } from "../src/prisma.js";

let passed = 0;
function check(id: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ✓ ${id}`);
  });
}
const approx = (a: number, b: number, label: string) =>
  assert.ok(Math.abs(a - b) < 0.005, `${label}: expected ${b}, got ${a}`);

const suffix = `hero_${Date.now()}`;
const created = { users: [] as string[], businesses: [] as string[], employees: [] as string[] };

async function makeBusiness(tag: string, mode: EmployeeTipPayoutMode) {
  const manager = await prisma.user.create({
    data: { email: `hero-mgr-${tag}-${suffix}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true },
  });
  created.users.push(manager.id);
  const biz = await prisma.business.create({
    data: {
      name: `Hero ${tag} ${suffix}`,
      slug: `hero-${tag}-${suffix}`.replace(/_/g, "-"),
      userId: manager.id,
      stripeAccountId: `acct_hero_${tag}_${suffix}`,
      stripeConnectStatus: "ready",
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      employeeTipPayoutMode: mode,
    },
  });
  created.businesses.push(biz.id);
  return { manager, biz };
}

async function makeEmployee(businessId: string, tag: string) {
  const user = await prisma.user.create({
    data: { email: `hero-emp-${tag}-${suffix}@example.com`, passwordHash: "x", role: "EMPLOYEE", emailVerified: true },
  });
  created.users.push(user.id);
  const emp = await prisma.employee.create({ data: { name: `Hero ${tag}`, jobTitle: "Server", businessId, userId: user.id } });
  created.employees.push(emp.id);
  return emp;
}

let tipSeq = 0;
/** One successful tip plus its payable row, as the payment webhook would create them. */
async function tip(p: {
  employeeId: string;
  businessId: string;
  eur: number;
  mode: EmployeeTipPayoutMode;
  status: EmployeeTipPayableStatus;
  transferredCents?: number;
  refundedCents?: number;
  disputedOpenCents?: number;
  disputedLostCents?: number;
}) {
  tipSeq += 1;
  const pi = `pi_hero_${suffix}_${tipSeq}`;
  const grossCents = Math.round(p.eur * 100);
  const platformFeeCents = Math.round(grossCents * 0.1);
  const payableCents = grossCents - platformFeeCents;
  const t = await prisma.transaction.create({
    data: { amount: p.eur, status: "success", employeeId: p.employeeId, businessId: p.businessId, stripePaymentIntentId: pi },
  });
  const payable = await prisma.employeeTipPayable.create({
    data: {
      transactionId: t.id,
      employeeId: p.employeeId,
      businessId: p.businessId,
      routingMode: p.mode,
      chargeModel:
        p.mode === EmployeeTipPayoutMode.business_distribution
          ? EmployeeTipChargeModel.destination_business
          : EmployeeTipChargeModel.platform_hold,
      status: p.status,
      grossCents,
      platformFeeCents,
      payableCents,
      transferredCents: p.transferredCents ?? 0,
      refundedCents: p.refundedCents ?? 0,
      disputedOpenCents: p.disputedOpenCents ?? 0,
      disputedLostCents: p.disputedLostCents ?? 0,
      stripePaymentIntentId: pi,
    },
  });
  return { tip: t, payable, pi, payableCents };
}

async function refundRow(p: {
  businessId: string;
  tipId: string | null;
  pi: string;
  eur: number;
  kind: TipRefundKind;
  status: TipRefundStatus;
}) {
  tipSeq += 1;
  await prisma.tipRefund.create({
    data: {
      businessId: p.businessId,
      tipId: p.tipId,
      stripePaymentIntentId: p.pi,
      ...(p.kind === TipRefundKind.refund
        ? { stripeRefundId: `re_hero_${suffix}_${tipSeq}` }
        : { stripeDisputeId: `dp_hero_${suffix}_${tipSeq}` }),
      kind: p.kind,
      status: p.status,
      amountEur: p.eur,
      currency: "eur",
      occurredAt: new Date(),
    },
  });
}

async function main() {
  console.log("employee-hero-metrics-runtime");
  const { manager: mgrA, biz: bizA } = await makeBusiness("a", EmployeeTipPayoutMode.direct_to_employee);
  const { biz: bizB } = await makeBusiness("b", EmployeeTipPayoutMode.business_distribution);
  const a1 = await makeEmployee(bizA.id, "a1");
  const a2 = await makeEmployee(bizA.id, "a2");
  const b1 = await makeEmployee(bizB.id, "b1");
  const D = EmployeeTipPayoutMode.direct_to_employee;
  const B = EmployeeTipPayoutMode.business_distribution;
  const S = EmployeeTipPayableStatus;

  // --- CareTip-managed tips for A1, one per financial state ---
  const t1 = await tip({ employeeId: a1.id, businessId: bizA.id, eur: 20, mode: D, status: S.destination_settled, transferredCents: 1800 });
  await tip({ employeeId: a1.id, businessId: bizA.id, eur: 30, mode: D, status: S.held_platform }); // pending 27.00
  await tip({ employeeId: a1.id, businessId: bizA.id, eur: 10, mode: D, status: S.transferring }); // pending 9.00, not paid
  await tip({ employeeId: a1.id, businessId: bizA.id, eur: 12, mode: D, status: S.transfer_failed }); // pending 10.80, not paid
  const t5 = await tip({ employeeId: a1.id, businessId: bizA.id, eur: 25, mode: D, status: S.refunded, refundedCents: 2250 });
  await refundRow({ businessId: bizA.id, tipId: t5.tip.id, pi: t5.pi, eur: 25, kind: TipRefundKind.refund, status: TipRefundStatus.succeeded });
  const t6 = await tip({ employeeId: a1.id, businessId: bizA.id, eur: 40, mode: D, status: S.destination_settled, transferredCents: 3600, refundedCents: 900 });
  await refundRow({ businessId: bizA.id, tipId: t6.tip.id, pi: t6.pi, eur: 10, kind: TipRefundKind.refund, status: TipRefundStatus.succeeded });
  const t7 = await tip({ employeeId: a1.id, businessId: bizA.id, eur: 15, mode: D, status: S.destination_settled, transferredCents: 1350, disputedLostCents: 1350 });
  await refundRow({ businessId: bizA.id, tipId: t7.tip.id, pi: t7.pi, eur: 15, kind: TipRefundKind.dispute, status: TipRefundStatus.lost });
  const t8 = await tip({ employeeId: a1.id, businessId: bizA.id, eur: 18, mode: D, status: S.held_platform, disputedOpenCents: 1620 });
  await refundRow({ businessId: bizA.id, tipId: t8.tip.id, pi: t8.pi, eur: 18, kind: TipRefundKind.dispute, status: TipRefundStatus.needs_response });
  const t9 = await tip({ employeeId: a1.id, businessId: bizA.id, eur: 22, mode: D, status: S.destination_settled, transferredCents: 1980 });
  await refundRow({ businessId: bizA.id, tipId: t9.tip.id, pi: t9.pi, eur: 22, kind: TipRefundKind.dispute, status: TipRefundStatus.won });
  // A refund that has not succeeded yet must not reduce anything.
  await refundRow({ businessId: bizA.id, tipId: t1.tip.id, pi: t1.pi, eur: 5, kind: TipRefundKind.refund, status: TipRefundStatus.pending });
  // A succeeded refund stored before its tip row was linked (tip_id NULL): matched by PaymentIntent.
  const t11 = await tip({ employeeId: a1.id, businessId: bizA.id, eur: 8, mode: D, status: S.destination_settled, transferredCents: 720, refundedCents: 270 });
  await refundRow({ businessId: bizA.id, tipId: null, pi: t11.pi, eur: 3, kind: TipRefundKind.refund, status: TipRefundStatus.succeeded });

  // Expected before the switch:
  // gross = 20 + 30 + 10 + 12 + (25-25) + (40-10) + (15-15) + 18 + 22 + (8-3) = 147
  // paid  = 18.00 (t1) + 27.00 (t6: 36.00 - 9.00 refunded) + 0 (t7 lost) + 19.80 (t9) + 4.50 (t11: 7.20 - 2.70) = 69.30
  // pending = 27.00 (held) + 9.00 (transferring) + 10.80 (failed) + 0 (t8: open dispute) = 46.80
  const before = await loadEmployeeFinancialMetrics(a1.id);

  await check("1-3. gross counts every successful tip at its pre-fee amount; fees do not reduce it", () => {
    approx(before.grossTipsEur, 147, "gross");
    assert.ok(before.grossTipsEur > before.employeeEarningsEur, "gross is above the after-fee entitlement");
  });
  await check("7-9. paid = Stripe-confirmed transfers only; transferring/failed/held are not paid", () => {
    approx(before.paidToStripeEur, 69.3, "paid");
  });
  await check("8-9. pending = held + in flight + failed-awaiting-retry, minus refunds and open disputes", () => {
    approx(before.pendingReleaseEur, 46.8, "pending");
  });
  await check("10. full and partial refunds reduce gross by the refunded amount; pending refunds do not", () => {
    // Covered by the 147 total: t5 (-25 full), t6 (-10 partial), t11 (-3, tip_id NULL), t1 pending refund (0).
    approx(before.grossTipsEur, 147, "gross with refunds");
  });
  await check("11. lost disputes reduce gross and paid; open disputes are not pending; won disputes stay", () => {
    approx(before.grossTipsEur, 147, "gross with disputes");
  });
  await check("flags: CareTip-managed only before the switch", () => {
    assert.equal(before.hasCareTipManagedTips, true);
    assert.equal(before.hasBusinessManagedTips, false);
  });

  // --- 12. duplicate Stripe refund delivery through the real webhook path ---
  const t12 = await tip({ employeeId: a1.id, businessId: bizA.id, eur: 6, mode: D, status: S.destination_settled, transferredCents: 540 });
  const refundEvent = {
    stripeRefundId: `re_hero_dup_${suffix}`,
    stripePaymentIntentId: t12.pi,
    amountCents: 200,
    currency: "eur",
    status: "succeeded",
    occurredAt: new Date(),
    businessId: bizA.id,
    tipId: t12.tip.id,
  };
  await upsertStripeRefundEvent(refundEvent);
  const afterFirst = await loadEmployeeFinancialMetrics(a1.id);
  await upsertStripeRefundEvent(refundEvent);
  await upsertStripeRefundEvent(refundEvent);
  const afterDup = await loadEmployeeFinancialMetrics(a1.id);
  await check("12. the same Stripe refund delivered three times deducts once", () => {
    approx(afterFirst.grossTipsEur, 147 + 6 - 2, "gross after first delivery");
    approx(afterDup.grossTipsEur, afterFirst.grossTipsEur, "gross after duplicates");
    approx(afterDup.paidToStripeEur, afterFirst.paidToStripeEur, "paid after duplicates");
    approx(afterDup.pendingReleaseEur, afterFirst.pendingReleaseEur, "pending after duplicates");
  });
  const base = afterDup;

  // --- 4-6. the business switches to managing distribution itself ---
  await prisma.business.update({ where: { id: bizA.id }, data: { employeeTipPayoutMode: B } });
  const bt1 = await tip({ employeeId: a1.id, businessId: bizA.id, eur: 50, mode: B, status: S.held_business });
  const afterSwitch = await loadEmployeeFinancialMetrics(a1.id);
  await tip({ employeeId: a1.id, businessId: bizA.id, eur: 35, mode: B, status: S.held_business });
  const afterMore = await loadEmployeeFinancialMetrics(a1.id);

  await check("4-5. gross keeps growing after the switch (+50, then +35); it does not freeze or reset", () => {
    approx(afterSwitch.grossTipsEur, base.grossTipsEur + 50, "gross after switch");
    approx(afterMore.grossTipsEur, base.grossTipsEur + 85, "gross after more tips");
  });
  await check("6. historical CareTip-managed tips keep their paid/pending after the switch", () => {
    approx(afterMore.paidToStripeEur, base.paidToStripeEur, "paid unchanged");
    approx(afterMore.pendingReleaseEur, base.pendingReleaseEur, "pending unchanged");
    assert.equal(afterMore.hasCareTipManagedTips, true);
    assert.equal(afterMore.hasBusinessManagedTips, true);
  });
  await check("H1. held by workplace = business-managed tips after CareTip fees (45.00 + 31.50)", () => {
    approx(base.businessHeldEur, 0, "nothing held by the workplace before the switch");
    approx(afterSwitch.businessHeldEur, 45, "after first business-managed tip");
    approx(afterMore.businessHeldEur, 76.5, "after second business-managed tip");
  });

  // --- 13-14. business-level and business-reported money is never attributed to the employee ---
  const batch = await prisma.employeeTipDistributionBatch.create({
    data: {
      businessId: bizA.id,
      actorUserId: mgrA.id,
      completedAt: new Date(),
      totalAmountCents: 8500,
      employeeCount: 1,
      idempotencyKey: `hero-${suffix}`,
    },
  });
  const item = await prisma.employeeTipDistributionItem.create({
    data: { batchId: batch.id, businessId: bizA.id, employeeId: a1.id, amountCents: 2000 },
  });
  // Recorded distributions are allocated to specific tips, as createTipDistributionBatch does.
  await prisma.employeeTipDistributionAllocation.create({
    data: { itemId: item.id, businessId: bizA.id, employeeTipPayableId: bt1.payable.id, amountCents: 2000 },
  });
  const afterReported = await loadEmployeeFinancialMetrics(a1.id);
  await check("13-14. a business-reported distribution is not counted as paid (not verifiable)", () => {
    approx(afterReported.paidToStripeEur, base.paidToStripeEur, "paid ignores self-reported distribution");
    approx(afterReported.pendingReleaseEur, base.pendingReleaseEur, "pending ignores business-managed tips");
  });
  await check("H2. a recorded distribution reduces what the workplace still holds (76.50 - 20.00)", () => {
    approx(afterReported.businessHeldEur, 56.5, "held after recorded distribution");
    approx(afterReported.grossTipsEur, afterMore.grossTipsEur, "gross unchanged by distributions");
  });

  // --- switching back to CareTip-managed: new tips count as paid/pending again ---
  await prisma.business.update({ where: { id: bizA.id }, data: { employeeTipPayoutMode: D } });
  await tip({ employeeId: a1.id, businessId: bizA.id, eur: 10, mode: D, status: S.held_platform });
  const afterBack = await loadEmployeeFinancialMetrics(a1.id);
  await check("E. switching back: gross +10, pending +9.00; business-managed history unchanged", () => {
    approx(afterBack.grossTipsEur, afterReported.grossTipsEur + 10, "gross after switching back");
    approx(afterBack.pendingReleaseEur, afterReported.pendingReleaseEur + 9, "pending after switching back");
    assert.equal(afterBack.hasBusinessManagedTips, true);
  });

  // --- employee whose tips are all business-managed: paid/pending unknown, not zero ---
  await tip({ employeeId: b1.id, businessId: bizB.id, eur: 40, mode: B, status: S.held_business });
  // A partly refunded business-managed tip: 20.00 gross, 18.00 payable, 10.00 refunded (ledger caps at payable).
  const bRef = await tip({ employeeId: b1.id, businessId: bizB.id, eur: 20, mode: B, status: S.held_business, refundedCents: 1000 });
  await refundRow({ businessId: bizB.id, tipId: bRef.tip.id, pi: bRef.pi, eur: 10, kind: TipRefundKind.refund, status: TipRefundStatus.succeeded });
  const onlyBiz = await loadEmployeeFinancialMetrics(b1.id);
  await check("H3. held by workplace excludes refunded amounts (36.00 + 18.00 - 10.00)", () => {
    approx(onlyBiz.businessHeldEur, 44, "held after partial refund");
  });
  const bizBObligation = await businessDistributionRemainingObligationForBusiness(bizB.id);
  await check("H4. employee view matches the manager's 'to distribute' figure for the same business", () => {
    approx(onlyBiz.businessHeldEur, bizBObligation.remainingDistributableCents / 100, "employee vs business");
  });
  await check("14. business-managed only: gross counted, paid/pending flagged unverifiable", () => {
    approx(onlyBiz.grossTipsEur, 50, "gross (40 + 20 - 10 refunded)");
    assert.equal(onlyBiz.hasCareTipManagedTips, false);
    assert.equal(onlyBiz.hasBusinessManagedTips, true);
    approx(onlyBiz.paidToStripeEur, 0, "no fabricated paid");
  });

  // --- 15-16. isolation ---
  const otherEmployee = await loadEmployeeFinancialMetrics(a2.id);
  await check("15. employee A2 (same business) sees none of A1's money", () => {
    approx(otherEmployee.grossTipsEur, 0, "A2 gross");
    approx(otherEmployee.paidToStripeEur, 0, "A2 paid");
    approx(otherEmployee.pendingReleaseEur, 0, "A2 pending");
    approx(otherEmployee.businessHeldEur, 0, "A2 held by workplace");
  });
  await check("16. employee B1 (other business) sees only B1's tips", () => {
    approx(onlyBiz.grossTipsEur, 50, "B1 gross excludes business A");
    approx(onlyBiz.businessHeldEur, 44, "B1 held excludes business A");
  });
  await check("15-16. the API resolves the employee from the signed-in user, never from the request", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const controller = readFileSync(path.join(here, "../src/controllers/tips.controller.ts"), "utf8");
    assert.match(controller, /getEmployeeTipsContext\(userId\)/);
    assert.match(controller, /loadEmployeeAccountSummary\(employee\.id\)/);
    assert.doesNotMatch(controller, /loadEmployeeAccountSummary\(req\./);
  });

  // --- cleanup (dependency order) ---
  await prisma.employeeTipDistributionAllocation.deleteMany({ where: { itemId: item.id } });
  await prisma.employeeTipDistributionItem.deleteMany({ where: { batchId: batch.id } });
  await prisma.employeeTipDistributionBatch.deleteMany({ where: { id: batch.id } });
  await prisma.tipRefund.deleteMany({ where: { businessId: { in: created.businesses } } });
  await prisma.employeeTipPayable.deleteMany({ where: { businessId: { in: created.businesses } } });
  await prisma.transaction.deleteMany({ where: { businessId: { in: created.businesses } } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.business.deleteMany({ where: { id: { in: created.businesses } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });

  console.log(`employee-hero-metrics-runtime: OK (${passed} checks)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
