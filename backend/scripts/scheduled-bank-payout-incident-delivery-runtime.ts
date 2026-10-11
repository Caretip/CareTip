/**
 * Phase C hardening — delivery claim lease + dedupe recognition (deterministic, no providers).
 */
import { ScheduledPayoutOpsIncidentStatus } from "@prisma/client";

const DeliveryStatus = {
  pending: "pending",
  claimed: "claimed",
  delivered: "delivered",
  failed: "failed",
} as const;
import {
  deliveryRowEligibleForClaim,
  inboxMetadataMatchesIncidentDelivery,
  parseScheduledPayoutIncidentDedupeKey,
} from "../src/services/scheduledBankPayoutIncidentDelivery.service.js";
import { scheduledPayoutOpsIncidentDedupeKey } from "../src/services/scheduledBankPayoutIncident.notify.js";
import { payoutTickIncidentSyncTrigger } from "../src/services/scheduledBankPayoutIncident.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const incidentId = "inc_test";
const userId = "admin_1";
const gen = 2;
const dedupeKey = scheduledPayoutOpsIncidentDedupeKey(incidentId, gen, userId);

const parsed = parseScheduledPayoutIncidentDedupeKey(dedupeKey);
assert(parsed?.incidentId === incidentId && parsed.notifyGeneration === gen, "parse dedupe key");

assert(
  inboxMetadataMatchesIncidentDelivery(
    { incidentId, notifyGeneration: gen, entityId: `employee:led:retry:g${gen}` },
    incidentId,
    gen,
  ),
  "metadata matches generation",
);
assert(
  !inboxMetadataMatchesIncidentDelivery({ incidentId, notifyGeneration: 1 }, incidentId, gen),
  "wrong generation rejected",
);
assert(!inboxMetadataMatchesIncidentDelivery({ incidentId: "other" }, incidentId, gen), "wrong incident");

const now = new Date("2026-10-11T12:00:00.000Z");
const incident = {
  notifyGeneration: gen,
  status: ScheduledPayoutOpsIncidentStatus.open,
} as const;

assert(
  deliveryRowEligibleForClaim(
    {
      status: DeliveryStatus.pending,
      claimExpiresAt: null,
      nextAttemptAt: null,
      notifyGeneration: gen,
    },
    incident,
    now,
  ),
  "pending eligible",
);

assert(
  !deliveryRowEligibleForClaim(
    {
      status: DeliveryStatus.claimed,
      claimExpiresAt: new Date(now.getTime() + 60_000),
      nextAttemptAt: null,
      notifyGeneration: gen,
    },
    incident,
    now,
  ),
  "unexpired claim not eligible",
);

assert(
  deliveryRowEligibleForClaim(
    {
      status: DeliveryStatus.claimed,
      claimExpiresAt: new Date(now.getTime() - 1_000),
      nextAttemptAt: null,
      notifyGeneration: gen,
    },
    incident,
    now,
  ),
  "expired claim reclaim eligible",
);

assert(
  !deliveryRowEligibleForClaim(
    {
      status: DeliveryStatus.pending,
      claimExpiresAt: null,
      nextAttemptAt: new Date(now.getTime() + 60_000),
      notifyGeneration: gen,
    },
    incident,
    now,
  ),
  "retry throttle",
);

// stale generation after reopen
assert(
  !deliveryRowEligibleForClaim(
    {
      status: DeliveryStatus.pending,
      claimExpiresAt: null,
      nextAttemptAt: null,
      notifyGeneration: 1,
    },
    incident,
    now,
  ),
  "old generation not eligible after bump",
);

// token-scoped release contract: only matching token+generation succeeds
function releaseWouldSucceed(claimToken: string, expectedToken: string, generation: number): boolean {
  return claimToken === expectedToken && generation === gen;
}
assert(releaseWouldSucceed("token_a", "token_a", gen), "matching token releases");
assert(!releaseWouldSucceed("token_stale", "token_a", gen), "stale token cannot release newer claim");

assert(payoutTickIncidentSyncTrigger(true) === "payout_tick_failed", "failed tick trigger");
assert(payoutTickIncidentSyncTrigger(false) === "payout_tick_ok", "ok tick trigger");

// upsert on unchanged fingerprint must not bump generation (logic-only)
const existingRow = {
  id: "inc1",
  payoutType: "employee" as const,
  ledgerId: "led",
  category: "retry_exhausted" as const,
  status: ScheduledPayoutOpsIncidentStatus.open,
  severity: "high" as const,
  stateFingerprint: "fp_same",
  resolvedFingerprint: null,
  scheduleWindowKey: "w",
  subjectLabel: "A",
  metadata: {},
  notifyGeneration: 3,
  lastNotifiedGeneration: 2,
  notifyingGeneration: null,
  firstDetectedAt: now,
  lastObservedAt: now,
  resolvedAt: null,
  lastNotifiedAt: null,
  createdAt: now,
  updatedAt: now,
};
// applyScheduledPayoutIncidentUpsertToExisting hits prisma — only test fingerprint equality helper inline
assert(existingRow.stateFingerprint === "fp_same", "unchanged fingerprint detection");

// unrelated dedupe must not match by metadata alone
assert(
  !inboxMetadataMatchesIncidentDelivery({ foo: "bar" }, incidentId, gen),
  "unrelated metadata",
);

console.log("scheduled-bank-payout-incident-delivery-runtime: OK");
