/**
 * GDPR lifecycle Slice D.1 — Transaction.business + TipRefund.business Restrict.
 * Proves financial history cannot be physically wiped via Business delete,
 * soft-close does not delete ledger rows, and empty Business hard-delete still works.
 * Run: npm run test:lifecycle-slice-d1 (from backend/)
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { deleteBusinessCascadeUsers, BusinessHardDeleteBlockedError } from "../src/services/business.service.js";
import { softDeleteBusinessForAdmin } from "../src/services/businessOperationalLifecycle.service.js";
import { requestAccountErasure } from "../src/services/erasureRequest.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function main() {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);

  const createdBizIds: string[] = [];
  const createdUserIds: string[] = [];

  const mgr = await prisma.user.create({
    data: {
      email: `slice-d1-mgr-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: {
          name: "Slice D1 Biz",
          slug: `slice-d1-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
    },
    include: { business: true },
  });
  const bizId = mgr.business!.id;
  createdBizIds.push(bizId);
  createdUserIds.push(mgr.id);

  const emp = await prisma.employee.create({
    data: {
      name: "D1 Staff",
      jobTitle: "Bar",
      businessId: bizId,
      isActive: true,
      activationStatus: "active",
    },
  });

  const tip = await prisma.transaction.create({
    data: {
      amount: 12.5,
      status: "success",
      employeeId: emp.id,
      businessId: bizId,
      stripePaymentIntentId: `pi_slice_d1_${tag}`,
    },
  });

  const refund = await prisma.tipRefund.create({
    data: {
      businessId: bizId,
      tipId: tip.id,
      kind: "refund",
      status: "succeeded",
      amountEur: 12.5,
      occurredAt: new Date(),
      stripeRefundId: `re_slice_d1_${tag}`,
    },
  });

  try {
    // Business with transactions cannot be physically deleted (app + FK)
    let appBlockedTips = false;
    try {
      await deleteBusinessCascadeUsers(bizId);
    } catch (e) {
      appBlockedTips =
        e instanceof BusinessHardDeleteBlockedError
          ? e.blocker === "tips"
          : e instanceof Error && /with tips/i.test(e.message);
    }
    if (appBlockedTips) pass("app refuses hard-delete when transactions exist");
    else fail("app should refuse hard-delete when transactions exist");

    let rawTipRestrict = false;
    try {
      await prisma.business.delete({ where: { id: bizId } });
    } catch {
      rawTipRestrict = true;
    }
    if (rawTipRestrict) pass("DB Restrict blocks prisma.business.delete with transactions");
    else fail("DB should Restrict business delete when tips exist");

    if (
      (await prisma.transaction.count({ where: { id: tip.id } })) === 1 &&
      (await prisma.tipRefund.count({ where: { id: refund.id } })) === 1 &&
      (await prisma.business.count({ where: { id: bizId } })) === 1
    ) {
      pass("tips + refunds + business intact after refused deletes");
    } else {
      fail("ledger or business missing after refused deletes");
    }

    // Business with refunds only cannot be physically deleted
    await prisma.transaction.delete({ where: { id: tip.id } });
    const refundOnly = await prisma.tipRefund.findUnique({ where: { id: refund.id } });
    if (!refundOnly || refundOnly.businessId !== bizId) {
      fail("refund-only setup failed");
    } else {
      let appBlockedRefunds = false;
      try {
        await deleteBusinessCascadeUsers(bizId);
      } catch (e) {
        appBlockedRefunds =
          e instanceof BusinessHardDeleteBlockedError
            ? e.blocker === "refunds"
            : e instanceof Error && /tip refunds/i.test(e.message);
      }
      if (appBlockedRefunds) pass("app refuses hard-delete when refunds exist (no tips)");
      else fail("app should refuse hard-delete when only refunds exist");

      let rawRefundRestrict = false;
      try {
        await prisma.business.delete({ where: { id: bizId } });
      } catch {
        rawRefundRestrict = true;
      }
      if (rawRefundRestrict) pass("DB Restrict blocks business delete when refunds exist");
      else fail("DB should Restrict business delete when refunds exist");

      if ((await prisma.tipRefund.count({ where: { id: refund.id } })) === 1) {
        pass("refund intact after refused deletes");
      } else {
        fail("refund was destroyed");
      }
    }

    // Soft-close does not delete transactions/refunds
    const softMgr = await prisma.user.create({
      data: {
        email: `slice-d1-soft-${tag}@caretip-test.local`,
        passwordHash,
        role: "MANAGER",
        emailVerified: true,
        business: {
          create: {
            name: "Slice D1 Soft",
            slug: `slice-d1-soft-${tag}`,
            verificationStatus: "verified",
            onboardingVerificationStatus: "rejected",
            subscriptionTier: "basic",
          },
        },
      },
      include: { business: true },
    });
    const softBizId = softMgr.business!.id;
    createdBizIds.push(softBizId);
    createdUserIds.push(softMgr.id);

    const softTip = await prisma.transaction.create({
      data: {
        amount: 5,
        status: "success",
        businessId: softBizId,
        employeeId: null,
        stripePaymentIntentId: `pi_slice_d1_soft_${tag}`,
      },
    });
    const softRefund = await prisma.tipRefund.create({
      data: {
        businessId: softBizId,
        tipId: softTip.id,
        kind: "refund",
        status: "succeeded",
        amountEur: 5,
        occurredAt: new Date(),
        stripeRefundId: `re_slice_d1_soft_${tag}`,
      },
    });

    // Soft-close via lifecycle fields (UPDATE only — never hard delete)
    await prisma.business.update({
      where: { id: softBizId },
      data: {
        deletedAt: new Date(),
        lifecycleStatus: "soft_closed",
        operationalStatus: "inactive",
      },
    });
    if (
      (await prisma.transaction.count({ where: { id: softTip.id } })) === 1 &&
      (await prisma.tipRefund.count({ where: { id: softRefund.id } })) === 1
    ) {
      pass("soft-close UPDATE preserves tips and refunds");
    } else {
      fail("soft-close UPDATE deleted ledger");
    }

    // Soft-delete API refuses venues that already have tip history / are closed
    let softApiSafe = false;
    try {
      await softDeleteBusinessForAdmin(softBizId, { adminUserId: softMgr.id, reason: "x" });
      softApiSafe = (await prisma.transaction.count({ where: { id: softTip.id } })) === 1;
    } catch {
      softApiSafe = (await prisma.transaction.count({ where: { id: softTip.id } })) === 1;
    }
    if (softApiSafe) pass("soft-delete path does not destroy tip history");
    else fail("soft-delete path destroyed tip");

    let softWithTipsRefused = false;
    try {
      await softDeleteBusinessForAdmin(softBizId, { adminUserId: softMgr.id, reason: "tips" });
    } catch {
      softWithTipsRefused = true;
    }
    if (
      softWithTipsRefused &&
      (await prisma.transaction.count({ where: { id: softTip.id } })) === 1 &&
      (await prisma.business.count({ where: { id: softBizId } })) === 1
    ) {
      pass("G: soft-delete with tips refused by production rules; tips and business remain");
    } else {
      fail("G: soft-delete with tips should refuse and leave ledger/business");
    }

    // Eligible soft-delete API (no tip history)
    const emptySoft = await prisma.user.create({
      data: {
        email: `slice-d1-empty-soft-${tag}@caretip-test.local`,
        passwordHash,
        role: "MANAGER",
        emailVerified: true,
        business: {
          create: {
            name: "Slice D1 Empty Soft",
            slug: `slice-d1-empty-soft-${tag}`,
            verificationStatus: "pending",
            onboardingVerificationStatus: "rejected",
            subscriptionTier: "basic",
          },
        },
      },
      include: { business: true },
    });
    const emptySoftBizId = emptySoft.business!.id;
    createdBizIds.push(emptySoftBizId);
    createdUserIds.push(emptySoft.id);
    await softDeleteBusinessForAdmin(emptySoftBizId, {
      adminUserId: emptySoft.id,
      reason: "slice-d1",
    });
    const emptySoftBiz = await prisma.business.findUnique({ where: { id: emptySoftBizId } });
    if (emptySoftBiz?.deletedAt && emptySoftBiz.lifecycleStatus === "soft_closed") {
      pass("eligible soft-delete API sets soft_closed without hard delete");
    } else {
      fail(`eligible soft-delete state unexpected: ${JSON.stringify(emptySoftBiz)}`);
    }

    // D — physical QR orders Restrict preflight
    const pqMgr = await prisma.user.create({
      data: {
        email: `slice-d1-pq-${tag}@caretip-test.local`,
        passwordHash,
        role: "MANAGER",
        emailVerified: true,
        business: {
          create: {
            name: "Slice D1 PQ",
            slug: `slice-d1-pq-${tag}`,
            verificationStatus: "verified",
            subscriptionTier: "basic",
          },
        },
      },
      include: { business: true },
    });
    const pqBizId = pqMgr.business!.id;
    createdBizIds.push(pqBizId);
    createdUserIds.push(pqMgr.id);
    await prisma.physicalQrOrder.create({
      data: {
        businessId: pqBizId,
        userId: pqMgr.id,
        quantity: 1,
        unitPrice: 990,
        totalAmount: 990,
        currency: "EUR",
        placedAt: new Date(),
        processingClass: "SAME_DAY",
        processingDeadlineAt: new Date(Date.now() + 3600_000),
        processingCopySnapshot: {},
        businessNameSnapshot: "Slice D1 PQ",
      },
    });
    let pqBlocked = false;
    try {
      await deleteBusinessCascadeUsers(pqBizId);
    } catch (e) {
      pqBlocked =
        e instanceof BusinessHardDeleteBlockedError
          ? e.blocker === "physical_qr_orders"
          : e instanceof Error && /physical QR orders/i.test(e.message);
    }
    if (pqBlocked && (await prisma.physicalQrOrder.count({ where: { businessId: pqBizId } })) === 1) {
      pass("D: hard-delete refused when physical QR orders exist; orders intact");
    } else {
      fail("D: hard-delete should refuse physical QR orders");
    }

    // E — Connect payouts Restrict preflight
    const poMgr = await prisma.user.create({
      data: {
        email: `slice-d1-po-${tag}@caretip-test.local`,
        passwordHash,
        role: "MANAGER",
        emailVerified: true,
        business: {
          create: {
            name: "Slice D1 Payout",
            slug: `slice-d1-po-${tag}`,
            verificationStatus: "verified",
            subscriptionTier: "premium",
          },
        },
      },
      include: { business: true },
    });
    const poBizId = poMgr.business!.id;
    createdBizIds.push(poBizId);
    createdUserIds.push(poMgr.id);
    await prisma.stripeConnectPayout.create({
      data: {
        businessId: poBizId,
        stripeAccountId: `acct_slice_d1_${tag}`,
        stripePayoutId: `po_slice_d1_${tag}`,
        amountCents: 500,
        currency: "eur",
        status: "paid",
        stripeCreatedAt: new Date(),
        lastStripeEventCreated: 1,
        lastStripeEventType: "payout.paid",
      },
    });
    let poBlocked = false;
    try {
      await deleteBusinessCascadeUsers(poBizId);
    } catch (e) {
      poBlocked =
        e instanceof BusinessHardDeleteBlockedError
          ? e.blocker === "connect_payouts"
          : e instanceof Error && /Connect payouts/i.test(e.message);
    }
    if (poBlocked && (await prisma.stripeConnectPayout.count({ where: { businessId: poBizId } })) === 1) {
      pass("E: hard-delete refused when Connect payouts exist; payouts intact");
    } else {
      fail("E: hard-delete should refuse Connect payouts");
    }

    // Empty/eligible Business hard-delete still works
    const emptyMgr = await prisma.user.create({
      data: {
        email: `slice-d1-empty-${tag}@caretip-test.local`,
        passwordHash,
        role: "MANAGER",
        emailVerified: true,
        business: {
          create: {
            name: "Slice D1 Empty",
            slug: `slice-d1-empty-${tag}`,
            verificationStatus: "verified",
            subscriptionTier: "basic",
          },
        },
      },
      include: { business: true },
    });
    const emptyBizId = emptyMgr.business!.id;
    const emptyStaff = await prisma.user.create({
      data: {
        email: `slice-d1-empty-staff-${tag}@caretip-test.local`,
        passwordHash,
        role: "EMPLOYEE",
        emailVerified: true,
        employee: {
          create: {
            name: "Empty Staff",
            jobTitle: "Bar",
            businessId: emptyBizId,
            isActive: true,
            activationStatus: "active",
          },
        },
      },
    });
    await deleteBusinessCascadeUsers(emptyBizId);
    const emptyGone = await prisma.business.findUnique({ where: { id: emptyBizId } });
    const emptyUserGone = await prisma.user.findUnique({ where: { id: emptyMgr.id } });
    const emptyStaffGone = await prisma.user.findUnique({ where: { id: emptyStaff.id } });
    const leftoverOwnerLink = await prisma.business.findFirst({ where: { userId: emptyMgr.id } });
    if (!emptyGone && !emptyUserGone && !emptyStaffGone && !leftoverOwnerLink) {
      pass("F: empty Business hard-delete removes business, cascades, staff, then owner");
    } else {
      fail("F: empty Business hard-delete failed");
    }

    // Art. 17 cannot physically delete Business with financial records
    await prisma.transaction.create({
      data: {
        amount: 1,
        status: "success",
        businessId: bizId,
        employeeId: null,
        stripePaymentIntentId: `pi_slice_d1_erasure_${tag}`,
      },
    });
    const erasure = await requestAccountErasure(mgr.id);
    const blockers = erasure.status.blockers ?? [];
    if (!erasure.ok && blockers.some((b) => b.code === "SOLE_BUSINESS_OWNER")) {
      pass("Art. 17 manager erasure blocked by SOLE_BUSINESS_OWNER");
    } else {
      fail(`Art. 17 should block manager with live business: ${JSON.stringify(erasure)}`);
    }
    if ((await prisma.business.count({ where: { id: bizId } })) === 1) {
      pass("Art. 17 did not physically delete Business");
    } else {
      fail("Art. 17 deleted Business");
    }

    const erasureSrc = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../src/services/erasureRequest.service.ts", import.meta.url), "utf8"),
    );
    if (/prisma\.business\.delete/.test(erasureSrc) || /business\.delete\s*\(/.test(erasureSrc)) {
      fail("erasureRequest.service contains business.delete");
    } else {
      pass("erasureRequest.service has no business.delete");
    }
  } catch (err) {
    fail(`run: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await prisma.auditLog
      .deleteMany({ where: { action: { in: ["business.soft_deleted"] } } })
      .catch(() => undefined);

    for (const id of createdBizIds) {
      await prisma.physicalQrOrder.deleteMany({ where: { businessId: id } }).catch(() => undefined);
      await prisma.stripeConnectPayout.deleteMany({ where: { businessId: id } }).catch(() => undefined);
      await prisma.tipRefund.deleteMany({ where: { businessId: id } }).catch(() => undefined);
      await prisma.transaction.deleteMany({ where: { businessId: id } }).catch(() => undefined);
      await prisma.employee.deleteMany({ where: { businessId: id } }).catch(() => undefined);
      await prisma.business.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await prisma.refreshToken.deleteMany({ where: { userId: id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
