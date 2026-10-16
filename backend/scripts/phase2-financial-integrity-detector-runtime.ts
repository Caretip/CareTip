/**
 * Phase 2 detector regressions: the integrity scan must flag real ledger defects, report
 * truncated coverage, and stay quiet on legitimate refund/transfer lifecycle states.
 *
 *   npm run test:phase2-financial-integrity-detector
 * Requires CARETIP_ISOLATED_POSTGRES_URL (disposable Postgres; writes fixture rows).
 */
import assert from "node:assert/strict";
import type { Prisma, TipStatus as TipStatusT } from "@prisma/client";
import type Stripe from "stripe";
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";
import { verifyPayable, verifyRefund, type StripeReader } from "./lib/phase2StripeExactLookup.js";

await completeIsolatedPostgresBootstrap();

const {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Role,
  StripeConnectStatus,
  TipStatus,
} = await import("@prisma/client");
const bcrypt = (await import("bcrypt")).default;
const { prisma } = await import("../src/prisma.js");
const { scanBusinessDistributionLedgerWithCoverage } = await import(
  "../src/services/businessDistributionIntegrity.service.js"
);
const { applyRefundToEmployeePayable, createEmployeeTipPayableForSuccessfulTip } = await import(
  "../src/services/employeeTipPayable.service.js"
);
const { createTipDistributionBatch } = await import("../src/services/tipDistribution.service.js");
const { classifyPayableRow } = await import("../src/services/employeePayoutReconciliation.service.js");
const { calculateTipPlatformFeeCents } = await import("../src/config/fees.js");
const { DURABLE_RELEASE_BLOCK_PREFIX } = await import("../src/lib/employeeTipReleaseClaim.js");
const { runIntegrityChecks } = await import("./lib/phase2IntegrityChecks.js");

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

const suffix = `p2det_${Date.now()}`;
const passwordHash = await bcrypt.hash("Testpass1!", 4);

async function seedTenant(tag: string) {
  const manager = await prisma.user.create({
    data: {
      email: `p2det-${tag}-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `P2 Detector ${tag} ${suffix}`,
      slug: `p2det-${tag}-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_p2det_${tag}_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution,
    },
  });
  const employee = await prisma.employee.create({
    data: { name: `P2 Emp ${tag}`, jobTitle: "Staff", businessId: business.id, activationStatus: "active" },
  });
  return { manager, business, employee };
}

async function heldBusinessPayable(
  tenant: Awaited<ReturnType<typeof seedTenant>>,
  tag: string,
  grossCents: number,
) {
  const pi = `pi_p2det_${tag}_${suffix}`;
  const tip = await prisma.transaction.create({
    data: {
      amount: grossCents / 100,
      status: TipStatus.success,
      stripePaymentIntentId: pi,
      employeeId: tenant.employee.id,
      businessId: tenant.business.id,
    },
  });
  await prisma.$transaction(async (tx) => {
    await createEmployeeTipPayableForSuccessfulTip({
      tx,
      transactionId: tip.id,
      employeeId: tenant.employee.id,
      businessId: tenant.business.id,
      paymentIntentId: pi,
      grossCents,
      snapshot: {
        chargeModel: EmployeeTipChargeModel.destination_business,
        routingMode: EmployeeTipPayoutMode.business_distribution,
        destinationAccountId: tenant.business.stripeAccountId,
      },
      stripeChargeId: `ch_p2det_${tag}_${suffix}`,
      destinationTransferId: `tr_p2det_dest_${tag}_${suffix}`,
    });
  });
  const payable = await prisma.employeeTipPayable.findUnique({ where: { transactionId: tip.id } });
  assert.ok(payable);
  return payable;
}

/** Bypasses createTipDistributionBatch guards to fabricate a corrupt allocation row. */
async function rawAllocation(params: {
  tenant: Awaited<ReturnType<typeof seedTenant>>;
  allocationBusinessId: string;
  payableId: string;
  amountCents: number;
  tag: string;
}) {
  const batch = await prisma.employeeTipDistributionBatch.create({
    data: {
      businessId: params.allocationBusinessId,
      actorUserId: params.tenant.manager.id,
      completedAt: new Date(),
      totalAmountCents: params.amountCents,
      employeeCount: 1,
      idempotencyKey: `p2det_raw_${params.tag}_${suffix}`,
    },
  });
  const item = await prisma.employeeTipDistributionItem.create({
    data: {
      batchId: batch.id,
      businessId: params.allocationBusinessId,
      employeeId: params.tenant.employee.id,
      amountCents: params.amountCents,
    },
  });
  await prisma.employeeTipDistributionAllocation.create({
    data: {
      itemId: item.id,
      businessId: params.allocationBusinessId,
      employeeTipPayableId: params.payableId,
      amountCents: params.amountCents,
    },
  });
}

const a = await seedTenant("a");
const b = await seedTenant("b");
const c = await seedTenant("c");

try {
  const clean = await heldBusinessPayable(a, "clean", 1000);
  const cleanScan = await scanBusinessDistributionLedgerWithCoverage({ businessId: a.business.id });
  assert.equal(cleanScan.issues.length, 0, JSON.stringify(cleanScan.issues));
  assert.equal(cleanScan.coverage.complete, true);
  pass("clean-baseline", "healthy held_business payable produces no issues and complete coverage");

  await createTipDistributionBatch({
    businessId: a.business.id,
    actorUserId: a.manager.id,
    idempotencyKey: `p2det_dist_${suffix}`,
    items: [{ employeeId: a.employee.id, amountCents: clean.payableCents }],
  });
  await applyRefundToEmployeePayable({ transactionId: clean.transactionId, refundedCents: 300 });
  const afterRefund = await scanBusinessDistributionLedgerWithCoverage({ businessId: a.business.id });
  assert.ok(
    !afterRefund.issues.some((i) => i.code === "distribution_allocation_exceeds_payable"),
    "post-distribution refund is lifecycle, not over-allocation",
  );
  pass("refund-after-distribution-not-flagged", "allocation above remaining (after refund) is not a defect");

  const overPayable = await heldBusinessPayable(a, "over", 1000);
  await rawAllocation({
    tenant: a,
    allocationBusinessId: a.business.id,
    payableId: overPayable.id,
    amountCents: overPayable.payableCents + 1,
    tag: "over",
  });
  const overScan = await scanBusinessDistributionLedgerWithCoverage({ businessId: a.business.id });
  assert.ok(
    overScan.issues.some(
      (i) => i.code === "distribution_allocation_exceeds_payable" && i.payableId === overPayable.id,
    ),
  );
  pass("over-allocation-detected", "allocations exceeding payableCents are flagged");

  const foreignPayable = await heldBusinessPayable(a, "foreign", 1000);
  await rawAllocation({
    tenant: a,
    allocationBusinessId: b.business.id,
    payableId: foreignPayable.id,
    amountCents: 100,
    tag: "foreign",
  });
  const foreignScan = await scanBusinessDistributionLedgerWithCoverage({ businessId: a.business.id });
  assert.ok(
    foreignScan.issues.some(
      (i) => i.code === "distribution_allocation_tenant_mismatch" && i.payableId === foreignPayable.id,
    ),
  );
  pass("cross-tenant-allocation-detected", "allocation recorded under another business is flagged");

  const bScan = await scanBusinessDistributionLedgerWithCoverage({ businessId: b.business.id });
  assert.ok(
    bScan.issues.every((i) => i.businessId === b.business.id),
    "business-scoped scan must not return another tenant's rows",
  );
  pass("tenant-scoped-scan", "scan scoped to business B returns no business A records");

  for (const tag of ["miss1", "miss2"]) {
    await prisma.transaction.create({
      data: {
        amount: 5,
        status: TipStatus.success,
        stripePaymentIntentId: `pi_p2det_${tag}_${suffix}`,
        employeeId: b.employee.id,
        businessId: b.business.id,
      },
    });
  }
  const missingFull = await scanBusinessDistributionLedgerWithCoverage({ businessId: b.business.id });
  assert.equal(
    missingFull.issues.filter((i) => i.code === "success_transaction_missing_payable").length,
    2,
  );
  assert.equal(missingFull.coverage.complete, true);
  const missingCapped = await scanBusinessDistributionLedgerWithCoverage({
    businessId: b.business.id,
    limits: { successWithoutPayable: 1 },
  });
  assert.equal(missingCapped.coverage.successWithoutPayableTruncated, true);
  assert.equal(missingCapped.coverage.complete, false);
  pass("truncation-reported", "capped scan reports incomplete coverage instead of implying health");

  const emptyStripe = new Map<string, Stripe.Transfer>();
  const noMeta = new Map<string, Stripe.Transfer[]>();
  const baseRow = {
    id: "pay_p2det_unit",
    transactionId: "tx_p2det_unit",
    payableCents: 900,
    transferredCents: 0,
    reversedCents: 0,
    refundedCents: 0,
    disputedOpenCents: 0,
    disputedLostCents: 0,
    stripeTransferId: null as string | null,
    stripeDestinationAccountId: null as string | null,
  };
  const acct = "acct_p2det_emp";

  const failed = classifyPayableRow(
    { ...baseRow, status: EmployeeTipPayableStatus.transfer_failed },
    emptyStripe,
    noMeta,
    acct,
  );
  assert.notEqual(failed.status, "MATCHED");
  pass("failed-not-success", "transfer_failed payable without Stripe transfer is not MATCHED");

  const missing = classifyPayableRow(
    {
      ...baseRow,
      status: EmployeeTipPayableStatus.transferred,
      transferredCents: 900,
      stripeTransferId: "tr_p2det_internal_only",
    },
    emptyStripe,
    noMeta,
    acct,
  );
  assert.equal(missing.status, "STRIPE_TRANSFER_MISSING");
  pass("internal-ref-missing-at-stripe", "internal transfer id absent from Stripe is STRIPE_TRANSFER_MISSING");

  const orphanTransfer = {
    id: "tr_p2det_stripe_only",
    amount: 900,
    destination: acct,
    created: 1,
    metadata: { caretip_payable_id: baseRow.id },
  } as unknown as Stripe.Transfer;
  const ahead = classifyPayableRow(
    { ...baseRow, status: EmployeeTipPayableStatus.held_platform },
    new Map([[orphanTransfer.id, orphanTransfer]]),
    new Map([[baseRow.id, [orphanTransfer]]]),
    acct,
  );
  assert.equal(ahead.status, "MATCHED");
  assert.equal(ahead.caretipStatus, EmployeeTipPayableStatus.held_platform);
  assert.equal(ahead.stripeTransferId, orphanTransfer.id);
  pass(
    "stripe-ahead-of-ledger-visible",
    "Stripe transfer without DB persistence links by metadata; caretipStatus exposes the stale ledger",
  );

  const wrongDest = classifyPayableRow(
    {
      ...baseRow,
      status: EmployeeTipPayableStatus.transferred,
      transferredCents: 900,
      stripeTransferId: orphanTransfer.id,
    },
    new Map([[orphanTransfer.id, { ...orphanTransfer, destination: "acct_other" } as Stripe.Transfer]]),
    noMeta,
    acct,
  );
  assert.equal(wrongDest.status, "DESTINATION_MISMATCH");
  pass("destination-mismatch", "transfer to a different connected account is flagged");

  // ---- Phase 2 scan SQL checks (scripts/lib/phase2IntegrityChecks.ts) on controlled rows
  const fee = (g: number) => calculateTipPlatformFeeCents(g);
  const rawPayable = async (
    tag: string,
    data: Partial<Prisma.EmployeeTipPayableUncheckedCreateInput> & { tipBusinessId?: string; tipStatus?: TipStatusT } = {},
  ) => {
    const { tipBusinessId, tipStatus, ...payable } = data;
    const gross = payable.grossCents ?? 1000;
    const platformFeeCents = payable.platformFeeCents ?? fee(gross);
    const pi = `pi_p2det_${tag}_${suffix}`;
    const tip = await prisma.transaction.create({
      data: {
        amount: gross / 100,
        status: tipStatus ?? TipStatus.success,
        stripePaymentIntentId: pi,
        employeeId: c.employee.id,
        businessId: tipBusinessId ?? c.business.id,
      },
    });
    return prisma.employeeTipPayable.create({
      data: {
        transactionId: tip.id,
        employeeId: c.employee.id,
        businessId: c.business.id,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        chargeModel: EmployeeTipChargeModel.platform_hold,
        status: EmployeeTipPayableStatus.held_platform,
        grossCents: gross,
        platformFeeCents,
        payableCents: gross - platformFeeCents,
        stripePaymentIntentId: pi,
        ...payable,
      },
    });
  };
  const refundRow = (tipId: string, kind: "refund" | "dispute", status: "succeeded" | "needs_response", eur: number) =>
    prisma.tipRefund.create({
      data: { businessId: c.business.id, tipId, kind, status, amountEur: eur, occurredAt: new Date() },
    });

  const lifecycle = {
    held: await rawPayable("lc_held"),
    failed: await rawPayable("lc_failed", { status: EmployeeTipPayableStatus.transfer_failed, lastTransferError: "card_declined" }),
    transferringFresh: await rawPayable("lc_xfer", { status: EmployeeTipPayableStatus.transferring }),
    refunded: await rawPayable("lc_ref", { status: EmployeeTipPayableStatus.refunded, refundedCents: 1000 - fee(1000) }),
    disputed: await rawPayable("lc_disp", { disputedOpenCents: 500 }),
  };
  await refundRow(lifecycle.refunded.transactionId, "refund", "succeeded", 10);
  await refundRow(lifecycle.disputed.transactionId, "dispute", "needs_response", 5);
  const freshPendingTip = await prisma.transaction.create({
    data: { amount: 7, status: TipStatus.pending, stripePaymentIntentId: `pi_p2det_lc_pend_${suffix}`, employeeId: c.employee.id, businessId: c.business.id },
  });

  const defects = {
    split: await rawPayable("d_split", { payableCents: 1000 - fee(1000) - 1 }),
    wrongFee: await rawPayable("d_fee", { platformFeeCents: fee(1000) + 1, payableCents: 1000 - fee(1000) - 1 }),
    refundOver: await rawPayable("d_refover", { refundedCents: 600 }),
    refundNoRow: await rawPayable("d_refnone", { refundedCents: 200 }),
    dupA: await rawPayable("d_dupa", { stripeChargeId: `ch_p2det_dup_${suffix}` }),
    dupB: await rawPayable("d_dupb", { stripeChargeId: `ch_p2det_dup_${suffix}` }),
    crossTenant: await rawPayable("d_xt", { tipBusinessId: a.business.id }),
    uncertain: await rawPayable("d_unc", {
      status: EmployeeTipPayableStatus.transferring,
      lastTransferError: `${DURABLE_RELEASE_BLOCK_PREFIX}claim`,
    }),
  };
  await refundRow(defects.refundOver.transactionId, "refund", "succeeded", 3);
  const missingTip = await prisma.transaction.create({
    data: { amount: 9, status: TipStatus.success, stripePaymentIntentId: `pi_p2det_d_miss_${suffix}`, employeeId: c.employee.id, businessId: c.business.id },
  });

  const cFindings = await runIntegrityChecks(prisma, { businessIds: [c.business.id], ledgerStartAt: new Date(0) });
  const idsOf = (key: string) => cFindings.find((f) => f.key === key)?.ids ?? [];
  assert.ok(idsOf("payable_split_broken").includes(defects.split.id));
  assert.ok(!idsOf("payable_split_broken").includes(defects.wrongFee.id), "consistent split with a wrong fee is a fee finding");
  assert.ok(idsOf("frozen_fee_differs_from_formula").includes(defects.wrongFee.id));
  pass("cents-and-fee-detected", "broken net split and non-formula fee are reported separately");
  assert.ok(idsOf("missing_payable_post_ledger").includes(missingTip.id));
  pass("scan-missing-payable", "success tip without payable after ledger start is reported");
  assert.ok(idsOf("payable_refunded_exceeds_refund_rows").includes(defects.refundOver.id));
  assert.ok(idsOf("payable_refunded_without_refund_row").includes(defects.refundNoRow.id));
  pass("refund-ledger-disagreement", "refunded_cents above / without refund records is reported");
  assert.deepEqual(new Set(idsOf("duplicate_charge_across_payables")), new Set([defects.dupA.id, defects.dupB.id]));
  pass("duplicate-financial-effect", "two payables on one Stripe charge are reported");
  assert.ok(idsOf("payable_tip_tenant_mismatch").includes(defects.crossTenant.id));
  pass("cross-tenant-payable", "payable and tip owned by different businesses are reported");
  const durable = cFindings.find((f) => f.key === "durable_uncertain_marker");
  assert.ok(durable?.ids.includes(defects.uncertain.id));
  assert.equal(durable?.classification, "uncertain");
  const uncertainRow = classifyPayableRow({ ...defects.uncertain }, emptyStripe, noMeta, acct);
  assert.notEqual(uncertainRow.status, "MATCHED");
  pass("uncertain-not-success", "durable uncertain transfer is reported as uncertain and never MATCHED");

  const lifecycleIds = new Set([...Object.values(lifecycle).map((p) => p.id), freshPendingTip.id]);
  const defectHits = cFindings
    .filter((f) => f.classification === "defect" || f.classification === "investigate")
    .flatMap((f) => f.ids.filter((id) => lifecycleIds.has(id)).map((id) => `${f.key}:${id}`));
  assert.deepEqual(defectHits, [], "legitimate lifecycle states must not be reported as defects");
  assert.ok(cFindings.find((f) => f.key === "open_dispute_exposure")?.ids.includes(lifecycle.disputed.id));
  assert.ok(cFindings.find((f) => f.key === "transfer_failed")?.ids.includes(lifecycle.failed.id));
  pass("lifecycle-not-defects", "held, failed, fresh transferring, refunded, disputed and pending stay non-defects");

  const cIds = new Set([...Object.values(lifecycle), ...Object.values(defects)].map((p) => p.id));
  const aFindings = await runIntegrityChecks(prisma, { businessIds: [a.business.id], ledgerStartAt: new Date(0) });
  assert.deepEqual(
    aFindings.filter((f) => f.area !== 12).flatMap((f) => f.ids.filter((id) => cIds.has(id))),
    [],
    "scan scoped to business A must not report business C rows",
  );
  pass("scan-tenant-scope", "scoped scan never returns another tenant's rows");

  const dupTip = await prisma.transaction.create({
    data: { amount: 10, status: TipStatus.success, stripePaymentIntentId: `pi_p2det_twice_${suffix}`, employeeId: c.employee.id, businessId: c.business.id },
  });
  for (let i = 0; i < 2; i += 1) {
    await prisma.$transaction(async (tx) => {
      await createEmployeeTipPayableForSuccessfulTip({
        tx,
        transactionId: dupTip.id,
        employeeId: c.employee.id,
        businessId: c.business.id,
        paymentIntentId: dupTip.stripePaymentIntentId!,
        grossCents: 1000,
        snapshot: { chargeModel: EmployeeTipChargeModel.platform_hold, routingMode: EmployeeTipPayoutMode.direct_to_employee, destinationAccountId: null },
        stripeChargeId: null,
        destinationTransferId: null,
      });
    });
  }
  assert.equal(await prisma.employeeTipPayable.count({ where: { transactionId: dupTip.id } }), 1);
  pass("duplicate-payable-prevented", "replayed payable creation for one tip yields exactly one payable");

  // ---- Stripe outcome classification (mock reader; no network)
  const realPi = `pi_${"A".repeat(24)}`;
  const realTr = `tr_${"B".repeat(24)}`;
  const realCh = `ch_${"C".repeat(24)}`;
  const destAcct = `acct_${"D".repeat(16)}`;
  const destPayable = {
    id: "pay_p2det_dest",
    chargeModel: "destination_employee",
    status: "destination_settled",
    grossCents: 2000,
    platformFeeCents: fee(2000),
    transferredCents: 2000 - fee(2000),
    stripePaymentIntentId: realPi,
    stripeChargeId: realCh,
    stripeTransferId: null,
    stripeDestinationAccountId: destAcct,
    employeeStripeAccountId: destAcct,
  };
  const okPi = {
    id: realPi, livemode: false, status: "succeeded", amount_received: 2000, currency: "eur",
    application_fee_amount: fee(2000), transfer_data: { destination: destAcct },
    latest_charge: { id: realCh, transfer: realTr },
  } as unknown as Stripe.PaymentIntent;
  const okTr = { id: realTr, livemode: false, amount: 2000, destination: destAcct, source_transaction: realCh, metadata: {} } as unknown as Stripe.Transfer;
  const reader = (overrides: Partial<StripeReader>): StripeReader => ({
    paymentIntent: async () => okPi,
    transfer: async () => okTr,
    refund: async () => { throw new Error("unused"); },
    dispute: async () => { throw new Error("unused"); },
    ...overrides,
  });
  const outcomes = async (r: StripeReader, p = destPayable) => (await verifyPayable(r, p)).map((x) => `${x.object}:${x.outcome}`);
  assert.deepEqual(await outcomes(reader({})), ["payment_intent:match", "transfer:match"]);
  assert.deepEqual(
    await outcomes(reader({ transfer: async () => ({ ...okTr, amount: 2000 - fee(2000) }) as Stripe.Transfer })),
    ["payment_intent:match", "transfer:mismatch"],
    "destination transfer must equal gross, not net",
  );
  const stripeErr = (statusCode: number, code: string, message: string, type = "StripeInvalidRequestError") =>
    Object.assign(new Error(message), { statusCode, code, type });
  assert.deepEqual(
    await outcomes(reader({ transfer: async () => { throw stripeErr(404, "resource_missing", "No such transfer"); } })),
    ["payment_intent:match", "transfer:not_found"],
  );
  assert.deepEqual(
    await outcomes(reader({ transfer: async () => { throw stripeErr(404, "resource_missing", "a similar object exists in live mode"); } })),
    ["payment_intent:match", "transfer:inconclusive"],
  );
  assert.deepEqual(
    await outcomes(reader({ paymentIntent: async () => { throw stripeErr(401, "", "Invalid API Key", "StripeAuthenticationError"); } })),
    ["payment_intent:inconclusive", "transfer:inconclusive"],
    "unauthorized lookup is inconclusive and never not_found",
  );
  assert.deepEqual(
    await outcomes(reader({ paymentIntent: async () => { throw Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }); } })),
    ["payment_intent:inconclusive", "transfer:inconclusive"],
  );
  assert.deepEqual(
    await outcomes(reader({ paymentIntent: async () => ({ ...okPi, livemode: true }) as Stripe.PaymentIntent })),
    ["payment_intent:inconclusive", "transfer:match"],
    "live-mode object is wrong-mode, not a match",
  );
  assert.deepEqual(
    await outcomes(reader({}), { ...destPayable, stripePaymentIntentId: "pi_p2det_synthetic" }),
    ["payment_intent:unsupported_synthetic", "transfer:inconclusive"],
  );
  const incomplete = classifyPayableRow(
    { ...baseRow, status: EmployeeTipPayableStatus.transferred, transferredCents: 900, stripeTransferId: "tr_p2det_unlisted" },
    emptyStripe,
    noMeta,
    acct,
    { lookupComplete: false },
  );
  assert.equal(incomplete.status, "STRIPE_VERIFICATION_INCOMPLETE");
  const lostDispute = { id: "ref_p2det_dispute", kind: "dispute", status: "lost", amountCents: 1000, stripeRefundId: null, stripePaymentIntentId: realPi };
  const disputeReader = reader({
    dispute: async (id) => ({ id, livemode: false, amount: 1000, status: "lost" }) as unknown as Stripe.Dispute,
  });
  for (const disputeId of [`du_${"E".repeat(24)}`, `dp_${"F".repeat(24)}`]) {
    const check = await verifyRefund(disputeReader, { ...lostDispute, stripeDisputeId: disputeId });
    assert.equal(check?.outcome, "match", `${disputeId.slice(0, 3)} dispute ids are real Stripe ids and must be looked up`);
  }
  assert.equal(
    (await verifyRefund(disputeReader, { ...lostDispute, stripeDisputeId: "dp_p2det_synthetic" }))?.outcome,
    "unsupported_synthetic",
  );
  pass("incomplete-lookups-inconclusive", "404 -> not_found; auth/connection/wrong-mode/truncated -> inconclusive; synthetic -> unsupported");

  console.log("\nphase2-financial-integrity-detector-runtime: OK");
} finally {
  const businessIds = [a.business.id, b.business.id, c.business.id];
  await prisma.employeeTipDistributionAllocation.deleteMany({
    where: { OR: [{ businessId: { in: businessIds } }, { payable: { businessId: { in: businessIds } } }] },
  });
  await prisma.employeeTipDistributionItem.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.employeeTipDistributionBatch.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.tipRefund.deleteMany({ where: { businessId: { in: businessIds } } }).catch(() => undefined);
  await prisma.employeeTipPayable.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.transaction.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.employee.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [a.manager.id, b.manager.id, c.manager.id] } } });
  await prisma.$disconnect().catch(() => undefined);
}
