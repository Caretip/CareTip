/**
 * Tip distribution ↔ employee Tip Activity ↔ Stripe Connect access (DB-backed).
 *
 * Disposable loopback Postgres only, via the isolation harness:
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://user@127.0.0.1:PORT/db node scripts/safe-test.mjs test:tip-distribution-employee-activity
 *
 * Covers:
 *   R1 — business distribution data stays readable after the routing setting changes; actions still
 *        limited to business-held shares; cross-tenant reads rejected.
 *   R2 — a business distribution appears on the employee's Tip Activity from the SAME allocation rows
 *        (no second ledger), idempotent + concurrency-safe, employee/tenant isolation, buffer rows never
 *        presented as payouts, refunds after distribution.
 *   R3 — employees can start/resume Stripe Connect onboarding in either routing mode; ownership and
 *        payout readiness are still enforced server-side.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
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
  listEmployeePayableActivityForEmployee,
  remainingPayableCents,
  type EmployeePayableActivityFilter,
  type EmployeePayableActivityItem,
} from "../src/services/employeeTipPayable.service.js";
import {
  createTipDistributionBatch,
  getTipDistributionBatchForBusiness,
  listTipDistributionBatchesForBusiness,
  listTipDistributionEmployeesForBusiness,
  loadTipDistributionSummaryForBusiness,
  TipDistributionError,
} from "../src/services/tipDistribution.service.js";
import {
  __setEmployeeCreateV2AccountFnForTests,
  createEmployeeConnectAccountLink,
  getEmployeeConnectStatusForUser,
} from "../src/services/employeeStripeConnect.service.js";
import { __setCreateV2AccountLinkFnForTests } from "../src/services/stripeConnect.service.js";
import { getEmployeeInstantPayoutEligibilityForUser } from "../src/services/employeeInstantPayout.service.js";
import * as tipDistributionController from "../src/controllers/tipDistribution.controller.js";
import * as employeeConnectController from "../src/controllers/employeeConnect.controller.js";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs against a disposable loopback database.");
  process.exit(1);
}
const dbHost = (() => {
  try {
    return new URL((process.env.DATABASE_URL ?? "").replace(/^postgres(ql)?:\/\//i, "http://")).hostname;
  } catch {
    return "";
  }
})();
if (dbHost !== "127.0.0.1" && dbHost !== "localhost") {
  console.error("REFUSING: DATABASE_URL is not a loopback database.");
  process.exit(1);
}

let failures = 0;
async function check(id: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${id}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${id}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
}

const passwordHash = await bcrypt.hash("Testpass1!", 4);

async function seedBusiness(suffix: string, mode: EmployeeTipPayoutMode) {
  const manager = await prisma.user.create({
    data: { email: `tdea-mgr-${suffix}@example.com`, passwordHash, role: Role.MANAGER, emailVerified: true },
  });
  const business = await prisma.business.create({
    data: {
      name: `TDEA Venue ${suffix}`,
      slug: `tdea-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_tdea_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      employeeTipPayoutMode: mode,
    },
  });
  return { manager, business };
}

async function seedEmployee(suffix: string, businessId: string) {
  const user = await prisma.user.create({
    data: { email: `tdea-emp-${suffix}@example.com`, passwordHash, role: Role.EMPLOYEE, emailVerified: true },
  });
  const employee = await prisma.employee.create({
    data: {
      name: `TDEA Emp ${suffix}`,
      jobTitle: "Staff",
      businessId,
      userId: user.id,
      activationStatus: "active",
      isActive: true,
    },
  });
  return { user, employee };
}

async function seedPayable(params: {
  key: string;
  businessId: string;
  employeeId: string;
  grossCents: number;
  venue: boolean;
}) {
  const pi = `pi_tdea_${params.key}`;
  const tip = await prisma.transaction.create({
    data: {
      amount: params.grossCents / 100,
      status: TipStatus.success,
      stripePaymentIntentId: pi,
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
      paymentIntentId: pi,
      grossCents: params.grossCents,
      snapshot: params.venue
        ? {
            chargeModel: EmployeeTipChargeModel.destination_business,
            routingMode: EmployeeTipPayoutMode.business_distribution,
            destinationAccountId: `acct_tdea_${params.businessId}`,
          }
        : {
            // CareTip buffer: employee not connected when the tip was paid.
            chargeModel: EmployeeTipChargeModel.platform_hold,
            routingMode: EmployeeTipPayoutMode.direct_to_employee,
            destinationAccountId: null,
          },
      stripeChargeId: `ch_tdea_${params.key}`,
      destinationTransferId: params.venue ? `tr_tdea_${params.key}` : null,
    });
  });
  const payable = await prisma.employeeTipPayable.findUnique({ where: { transactionId: tip.id } });
  assert.ok(payable);
  return payable;
}

async function allActivity(employeeId: string, filter?: EmployeePayableActivityFilter) {
  const items: EmployeePayableActivityItem[] = [];
  for (let skip = 0; ; skip += 50) {
    const page = await listEmployeePayableActivityForEmployee(employeeId, { take: 50, skip, filter });
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) return { items, total: page.total };
  }
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function fakeReq(userId: string, extra: Partial<Request> = {}): Request {
  return { user: { userId, sub: userId }, params: {}, query: {}, body: {}, headers: {}, ...extra } as unknown as Request;
}

async function main() {
  const s = `${Date.now()}`;
  console.log("tip-distribution-employee-activity");

  const { manager: managerA, business: bizA } = await seedBusiness(`a_${s}`, EmployeeTipPayoutMode.business_distribution);
  const { manager: managerB, business: bizB } = await seedBusiness(`b_${s}`, EmployeeTipPayoutMode.business_distribution);
  const e1 = await seedEmployee(`e1_${s}`, bizA.id);
  const e2 = await seedEmployee(`e2_${s}`, bizA.id);
  const f1 = await seedEmployee(`f1_${s}`, bizB.id);

  const p1 = await seedPayable({ key: `p1_${s}`, businessId: bizA.id, employeeId: e1.employee.id, grossCents: 1000, venue: true });
  const p2 = await seedPayable({ key: `p2_${s}`, businessId: bizA.id, employeeId: e1.employee.id, grossCents: 500, venue: true });
  const q1 = await seedPayable({ key: `q1_${s}`, businessId: bizA.id, employeeId: e2.employee.id, grossCents: 800, venue: true });
  const h1 = await seedPayable({ key: `h1_${s}`, businessId: bizA.id, employeeId: e1.employee.id, grossCents: 600, venue: false });
  const g1 = await seedPayable({ key: `g1_${s}`, businessId: bizB.id, employeeId: f1.employee.id, grossCents: 700, venue: true });
  assert.equal(h1.status, EmployeeTipPayableStatus.held_platform);
  assert.equal(p1.status, EmployeeTipPayableStatus.held_business);

  const remP1 = remainingPayableCents(p1);
  const remP2 = remainingPayableCents(p2);
  const remQ1 = remainingPayableCents(q1);
  const payableCountE1 = await prisma.employeeTipPayable.count({ where: { employeeId: e1.employee.id } });

  // ---------------------------------------------------------------- R2: before any distribution
  await check("R2-0 employee sees venue tips as awaiting distribution, nothing recorded", async () => {
    const { items } = await allActivity(e1.employee.id);
    const r1 = items.find((i) => i.id === p1.id);
    assert.ok(r1);
    assert.equal(r1.presentationKind, "held_venue");
    assert.equal(r1.distributedCents, 0);
    assert.equal(r1.distributionState, "awaiting");
    assert.equal(r1.lastDistributedAt, null);
  });

  // FIFO: covers p1 fully and 100 cents of p2.
  const idemKey = `tdea-${s}-1`;
  const batch = await createTipDistributionBatch({
    businessId: bizA.id,
    actorUserId: managerA.id,
    idempotencyKey: idemKey,
    paymentReference: "cash envelope",
    items: [{ employeeId: e1.employee.id, amountCents: remP1 + 100 }],
  });

  await check("R2-1 distribution appears on the employee's Tip Activity with amount, date, venue and status", async () => {
    const { items } = await allActivity(e1.employee.id);
    const r1 = items.find((i) => i.id === p1.id);
    const r2 = items.find((i) => i.id === p2.id);
    assert.ok(r1 && r2);
    assert.equal(r1.presentationKind, "venue_distributed");
    assert.equal(r1.distributedCents, remP1);
    assert.equal(r1.activityCents, remP1);
    assert.equal(r1.distributionState, "distributed");
    assert.equal(r1.lastDistributedAt, batch.completedAt);
    assert.equal(r1.activityAt, batch.completedAt, "activity date is the distribution date");
    assert.equal(r1.businessName, bizA.name);
    assert.equal(r2.presentationKind, "venue_distributed");
    assert.equal(r2.distributedCents, 100);
    assert.equal(r2.distributionState, "partial");
    // Recording a distribution never changes the payable ledger status (no money moved via Stripe).
    assert.equal(r1.status, "held_business");
  });

  await check("R2-2 employee amounts equal the authoritative allocation rows and the business view", async () => {
    const dbSum = await prisma.employeeTipDistributionAllocation.aggregate({
      where: { payable: { employeeId: e1.employee.id } },
      _sum: { amountCents: true },
    });
    const { items } = await allActivity(e1.employee.id);
    const employeeSum = items.reduce((sum, i) => sum + i.distributedCents, 0);
    assert.equal(employeeSum, dbSum._sum.amountCents);
    assert.equal(employeeSum, batch.items[0]?.amountCents);
    const bizRows = await listTipDistributionEmployeesForBusiness(bizA.id);
    const bizRow = bizRows.items.find((r) => r.employeeId === e1.employee.id);
    assert.equal(bizRow?.distributedCents, employeeSum, "business and employee views agree");
    assert.equal(bizRow?.remainingCents, remP2 - 100);
  });

  await check("R2-3 no duplicate employee records: payables unchanged, one allocation per covered tip", async () => {
    assert.equal(await prisma.employeeTipPayable.count({ where: { employeeId: e1.employee.id } }), payableCountE1);
    const allocations = await prisma.employeeTipDistributionAllocation.count({ where: { payable: { employeeId: e1.employee.id } } });
    assert.equal(allocations, 2);
    const { total } = await allActivity(e1.employee.id);
    assert.equal(total, payableCountE1, "one activity row per tip, not per distribution");
  });

  await check("R2-4 repeated request with the same idempotency key does not duplicate", async () => {
    const replay = await createTipDistributionBatch({
      businessId: bizA.id,
      actorUserId: managerA.id,
      idempotencyKey: idemKey,
      items: [{ employeeId: e1.employee.id, amountCents: remP1 + 100 }],
    });
    assert.equal(replay.id, batch.id);
    assert.equal(await prisma.employeeTipDistributionBatch.count({ where: { businessId: bizA.id } }), 1);
    const { items } = await allActivity(e1.employee.id);
    assert.equal(items.find((i) => i.id === p1.id)?.distributedCents, remP1);
  });

  await check("R2-5 concurrent distributions cannot over-allocate; same-key concurrency yields one batch", async () => {
    const sameKey = `tdea-${s}-same`;
    const [a, b] = await Promise.all([
      createTipDistributionBatch({ businessId: bizA.id, actorUserId: managerA.id, idempotencyKey: sameKey, items: [{ employeeId: e2.employee.id, amountCents: 100 }] }),
      createTipDistributionBatch({ businessId: bizA.id, actorUserId: managerA.id, idempotencyKey: sameKey, items: [{ employeeId: e2.employee.id, amountCents: 100 }] }),
    ]);
    assert.equal(a.id, b.id);
    const left = remQ1 - 100;
    const results = await Promise.allSettled([
      createTipDistributionBatch({ businessId: bizA.id, actorUserId: managerA.id, idempotencyKey: `tdea-${s}-c1`, items: [{ employeeId: e2.employee.id, amountCents: left }] }),
      createTipDistributionBatch({ businessId: bizA.id, actorUserId: managerA.id, idempotencyKey: `tdea-${s}-c2`, items: [{ employeeId: e2.employee.id, amountCents: left }] }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    assert.ok(rejected?.reason instanceof TipDistributionError);
    assert.equal((rejected.reason as TipDistributionError).code, "DISTRIBUTION_EXCEEDS_REMAINING");
    const { items } = await allActivity(e2.employee.id);
    const row = items.find((i) => i.id === q1.id);
    assert.equal(row?.distributedCents, remQ1, "exactly the obligation, never more");
    assert.equal(row?.distributionState, "distributed");
    const bizRow = (await listTipDistributionEmployeesForBusiness(bizA.id)).items.find((r) => r.employeeId === e2.employee.id);
    assert.equal(bizRow?.distributedCents, row?.distributedCents);
    assert.equal(bizRow?.overDistributedCents, 0);
  });

  await check("R2-6 employee cannot see another employee's distributions", async () => {
    const e1Ids = new Set((await allActivity(e1.employee.id)).items.map((i) => i.id));
    const e2Ids = new Set((await allActivity(e2.employee.id)).items.map((i) => i.id));
    assert.ok(!e1Ids.has(q1.id));
    assert.ok(!e2Ids.has(p1.id) && !e2Ids.has(p2.id) && !e2Ids.has(h1.id));
  });

  await check("R2-7 employee/business of another tenant cannot reach this financial activity", async () => {
    const fIds = (await allActivity(f1.employee.id)).items.map((i) => i.id);
    assert.deepEqual(fIds, [g1.id]);
    assert.equal(await getTipDistributionBatchForBusiness(bizB.id, batch.id), null);
    const bHistory = await listTipDistributionBatchesForBusiness(bizB.id);
    assert.equal(bHistory.items.some((r) => r.id === batch.id), false);
    await assert.rejects(
      createTipDistributionBatch({ businessId: bizB.id, actorUserId: managerB.id, idempotencyKey: `tdea-${s}-x`, items: [{ employeeId: e1.employee.id, amountCents: 1 }] }),
      (err: unknown) => err instanceof TipDistributionError && err.code === "EMPLOYEE_NOT_FOUND",
    );
    // Controller derives the tenant from the authenticated manager, never from the request.
    const res = fakeRes();
    await tipDistributionController.getMyTipDistributionBatch(fakeReq(managerB.id, { params: { id: batch.id } as never }), res as unknown as Response);
    assert.equal(res.statusCode, 404);
    const own = fakeRes();
    await tipDistributionController.getMyTipDistributionBatch(fakeReq(managerA.id, { params: { id: batch.id } as never }), own as unknown as Response);
    assert.equal(own.statusCode, 200);
  });

  await check("R2-8 CareTip-buffer rows are never presented as payouts or distributions", async () => {
    const { items } = await allActivity(e1.employee.id);
    const buffer = items.find((i) => i.id === h1.id);
    assert.ok(buffer);
    assert.equal(buffer.presentationKind, "held");
    assert.equal(buffer.distributionState, "not_applicable");
    assert.equal(buffer.distributedCents, 0);
    assert.equal(buffer.transferredCents, 0);
    // Business cannot "distribute" CareTip-held money.
    const e1Only = await prisma.employee.create({
      data: { name: "Buffer only", jobTitle: "Staff", businessId: bizA.id, activationStatus: "active" },
    });
    await seedPayable({ key: `h2_${s}`, businessId: bizA.id, employeeId: e1Only.id, grossCents: 400, venue: false });
    await assert.rejects(
      createTipDistributionBatch({ businessId: bizA.id, actorUserId: managerA.id, idempotencyKey: `tdea-${s}-buf`, items: [{ employeeId: e1Only.id, amountCents: 100 }] }),
      (err: unknown) => err instanceof TipDistributionError && err.code === "DISTRIBUTION_EXCEEDS_REMAINING",
    );
  });

  await check("R2-9 filters: 'distributed' lists recorded venue tips, 'pending' excludes them", async () => {
    const distributed = (await allActivity(e1.employee.id, "distributed")).items.map((i) => i.id).sort();
    assert.deepEqual(distributed, [p1.id, p2.id].sort());
    const pending = (await allActivity(e1.employee.id, "pending")).items.map((i) => i.id);
    assert.deepEqual(pending, [h1.id]);
  });

  await check("R2-10 refund after distribution: refund is shown, recorded distribution history preserved", async () => {
    await applyRefundToEmployeePayable({ transactionId: p1.transactionId, refundedCents: p1.grossCents });
    const { items } = await allActivity(e1.employee.id);
    const r1 = items.find((i) => i.id === p1.id);
    assert.ok(r1);
    assert.equal(r1.presentationKind, "refunded");
    assert.equal(r1.distributedCents, remP1, "allocation rows are history; never silently deleted");
    assert.equal(await prisma.employeeTipDistributionAllocation.count({ where: { employeeTipPayableId: p1.id } }), 1);
    const bizRow = (await listTipDistributionEmployeesForBusiness(bizA.id)).items.find((r) => r.employeeId === e1.employee.id);
    assert.ok(bizRow);
    assert.ok(bizRow.remainingCents >= 0);
  });

  // ---------------------------------------------------------------- R1: setting change keeps visibility
  await prisma.business.update({ where: { id: bizA.id }, data: { employeeTipPayoutMode: EmployeeTipPayoutMode.direct_to_employee } });

  await check("R1-1 after switching to 'Pay employees through CareTip' outstanding + history stay readable", async () => {
    const summary = await loadTipDistributionSummaryForBusiness(bizA.id);
    assert.equal(summary.routingMode, "direct_to_employee");
    assert.ok(summary.totalToDistributeCents > 0, "legacy business-held share still outstanding");
    assert.equal(summary.lastDistributionAt != null, true);
    const history = await listTipDistributionBatchesForBusiness(bizA.id);
    assert.ok(history.items.some((r) => r.id === batch.id));
    assert.ok(history.total >= 3);
    const detail = await getTipDistributionBatchForBusiness(bizA.id, batch.id);
    assert.equal(detail?.items[0]?.employeeId, e1.employee.id);
    const employees = await listTipDistributionEmployeesForBusiness(bizA.id);
    assert.ok(employees.items.some((r) => r.employeeId === e1.employee.id && r.remainingCents === remP2 - 100));
    // Employee history is unaffected by the setting (frozen per tip).
    const { items } = await allActivity(e1.employee.id);
    assert.equal(items.find((i) => i.id === p2.id)?.presentationKind, "venue_distributed");
  });

  await check("R1-2 action rule preserved: only business-held shares can be recorded, in either mode", async () => {
    const rest = await createTipDistributionBatch({
      businessId: bizA.id,
      actorUserId: managerA.id,
      idempotencyKey: `tdea-${s}-rest`,
      items: [{ employeeId: e1.employee.id, amountCents: remP2 - 100 }],
    });
    assert.equal(rest.items[0]?.allocations.length, 1);
    assert.equal(rest.items[0]?.allocations[0]?.payableId, p2.id);
    const summary = await loadTipDistributionSummaryForBusiness(bizA.id);
    assert.equal(summary.totalToDistributeCents, 0);
    const { items } = await allActivity(e1.employee.id);
    assert.equal(items.find((i) => i.id === p2.id)?.distributionState, "distributed");
    assert.equal(items.find((i) => i.id === h1.id)?.presentationKind, "held", "buffer untouched");
  });

  await check("R1-3 the other tenant's summary never includes these amounts", async () => {
    const summaryB = await loadTipDistributionSummaryForBusiness(bizB.id);
    assert.equal(summaryB.totalToDistributeCents, remainingPayableCents(g1));
  });

  // ---------------------------------------------------------------- R3: Connect access in both modes
  const createdAccounts: string[] = [];
  __setEmployeeCreateV2AccountFnForTests(async (params) => {
    const meta = (params as { metadata?: { caretip_employee_id?: string } }).metadata;
    const id = `acct_tdea_emp_${meta?.caretip_employee_id ?? "x"}`.slice(0, 60);
    createdAccounts.push(id);
    return { id };
  });
  __setCreateV2AccountLinkFnForTests(async () => ({ url: "https://connect.stripe.com/setup/s_test_tdea" }));

  try {
    await prisma.business.update({ where: { id: bizA.id }, data: { employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution } });

    await check("R3-1 venue-distribution mode: unconnected employee sees buffer and can start onboarding", async () => {
      const status = await getEmployeeConnectStatusForUser(e1.user.id);
      assert.equal(status.employeeTipPayoutMode, "business_distribution");
      assert.equal(status.hasAccount, false);
      assert.equal(status.heldPlatformCents, remainingPayableCents(h1));
      const { url } = await createEmployeeConnectAccountLink(e1.user.id);
      assert.ok(url.startsWith("https://connect.stripe.com/"));
      const row = await prisma.employeeStripeAccount.findUnique({ where: { employeeId: e1.employee.id } });
      assert.ok(row);
      assert.equal(row.stripePayoutsEnabled, false, "a link is not readiness");
    });

    await check("R3-2 incomplete onboarding can be resumed without creating a second account", async () => {
      const before = createdAccounts.length;
      await createEmployeeConnectAccountLink(e1.user.id);
      assert.equal(createdAccounts.length, before);
      assert.equal(await prisma.employeeStripeAccount.count({ where: { employeeId: e1.employee.id } }), 1);
      const status = await getEmployeeConnectStatusForUser(e1.user.id);
      assert.equal(status.hasAccount, true);
      assert.notEqual(status.connectionState, "connected");
      assert.equal(status.payoutsEnabled, false);
    });

    await prisma.business.update({ where: { id: bizA.id }, data: { employeeTipPayoutMode: EmployeeTipPayoutMode.direct_to_employee } });

    await check("R3-3 direct mode: another employee can start onboarding; accounts stay per-employee", async () => {
      await createEmployeeConnectAccountLink(e2.user.id);
      const a1 = await prisma.employeeStripeAccount.findUnique({ where: { employeeId: e1.employee.id } });
      const a2 = await prisma.employeeStripeAccount.findUnique({ where: { employeeId: e2.employee.id } });
      assert.ok(a1 && a2);
      assert.notEqual(a1.stripeAccountId, a2.stripeAccountId);
      const s2 = await getEmployeeConnectStatusForUser(e2.user.id);
      assert.equal(s2.employeeTipPayoutMode, "direct_to_employee");
      assert.equal(s2.heldPlatformCents, 0, "never shows another employee's buffer");
    });

    await check("R3-4 connected/restricted states come from the stored Stripe mirror, not button visibility", async () => {
      await prisma.employeeStripeAccount.update({
        where: { employeeId: e2.employee.id },
        data: { stripeConnectStatus: StripeConnectStatus.restricted, stripeDetailsSubmitted: true, stripePayoutsEnabled: false },
      });
      const restricted = await getEmployeeConnectStatusForUser(e2.user.id);
      assert.equal(restricted.payoutsEnabled, false);
      assert.notEqual(restricted.connectionState, "connected");
      await prisma.employeeStripeAccount.update({
        where: { employeeId: e2.employee.id },
        data: { stripeConnectStatus: StripeConnectStatus.ready, stripeDetailsSubmitted: true, stripePayoutsEnabled: true },
      });
      const ready = await getEmployeeConnectStatusForUser(e2.user.id);
      assert.equal(ready.connectionState, "connected");
      assert.equal(ready.payoutsEnabled, true);
    });

    await check("R3-5 payout eligibility is still enforced server-side", async () => {
      const eligibility = await getEmployeeInstantPayoutEligibilityForUser(f1.user.id);
      assert.equal(eligibility.eligible, false);
      assert.equal(eligibility.reason, "not_connected");
    });

    await check("R3-6 employee cannot steer onboarding to another employee or account", async () => {
      const res = fakeRes();
      await employeeConnectController.postMyEmployeeConnectAccountLink(
        fakeReq(e1.user.id, { body: { employeeId: e2.employee.id } }),
        res as unknown as Response,
      );
      assert.equal(res.statusCode, 400);
      assert.equal((res.body as { code?: string }).code, "CONNECT_CLIENT_ACCOUNT_FORBIDDEN");
      const res2 = fakeRes();
      await employeeConnectController.postMyEmployeeConnectAccountLink(
        fakeReq(e1.user.id, { body: { stripeAccountId: "acct_someone_else" } }),
        res2 as unknown as Response,
      );
      assert.equal(res2.statusCode, 400);
      const a1 = await prisma.employeeStripeAccount.findUnique({ where: { employeeId: e1.employee.id } });
      assert.notEqual(a1?.stripeAccountId, "acct_someone_else");
    });
  } finally {
    __setEmployeeCreateV2AccountFnForTests(null);
    __setCreateV2AccountLinkFnForTests(null);
  }

  console.log(failures === 0 ? "tip-distribution-employee-activity: ok" : `tip-distribution-employee-activity: ${failures} failure(s)`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
