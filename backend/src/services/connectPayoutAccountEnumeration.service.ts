/**
 * Enumerate eligible Connect accounts for payout reconciliation (DB pagination only).
 */
import { BusinessBankPayoutSchedule, StripeConnectStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { isStripeConnectedAccountId } from "./stripeConnect.service.js";

export type EligibleBusinessConnectAccount = {
  kind: "business";
  careTipId: string;
  stripeAccountId: string;
  bankPayoutSchedule: BusinessBankPayoutSchedule;
  stripeConnectStatus: StripeConnectStatus;
  stripePayoutsEnabled: boolean;
};

export type EligibleEmployeeConnectAccount = {
  kind: "employee";
  careTipId: string;
  stripeAccountId: string;
  bankPayoutSchedule: BusinessBankPayoutSchedule;
  stripeConnectStatus: StripeConnectStatus;
  stripePayoutsEnabled: boolean;
};

export type EligibleConnectAccount = EligibleBusinessConnectAccount | EligibleEmployeeConnectAccount;

export type EnumerationSkipReason =
  | "missing_stripe_account_id"
  | "invalid_stripe_account_id"
  | "connect_not_ready"
  | "payouts_not_enabled"
  | "employee_inactive";

export type SkippedConnectAccount = {
  kind: "business" | "employee";
  careTipId: string;
  reason: EnumerationSkipReason;
};

const BUSINESS_PAGE = 100;

export async function enumerateAllEligibleBusinessConnectAccounts(args?: {
  pilotBusinessId?: string | null;
}): Promise<{ eligible: EligibleBusinessConnectAccount[]; skipped: SkippedConnectAccount[] }> {
  const eligible: EligibleBusinessConnectAccount[] = [];
  const skipped: SkippedConnectAccount[] = [];
  let cursor: string | undefined;
  const pilot = args?.pilotBusinessId?.trim();

  for (;;) {
    const batch = await prisma.business.findMany({
      where: {
        deletedAt: null,
        legalHold: false,
        stripeAccountId: { not: null },
        ...(pilot ? { id: pilot } : {}),
      },
      select: {
        id: true,
        stripeAccountId: true,
        bankPayoutSchedule: true,
        stripeConnectStatus: true,
        stripePayoutsEnabled: true,
      },
      orderBy: { id: "asc" },
      take: BUSINESS_PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]?.id;

    for (const b of batch) {
      const stripeAccountId = b.stripeAccountId?.trim() ?? "";
      if (!stripeAccountId) {
        skipped.push({ kind: "business", careTipId: b.id, reason: "missing_stripe_account_id" });
        continue;
      }
      if (!isStripeConnectedAccountId(stripeAccountId)) {
        skipped.push({ kind: "business", careTipId: b.id, reason: "invalid_stripe_account_id" });
        continue;
      }
      if (b.stripeConnectStatus !== StripeConnectStatus.ready) {
        skipped.push({ kind: "business", careTipId: b.id, reason: "connect_not_ready" });
        continue;
      }
      if (!b.stripePayoutsEnabled) {
        skipped.push({ kind: "business", careTipId: b.id, reason: "payouts_not_enabled" });
        continue;
      }
      eligible.push({
        kind: "business",
        careTipId: b.id,
        stripeAccountId,
        bankPayoutSchedule: b.bankPayoutSchedule,
        stripeConnectStatus: b.stripeConnectStatus,
        stripePayoutsEnabled: b.stripePayoutsEnabled,
      });
    }
    if (pilot || batch.length < BUSINESS_PAGE) break;
  }

  return { eligible, skipped };
}

export async function enumerateAllEligibleEmployeeConnectAccounts(args?: {
  pilotEmployeeId?: string | null;
}): Promise<{ eligible: EligibleEmployeeConnectAccount[]; skipped: SkippedConnectAccount[] }> {
  const eligible: EligibleEmployeeConnectAccount[] = [];
  const skipped: SkippedConnectAccount[] = [];
  let cursor: string | undefined;
  const pilot = args?.pilotEmployeeId?.trim();

  for (;;) {
    const batch = await prisma.employeeStripeAccount.findMany({
      where: {
        ...(pilot ? { employeeId: pilot } : {}),
        employee: {
          isDeleted: false,
          isActive: true,
          activationStatus: "active",
          user: { isActive: true, legalHold: false },
          business: { deletedAt: null, legalHold: false },
        },
      },
      select: {
        employeeId: true,
        stripeAccountId: true,
        bankPayoutSchedule: true,
        stripeConnectStatus: true,
        stripePayoutsEnabled: true,
      },
      orderBy: { employeeId: "asc" },
      take: BUSINESS_PAGE,
      ...(cursor ? { skip: 1, cursor: { employeeId: cursor } } : {}),
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]?.employeeId;

    for (const e of batch) {
      const stripeAccountId = e.stripeAccountId?.trim() ?? "";
      if (!stripeAccountId) {
        skipped.push({ kind: "employee", careTipId: e.employeeId, reason: "missing_stripe_account_id" });
        continue;
      }
      if (!isStripeConnectedAccountId(stripeAccountId)) {
        skipped.push({ kind: "employee", careTipId: e.employeeId, reason: "invalid_stripe_account_id" });
        continue;
      }
      if (e.stripeConnectStatus !== StripeConnectStatus.ready) {
        skipped.push({ kind: "employee", careTipId: e.employeeId, reason: "connect_not_ready" });
        continue;
      }
      if (!e.stripePayoutsEnabled) {
        skipped.push({ kind: "employee", careTipId: e.employeeId, reason: "payouts_not_enabled" });
        continue;
      }
      eligible.push({
        kind: "employee",
        careTipId: e.employeeId,
        stripeAccountId,
        bankPayoutSchedule: e.bankPayoutSchedule,
        stripeConnectStatus: e.stripeConnectStatus,
        stripePayoutsEnabled: e.stripePayoutsEnabled,
      });
    }
    if (pilot || batch.length < BUSINESS_PAGE) break;
  }

  return { eligible, skipped };
}
