/**
 * Business tombstone — strip non-essential assets after closure; keep identity + Stripe mapping + financial rows.
 *
 * Gated: DATA_LIFECYCLE_V1 + DATA_LIFECYCLE_TOMBSTONE_EXECUTE (default OFF).
 * Dry-run: DATA_LIFECYCLE_DRY_RUN.
 * Does not delete Transaction, TipRefund, StripeConnectPayout, or stripeAccountId.
 */

import { prisma } from "../prisma.js";
import { envFlagTrue, isDataLifecycleV1Enabled, isDataLifecycleDryRunEnabled } from "./retentionPolicy.helpers.js";
import { ACCOUNT_ERASURE_GRACE_DAYS } from "./retentionPolicy.constants.js";
import { addUtcDays } from "./retentionCalendar.js";
import { logDryRunRecord } from "./retentionDryRun.js";
import { writeAuditLog } from "./audit.service.js";

export class BusinessTombstoneError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "EXECUTION_GATED" | "PRECONDITION" | "LEGAL_HOLD" | "GRACE",
  ) {
    super(message);
    this.name = "BusinessTombstoneError";
  }
}

function assertTombstoneAllowed(opts?: { bypassExecutionGate?: boolean }): "dry_run" | "execute" {
  if (opts?.bypassExecutionGate) {
    return isDataLifecycleDryRunEnabled() ? "dry_run" : "execute";
  }
  if (!isDataLifecycleV1Enabled()) {
    throw new BusinessTombstoneError("Tombstone execution disabled", "EXECUTION_GATED");
  }
  if (isDataLifecycleDryRunEnabled()) return "dry_run";
  if (!envFlagTrue("DATA_LIFECYCLE_TOMBSTONE_EXECUTE")) {
    throw new BusinessTombstoneError("Tombstone execution disabled", "EXECUTION_GATED");
  }
  return "execute";
}

export async function tombstoneBusinessNonEssential(
  businessId: string,
  opts?: { bypassExecutionGate?: boolean; now?: Date; actorId?: string | null },
): Promise<{
  dryRun: boolean;
  alreadyComplete: boolean;
  strippedLogo: boolean;
  lifecycleStatus: string;
}> {
  const mode = assertTombstoneAllowed(opts);
  const now = opts?.now ?? new Date();
  const id = String(businessId ?? "").trim();
  const row = await prisma.business.findUnique({
    where: { id },
    select: {
      id: true,
      lifecycleStatus: true,
      deletedAt: true,
      logoPath: true,
      welcomeMessage: true,
      legalHold: true,
      legalHoldCategories: true,
      tombstonedAt: true,
      stripeAccountId: true,
      taxId: true,
      name: true,
    },
  });
  if (!row) throw new BusinessTombstoneError("Business not found", "NOT_FOUND");

  if (row.legalHold) {
    throw new BusinessTombstoneError("Legal hold blocks tombstone", "LEGAL_HOLD");
  }

  if (row.lifecycleStatus === "tombstoned" && row.tombstonedAt) {
    return {
      dryRun: mode === "dry_run",
      alreadyComplete: true,
      strippedLogo: false,
      lifecycleStatus: row.lifecycleStatus,
    };
  }

  if (row.lifecycleStatus !== "soft_closed" && row.lifecycleStatus !== "data_restricted") {
    throw new BusinessTombstoneError(
      "Business must be soft_closed or data_restricted before tombstone",
      "PRECONDITION",
    );
  }

  const anchor = row.deletedAt;
  if (!anchor) {
    throw new BusinessTombstoneError("No closure deletedAt — fail-closed", "GRACE");
  }
  const eligibleAt = addUtcDays(anchor, ACCOUNT_ERASURE_GRACE_DAYS);
  if (now.getTime() < eligibleAt.getTime()) {
    throw new BusinessTombstoneError("Closure grace period has not elapsed", "GRACE");
  }

  if (mode === "dry_run") {
    logDryRunRecord({
      action: "WOULD_TOMBSTONE",
      category: "business_non_essential",
      record: row.id,
      reason: "closure_grace_elapsed",
      retentionExpiry: eligibleAt.toISOString(),
      legalHold: false,
      financialPreservation: "preserved",
    });
    return {
      dryRun: true,
      alreadyComplete: false,
      strippedLogo: Boolean(row.logoPath),
      lifecycleStatus: row.lifecycleStatus,
    };
  }

  await prisma.business.update({
    where: { id: row.id },
    data: {
      lifecycleStatus: "tombstoned",
      tombstonedAt: now,
      logoPath: null,
      welcomeMessage: null,
      // Keep name, taxId, stripeAccountId, financial rows.
    },
  });
  await writeAuditLog({
    userId: opts?.actorId ?? null,
    action: "business.tombstone.non_essential_stripped",
    metadata: JSON.stringify({
      resourceType: "business",
      resourceId: row.id,
      stripeMappingPreserved: Boolean(row.stripeAccountId),
      taxIdPreserved: Boolean(row.taxId),
    }),
  });
  return {
    dryRun: false,
    alreadyComplete: false,
    strippedLogo: Boolean(row.logoPath),
    lifecycleStatus: "tombstoned",
  };
}
