/**
 * Stripe Transfer lookup for employee tip release recovery.
 * Platform-context transfers.list({ destination }) + metadata caretip_payable_id.
 * See Stripe API: List transfers (destination filter); metadata is not a list filter — paginate and scan.
 */
import type Stripe from "stripe";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import {
  EMPLOYEE_TIP_RELEASE_TRANSFER_LOOKUP_MAX_PAGES,
  EMPLOYEE_TIP_RELEASE_TRANSFER_LOOKUP_PAGE_SIZE,
  employeeTipReleaseIdempotencySafeWindowMs,
} from "../config/employeeTipReleaseRecovery.config.js";
import { EmployeeTipPayableStatus } from "@prisma/client";

export type EmployeeTipTransferLookupResult =
  | {
      outcome: "found";
      transferId: string;
      amountCents: number;
      paginationComplete: boolean;
      pagesScanned: number;
    }
  | {
      outcome: "not_found";
      paginationComplete: boolean;
      pagesScanned: number;
    }
  | {
      outcome: "duplicate";
      transferIds: string[];
      pagesScanned: number;
    }
  | {
      outcome: "lookup_incomplete";
      reason: string;
      pagesScanned: number;
    }
  | {
      outcome: "lookup_failed";
      reason: string;
    }
  | {
      outcome: "validation_failed";
      transferId: string;
      reason: string;
      pagesScanned: number;
    }
  | {
      outcome: "legacy_transfer_suspected";
      transferIds: string[];
      reason: string;
      pagesScanned: number;
    };

export type ListTransfersPageFn = (
  params: Stripe.TransferListParams,
) => Promise<Stripe.ApiList<Stripe.Transfer>>;

let listTransfersPageFnForTests: ListTransfersPageFn | null = null;

export function __setEmployeeTipReleaseTransferListFnForTests(fn: ListTransfersPageFn | null): void {
  listTransfersPageFnForTests = fn;
}

async function listTransfersPage(
  params: Stripe.TransferListParams,
): Promise<Stripe.ApiList<Stripe.Transfer>> {
  if (listTransfersPageFnForTests) {
    return listTransfersPageFnForTests(params);
  }
  return getStripeClient().transfers.list(params);
}

export function transferDestinationId(tr: Stripe.Transfer): string | null {
  if (typeof tr.destination === "string") return tr.destination;
  return tr.destination?.id ?? null;
}

export function validateEmployeeTipReleaseTransferCandidate(
  tr: Stripe.Transfer,
  expected: {
    payableId: string;
    employeeId: string;
    businessId: string;
    transactionId: string;
    destinationAccountId: string;
    expectedAmountCents: number;
    currency: string;
  },
): string | null {
  const metaPayable = tr.metadata?.caretip_payable_id?.trim();
  if (metaPayable !== expected.payableId) {
    return "metadata_payable_mismatch";
  }
  const dest = transferDestinationId(tr);
  if (!dest || dest !== expected.destinationAccountId.trim()) {
    return "destination_mismatch";
  }
  if ((tr.currency ?? "").toLowerCase() !== expected.currency.toLowerCase()) {
    return "currency_mismatch";
  }
  if (tr.amount !== expected.expectedAmountCents) {
    return "amount_mismatch";
  }
  const metaEmployee = tr.metadata?.caretip_employee_id?.trim();
  if (metaEmployee && metaEmployee !== expected.employeeId) {
    return "metadata_employee_mismatch";
  }
  const metaTxn = tr.metadata?.caretip_transaction_id?.trim();
  if (metaTxn && metaTxn !== expected.transactionId) {
    return "metadata_transaction_mismatch";
  }
  const metaBusiness = tr.metadata?.caretip_business_id?.trim();
  if (metaBusiness && metaBusiness !== expected.businessId) {
    return "metadata_business_mismatch";
  }
  return null;
}

/**
 * Paginate transfers to a Connect destination and collect those tagged with caretip_payable_id.
 */
function isLegacyTransferCandidate(
  tr: Stripe.Transfer,
  params: {
    payableId: string;
    destinationAccountId: string;
    expectedAmountCents: number;
    stripeChargeId: string | null;
  },
): boolean {
  const metaPayable = tr.metadata?.caretip_payable_id?.trim();
  if (metaPayable) return false;
  const dest = transferDestinationId(tr);
  if (dest !== params.destinationAccountId.trim()) return false;
  if (tr.amount !== params.expectedAmountCents) return false;
  const chargeId = params.stripeChargeId?.trim();
  if (!chargeId?.startsWith("ch_")) return false;
  const source =
    typeof tr.source_transaction === "string"
      ? tr.source_transaction
      : (tr.source_transaction as { id?: string } | null)?.id ?? null;
  return source === chargeId;
}

export async function findStripeTransfersForEmployeeTipPayable(params: {
  payableId: string;
  destinationAccountId: string;
  employeeId: string;
  businessId: string;
  transactionId: string;
  expectedAmountCents: number;
  currency: string;
  stripeChargeId?: string | null;
}): Promise<EmployeeTipTransferLookupResult> {
  const dest = params.destinationAccountId.trim();
  if (!dest.startsWith("acct_")) {
    return { outcome: "lookup_failed", reason: "invalid_destination" };
  }
  if (!isStripeConfigured() && !listTransfersPageFnForTests) {
    return { outcome: "lookup_failed", reason: "stripe_not_configured" };
  }

  const matches: Stripe.Transfer[] = [];
  const legacySuspects: Stripe.Transfer[] = [];
  let pagesScanned = 0;
  let paginationComplete = false;
  let startingAfter: string | undefined;

  try {
    for (let page = 0; page < EMPLOYEE_TIP_RELEASE_TRANSFER_LOOKUP_MAX_PAGES; page += 1) {
      pagesScanned += 1;
      const list = await listTransfersPage({
        destination: dest,
        limit: EMPLOYEE_TIP_RELEASE_TRANSFER_LOOKUP_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const tr of list.data) {
        if (tr.metadata?.caretip_payable_id?.trim() === params.payableId) {
          matches.push(tr);
          continue;
        }
        if (
          isLegacyTransferCandidate(tr, {
            payableId: params.payableId,
            destinationAccountId: dest,
            expectedAmountCents: params.expectedAmountCents,
            stripeChargeId: params.stripeChargeId ?? null,
          })
        ) {
          legacySuspects.push(tr);
        }
      }
      if (!list.has_more) {
        paginationComplete = true;
        break;
      }
      const last = list.data[list.data.length - 1];
      if (!last?.id) {
        return {
          outcome: "lookup_incomplete",
          reason: "pagination_missing_cursor",
          pagesScanned,
        };
      }
      startingAfter = last.id;
    }
  } catch (err) {
    const e = err as { statusCode?: number; code?: string };
    if (e.statusCode === 429 || e.code === "rate_limit") {
      return { outcome: "lookup_failed", reason: "rate_limited" };
    }
    const reason =
      err instanceof Error ? err.message.slice(0, 120) : "stripe_list_failed";
    return { outcome: "lookup_failed", reason };
  }

  if (!paginationComplete) {
    return {
      outcome: "lookup_incomplete",
      reason: "max_pages_exceeded",
      pagesScanned,
    };
  }

  if (matches.length > 1) {
    return {
      outcome: "duplicate",
      transferIds: matches.map((t) => t.id),
      pagesScanned,
    };
  }

  if (matches.length === 0 && legacySuspects.length > 0) {
    return {
      outcome: "legacy_transfer_suspected",
      transferIds: legacySuspects.map((t) => t.id),
      reason: "missing_caretip_payable_id_metadata",
      pagesScanned,
    };
  }

  if (matches.length === 1) {
    const tr = matches[0];
    const validationError = validateEmployeeTipReleaseTransferCandidate(tr, params);
    if (validationError) {
      return {
        outcome: "validation_failed",
        transferId: tr.id,
        reason: validationError,
        pagesScanned,
      };
    }
    return {
      outcome: "found",
      transferId: tr.id,
      amountCents: tr.amount,
      paginationComplete: true,
      pagesScanned,
    };
  }

  return {
    outcome: "not_found",
    paginationComplete: true,
    pagesScanned,
  };
}

/**
 * Payables that may already have a Stripe transfer not reflected in CareTip.
 * Uses priorStatus (before this lock) so a fresh held_platform → transferring claim
 * does not force a full list scan; re-entrant transferring recovery does.
 */
export function employeeTipReleaseRequiresStripeTransferLookup(row: {
  priorStatus: EmployeeTipPayableStatus;
  updatedAt: Date;
  stripeTransferId: string | null;
  /** True when reclaiming after an expired processing claim on a transferring payable. */
  reclaimedAfterExpiredClaim?: boolean;
  durableReleaseBlock?: string | null;
}): boolean {
  if (row.stripeTransferId) return false;
  if (
    row.durableReleaseBlock ||
    row.reclaimedAfterExpiredClaim ||
    row.priorStatus === EmployeeTipPayableStatus.transferring
  ) {
    return true;
  }
  const ageMs = Date.now() - row.updatedAt.getTime();
  if (ageMs >= employeeTipReleaseIdempotencySafeWindowMs()) {
    return true;
  }
  return false;
}
