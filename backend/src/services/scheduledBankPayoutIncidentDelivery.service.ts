/**
 * Phase C hardening — per-recipient in-app delivery with leased claims.
 */
import {
  ScheduledPayoutOpsIncidentStatus,
  type ScheduledPayoutOpsIncident,
} from "@prisma/client";

/** Mirrors `ScheduledPayoutOpsIncidentDeliveryStatus` (Prisma client may be stale until `prisma generate`). */
export type IncidentInAppDeliveryStatus = "pending" | "claimed" | "delivered" | "failed";

const DeliveryStatus = {
  pending: "pending",
  claimed: "claimed",
  delivered: "delivered",
  failed: "failed",
} as const satisfies Record<string, IncidentInAppDeliveryStatus>;

type IncidentDeliveryRow = {
  id: string;
  incidentId: string;
  notifyGeneration: number;
  userId: string;
  channel: "in_app";
  dedupeKey: string;
  status: IncidentInAppDeliveryStatus;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  inboxNotificationId: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  incident: ScheduledPayoutOpsIncident;
};

type IncidentDeliveryDelegate = {
  createMany: (args: {
    data: Array<{
      incidentId: string;
      notifyGeneration: number;
      userId: string;
      channel: "in_app";
      dedupeKey: string;
      status: IncidentInAppDeliveryStatus;
    }>;
    skipDuplicates?: boolean;
  }) => Promise<{ count: number }>;
  findUnique: (args: { where: { id: string } }) => Promise<IncidentDeliveryRow | null>;
  findMany: (args: unknown) => Promise<IncidentDeliveryRow[]>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
  count: (args: unknown) => Promise<number>;
};

function incidentDeliveryDb(): IncidentDeliveryDelegate {
  return (prisma as unknown as { scheduledPayoutOpsIncidentDelivery: IncidentDeliveryDelegate })
    .scheduledPayoutOpsIncidentDelivery;
}
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma.js";
import { localizeNotificationPayload } from "../notifications/notificationI18n.js";
import { logServerError } from "../utils/httpErrors.js";
import {
  SCHEDULED_PAYOUT_INCIDENT_DELIVERY_BATCH,
  SCHEDULED_PAYOUT_INCIDENT_NOTIFY_INCIDENT_BATCH,
  scheduledPayoutIncidentDeliveryClaimLeaseMinutes,
  scheduledPayoutIncidentNotifyRetryMinutes,
} from "../config/scheduledPayoutIncident.config.js";
import {
  buildScheduledPayoutOpsIncidentTemplate,
  safeScheduledPayoutLedgerRef,
  scheduledPayoutOpsIncidentDedupeKey,
  scheduledPayoutOpsIncidentUrl,
} from "./scheduledBankPayoutIncident.notify.js";
import { createInboxNotification } from "./notifications/notificationInbox.service.js";
import { NotificationType } from "./push/notification.types.js";
import { sendNotification } from "./push/notification.service.js";

export type IncidentDeliveryMetrics = {
  deliveriesClaimed: number;
  deliveriesDelivered: number;
  deliveriesFailed: number;
  claimsReclaimed: number;
  claimOwnershipLost: number;
  retryThrottled: number;
  generationsCompleted: number;
  oldestPendingAgeMs: number | null;
};

export type ClaimDeliveryResult =
  | { ok: true; claimToken: string; reclaimed: boolean }
  | { ok: false; reason: "contention" | "not_eligible" | "lost_ownership" };

export function parseScheduledPayoutIncidentDedupeKey(
  dedupeKey: string,
): { incidentId: string; notifyGeneration: number; userId: string } | null {
  const m = /^sched_payout_inc:([^:]+):g(\d+):(.+)$/.exec(dedupeKey.trim());
  if (!m) return null;
  const generation = Number.parseInt(m[2], 10);
  if (!Number.isFinite(generation)) return null;
  return { incidentId: m[1], notifyGeneration: generation, userId: m[3] };
}

export function inboxMetadataMatchesIncidentDelivery(
  metadata: unknown,
  incidentId: string,
  notifyGeneration: number,
): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const meta = metadata as Record<string, unknown>;
  if (meta.incidentId !== incidentId) return false;
  const genRaw = meta.notifyGeneration ?? meta.entityId;
  if (typeof genRaw === "string" && genRaw.includes(`:g${notifyGeneration}`)) return true;
  if (meta.notifyGeneration === notifyGeneration) return true;
  const entityId = meta.entityId;
  if (typeof entityId === "string" && entityId.endsWith(`:g${notifyGeneration}`)) return true;
  return false;
}

export function deliveryRowEligibleForClaim(
  row: Pick<IncidentDeliveryRow, "status" | "claimExpiresAt" | "nextAttemptAt" | "notifyGeneration">,
  incident: Pick<ScheduledPayoutOpsIncident, "notifyGeneration" | "status">,
  now: Date,
): boolean {
  if (incident.status !== ScheduledPayoutOpsIncidentStatus.open) return false;
  if (row.notifyGeneration !== incident.notifyGeneration) return false;
  if (row.status === DeliveryStatus.delivered) return false;
  if (row.nextAttemptAt && row.nextAttemptAt.getTime() > now.getTime()) return false;
  if (row.status === DeliveryStatus.claimed) {
    if (!row.claimExpiresAt) return false;
    return row.claimExpiresAt.getTime() <= now.getTime();
  }
  return row.status === DeliveryStatus.pending || row.status === DeliveryStatus.failed;
}

export function newDeliveryClaimToken(): string {
  return randomBytes(16).toString("hex");
}

export function claimLeaseExpiresAt(now: Date): Date {
  const ms = scheduledPayoutIncidentDeliveryClaimLeaseMinutes() * 60 * 1000;
  return new Date(now.getTime() + ms);
}

export async function ensureIncidentInAppDeliveryRows(
  incident: ScheduledPayoutOpsIncident,
  adminUserIds: string[],
): Promise<void> {
  if (adminUserIds.length === 0) return;
  if (incident.lastNotifiedGeneration >= incident.notifyGeneration) return;
  const rows = adminUserIds.map((userId) => ({
    incidentId: incident.id,
    notifyGeneration: incident.notifyGeneration,
    userId,
    channel: "in_app" as const,
    dedupeKey: scheduledPayoutOpsIncidentDedupeKey(incident.id, incident.notifyGeneration, userId),
    status: DeliveryStatus.pending,
  }));
  await incidentDeliveryDb().createMany({ data: rows, skipDuplicates: true });
}

export async function claimIncidentDeliveryRow(
  deliveryId: string,
  incident: ScheduledPayoutOpsIncident,
  now: Date,
): Promise<ClaimDeliveryResult> {
  const row = await incidentDeliveryDb().findUnique({ where: { id: deliveryId } });
  if (!row) return { ok: false, reason: "not_eligible" };
  if (!deliveryRowEligibleForClaim(row, incident, now)) {
    return { ok: false, reason: "not_eligible" };
  }

  const claimToken = newDeliveryClaimToken();
  const claimExpiresAt = claimLeaseExpiresAt(now);
  const reclaimed =
    row.status === DeliveryStatus.claimed &&
    row.claimExpiresAt != null &&
    row.claimExpiresAt.getTime() <= now.getTime();

  const claimed = await incidentDeliveryDb().updateMany({
    where: {
      id: deliveryId,
      notifyGeneration: incident.notifyGeneration,
      OR: [
        { status: DeliveryStatus.pending },
        { status: DeliveryStatus.failed },
        {
          status: DeliveryStatus.claimed,
          claimExpiresAt: { lte: now },
        },
      ],
    },
    data: {
      status: DeliveryStatus.claimed,
      claimToken,
      claimExpiresAt,
      attemptCount: { increment: 1 },
    },
  });

  if (claimed.count !== 1) return { ok: false, reason: "contention" };
  return { ok: true, claimToken, reclaimed };
}

export type InAppPersistResult =
  | { outcome: "created"; notificationId: string }
  | { outcome: "recognized_existing"; notificationId: string }
  | { outcome: "failed"; errorCode: string };

export async function persistIncidentInAppNotification(args: {
  incident: ScheduledPayoutOpsIncident;
  userId: string;
  dedupeKey: string;
}): Promise<InAppPersistResult> {
  const ledgerRef = safeScheduledPayoutLedgerRef(args.incident.ledgerId);
  const template = buildScheduledPayoutOpsIncidentTemplate({
    payoutType: args.incident.payoutType,
    category: args.incident.category,
    subjectLabel: args.incident.subjectLabel ?? args.incident.payoutType,
    ledgerRef,
    detectedAtIso: args.incident.firstDetectedAt.toISOString(),
  });
  const url = scheduledPayoutOpsIncidentUrl(args.incident.payoutType, args.incident.ledgerId);
  const entityId = `${args.incident.payoutType}:${args.incident.ledgerId}:${args.incident.category}:g${args.incident.notifyGeneration}`;

  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { preferredLocale: true },
  });
  const localized = localizeNotificationPayload(user?.preferredLocale, {
    title: "Scheduled bank payout incident",
    body: "",
    localeTemplate: template,
  });

  const metadata = {
    entityId,
    incidentId: args.incident.id,
    notifyGeneration: args.incident.notifyGeneration,
    payoutType: args.incident.payoutType,
    category: args.incident.category,
    ledgerRef,
    url,
    localeTemplate: template,
  };

  const created = await createInboxNotification({
    userId: args.userId,
    type: NotificationType.SYSTEM_ALERT,
    title: localized.title,
    message: localized.body,
    metadata,
    priority: args.incident.severity,
    channels: ["in_app", "push"],
    dedupeKey: args.dedupeKey,
  });

  if (created) {
    void sendNotification(
      args.userId,
      {
        type: NotificationType.SYSTEM_ALERT,
        title: localized.title,
        body: localized.body,
        localeTemplate: template,
        url,
        timestamp: new Date().toISOString(),
        metadata: {
          entityId: metadata.entityId,
          incidentId: metadata.incidentId,
          notifyGeneration: String(metadata.notifyGeneration),
          ledgerRef: metadata.ledgerRef,
          notificationId: created.id,
        },
      },
      { dedupeKey: `push:${args.dedupeKey}` },
    ).catch((err) => {
      logServerError("scheduled_payout_incident_push_best_effort", err, {
        incidentId: args.incident.id,
        userId: args.userId,
      });
    });
    return { outcome: "created", notificationId: created.id };
  }

  const existing = await prisma.notification.findFirst({
    where: { userId: args.userId, dedupeKey: args.dedupeKey },
    select: { id: true, metadata: true, dedupeKey: true },
  });
  if (
    existing &&
    existing.dedupeKey === args.dedupeKey &&
    inboxMetadataMatchesIncidentDelivery(existing.metadata, args.incident.id, args.incident.notifyGeneration)
  ) {
    return { outcome: "recognized_existing", notificationId: existing.id };
  }

  const parsed = parseScheduledPayoutIncidentDedupeKey(args.dedupeKey);
  if (
    existing &&
    parsed &&
    parsed.incidentId === args.incident.id &&
    parsed.notifyGeneration === args.incident.notifyGeneration &&
    parsed.userId === args.userId
  ) {
    return { outcome: "recognized_existing", notificationId: existing.id };
  }

  return { outcome: "failed", errorCode: "inbox_dedupe_conflict" };
}

export async function markIncidentDeliveryDelivered(
  deliveryId: string,
  claimToken: string,
  notifyGeneration: number,
  inboxNotificationId: string,
): Promise<boolean> {
  const updated = await incidentDeliveryDb().updateMany({
    where: {
      id: deliveryId,
      notifyGeneration,
      status: DeliveryStatus.claimed,
      claimToken,
    },
    data: {
      status: DeliveryStatus.delivered,
      inboxNotificationId,
      claimToken: null,
      claimExpiresAt: null,
      nextAttemptAt: null,
      lastErrorCode: null,
    },
  });
  return updated.count === 1;
}

export async function releaseIncidentDeliveryClaim(
  deliveryId: string,
  claimToken: string,
  notifyGeneration: number,
  options: { failed: boolean; nextAttemptAt: Date; errorCode?: string },
): Promise<boolean> {
  const updated = await incidentDeliveryDb().updateMany({
    where: {
      id: deliveryId,
      notifyGeneration,
      status: DeliveryStatus.claimed,
      claimToken,
    },
    data: {
      status: options.failed ? DeliveryStatus.failed : DeliveryStatus.pending,
      claimToken: null,
      claimExpiresAt: null,
      nextAttemptAt: options.nextAttemptAt,
      lastErrorCode: options.errorCode ?? null,
    },
  });
  return updated.count === 1;
}

export async function tryMarkIncidentGenerationNotified(
  incidentId: string,
  notifyGeneration: number,
  now: Date,
): Promise<boolean> {
  const db = incidentDeliveryDb();
  const [pendingCount, deliveredCount, adminTarget] = await Promise.all([
    db.count({
      where: {
        incidentId,
        notifyGeneration,
        channel: "in_app",
        status: { not: DeliveryStatus.delivered },
      },
    }),
    db.count({
      where: {
        incidentId,
        notifyGeneration,
        channel: "in_app",
        status: DeliveryStatus.delivered,
      },
    }),
    db.count({
      where: { incidentId, notifyGeneration, channel: "in_app" },
    }),
  ]);

  if (adminTarget === 0 || pendingCount > 0 || deliveredCount < adminTarget) {
    return false;
  }

  const marked = await prisma.scheduledPayoutOpsIncident.updateMany({
    where: {
      id: incidentId,
      status: ScheduledPayoutOpsIncidentStatus.open,
      notifyGeneration,
      lastNotifiedGeneration: { lt: notifyGeneration },
    },
    data: {
      lastNotifiedGeneration: notifyGeneration,
      lastNotifiedAt: now,
      notifyingGeneration: null,
    },
  });
  return marked.count === 1;
}

export async function processScheduledPayoutIncidentDeliveries(
  now: Date,
  adminUserIds: string[],
): Promise<IncidentDeliveryMetrics> {
  const metrics: IncidentDeliveryMetrics = {
    deliveriesClaimed: 0,
    deliveriesDelivered: 0,
    deliveriesFailed: 0,
    claimsReclaimed: 0,
    claimOwnershipLost: 0,
    retryThrottled: 0,
    generationsCompleted: 0,
    oldestPendingAgeMs: null,
  };

  if (adminUserIds.length === 0) return metrics;

  const retryMs = scheduledPayoutIncidentNotifyRetryMinutes() * 60 * 1000;

  const openIncidents = await prisma.scheduledPayoutOpsIncident.findMany({
    where: { status: ScheduledPayoutOpsIncidentStatus.open },
    take: SCHEDULED_PAYOUT_INCIDENT_NOTIFY_INCIDENT_BATCH,
    orderBy: [{ firstDetectedAt: "asc" }],
  });

  const needsNotify = openIncidents.filter((i) => i.lastNotifiedGeneration < i.notifyGeneration);
  for (const incident of needsNotify) {
    await ensureIncidentInAppDeliveryRows(incident, adminUserIds);
  }

  const workQueue = await incidentDeliveryDb().findMany({
    where: {
      channel: "in_app",
      status: {
        in: [DeliveryStatus.pending, DeliveryStatus.failed, DeliveryStatus.claimed],
      },
      incident: {
        status: ScheduledPayoutOpsIncidentStatus.open,
      },
    },
    include: { incident: true },
    take: SCHEDULED_PAYOUT_INCIDENT_DELIVERY_BATCH * 2,
    orderBy: [{ createdAt: "asc" }],
  });

  const eligible = workQueue.filter((row) => {
    if (row.incident.lastNotifiedGeneration >= row.notifyGeneration) return false;
    if (row.notifyGeneration !== row.incident.notifyGeneration) return false;
    if (!deliveryRowEligibleForClaim(row, row.incident, now)) {
      if (row.nextAttemptAt && row.nextAttemptAt.getTime() > now.getTime()) {
        metrics.retryThrottled += 1;
      }
      return false;
    }
    return true;
  });

  if (eligible.length > 0) {
    const oldest = eligible[0]?.createdAt;
    if (oldest) metrics.oldestPendingAgeMs = now.getTime() - oldest.getTime();
  }

  for (const row of eligible.slice(0, SCHEDULED_PAYOUT_INCIDENT_DELIVERY_BATCH)) {
    const incident = row.incident;
    const claim = await claimIncidentDeliveryRow(row.id, incident, now);
    if (!claim.ok) {
      if (claim.reason === "contention") metrics.claimOwnershipLost += 1;
      continue;
    }
    metrics.deliveriesClaimed += 1;
    if (claim.reclaimed) metrics.claimsReclaimed += 1;

    try {
      const persist = await persistIncidentInAppNotification({
        incident,
        userId: row.userId,
        dedupeKey: row.dedupeKey,
      });

      if (persist.outcome === "created" || persist.outcome === "recognized_existing") {
        const marked = await markIncidentDeliveryDelivered(
          row.id,
          claim.claimToken,
          incident.notifyGeneration,
          persist.notificationId,
        );
        if (!marked) {
          metrics.claimOwnershipLost += 1;
          continue;
        }
        metrics.deliveriesDelivered += 1;
        if (await tryMarkIncidentGenerationNotified(incident.id, incident.notifyGeneration, now)) {
          metrics.generationsCompleted += 1;
        }
      } else {
        const released = await releaseIncidentDeliveryClaim(row.id, claim.claimToken, incident.notifyGeneration, {
          failed: true,
          nextAttemptAt: new Date(now.getTime() + retryMs),
          errorCode: persist.errorCode,
        });
        if (!released) metrics.claimOwnershipLost += 1;
        else metrics.deliveriesFailed += 1;
      }
    } catch (err) {
      logServerError("scheduled_payout_incident_delivery_failed", err, {
        deliveryId: row.id,
        incidentId: incident.id,
      });
      const released = await releaseIncidentDeliveryClaim(row.id, claim.claimToken, incident.notifyGeneration, {
        failed: true,
        nextAttemptAt: new Date(now.getTime() + retryMs),
        errorCode: "delivery_exception",
      });
      if (!released) metrics.claimOwnershipLost += 1;
      else metrics.deliveriesFailed += 1;
    }
  }

  for (const incident of needsNotify) {
    if (await tryMarkIncidentGenerationNotified(incident.id, incident.notifyGeneration, now)) {
      metrics.generationsCompleted += 1;
    }
  }

  return metrics;
}
