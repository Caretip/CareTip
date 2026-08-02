import type { Prisma, QrGuestVisitStatus } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../../prisma.js";
import { isPrismaUniqueViolation } from "../../utils/prismaErrors.js";
import {
  buildVisitScanDedupeKey,
  QR_GUEST_VISIT_TTL_MS,
  resolveEntryPath,
  resolveRequiredScanSessionId,
} from "./qrScanRequestContext.js";
import {
  persistQrScanEvent,
  type PersistQrScanResult,
  type RecordQrScanEventInput,
} from "./qrScanEvent.service.js";

export const QR_GUEST_VISIT_STATUSES = {
  ACTIVE: "active",
  COMPLETED: "completed",
  EXPIRED: "expired",
} as const satisfies Record<string, QrGuestVisitStatus>;

export type StartGuestVisitInput = Omit<RecordQrScanEventInput, "req"> & {
  req: Request;
};

export type StartGuestVisitResult = PersistQrScanResult & {
  visitId?: string;
  visitStatus?: QrGuestVisitStatus;
};

const VISIT_TX_OPTS = { maxWait: 15_000, timeout: 30_000 } as const;
const VISIT_TX_MAX_ATTEMPTS = 5;

function visitExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + QR_GUEST_VISIT_TTL_MS);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function expireStaleActiveVisit(
  tx: Prisma.TransactionClient,
  visit: { id: string; expiresAt: Date },
  now: Date,
): Promise<void> {
  if (visit.expiresAt >= now) return;
  await tx.qrGuestVisit.update({
    where: { id: visit.id },
    data: { status: QR_GUEST_VISIT_STATUSES.EXPIRED },
  });
}

async function findReusableVisit(
  tx: Prisma.TransactionClient,
  businessId: string,
  sessionId: string,
  now: Date,
) {
  const visit = await tx.qrGuestVisit.findFirst({
    where: {
      businessId,
      sessionId,
      status: {
        in: [QR_GUEST_VISIT_STATUSES.ACTIVE, QR_GUEST_VISIT_STATUSES.COMPLETED],
      },
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      scanEventId: true,
      status: true,
      expiresAt: true,
    },
  });
  if (!visit) return null;
  if (visit.status === QR_GUEST_VISIT_STATUSES.ACTIVE && visit.expiresAt < now) {
    await expireStaleActiveVisit(tx, visit, now);
    return null;
  }
  return visit;
}

type VisitTxResult = PersistQrScanResult & {
  visitId?: string;
  visitStatus?: QrGuestVisitStatus;
};

async function runVisitTransaction(
  input: StartGuestVisitInput,
  sessionId: string,
  now: Date,
  expiresAt: Date,
  entryPath: string,
): Promise<VisitTxResult> {
  return prisma.$transaction(async (tx) => {
    let visit = await findReusableVisit(tx, input.businessId, sessionId, now);

    if (visit?.scanEventId) {
      return {
        inserted: false,
        scanId: visit.scanEventId,
        visitId: visit.id,
        visitStatus: visit.status,
      };
    }

    if (!visit) {
      visit = await tx.qrGuestVisit.create({
        data: {
          businessId: input.businessId,
          sessionId,
          status: QR_GUEST_VISIT_STATUSES.ACTIVE,
          scanType: input.scanType,
          employeeId: input.employeeId ?? null,
          locationId: input.locationId ?? null,
          tableId: input.tableId ?? null,
          qrSlug: input.qrSlug?.slice(0, 128) ?? null,
          entryPath,
          expiresAt,
        },
        select: {
          id: true,
          scanEventId: true,
          status: true,
          expiresAt: true,
        },
      });
    }

    const dedupeKey = buildVisitScanDedupeKey(visit.id);
    const scanResult = await persistQrScanEvent({ ...input, dedupeKey }, tx);

    if (scanResult.inserted && scanResult.scanId) {
      await tx.qrGuestVisit.update({
        where: { id: visit.id },
        data: { scanEventId: scanResult.scanId },
      });
    } else if (!scanResult.inserted) {
      const linked = await tx.qrGuestVisit.findUnique({
        where: { id: visit.id },
        select: { scanEventId: true },
      });
      if (linked?.scanEventId) {
        return {
          inserted: false,
          scanId: linked.scanEventId,
          visitId: visit.id,
          visitStatus: visit.status,
        };
      }
    }

    return {
      ...scanResult,
      visitId: visit.id,
      visitStatus: visit.status,
    };
  }, VISIT_TX_OPTS);
}

/**
 * Phase 3 — sole orchestrator for visit start + scan insert.
 * Read APIs must never call this; only POST /api/qr/scan.
 */
export async function startGuestVisitAndRecordScan(
  input: StartGuestVisitInput,
): Promise<StartGuestVisitResult> {
  const sessionId = resolveRequiredScanSessionId(input.req);
  const now = new Date();
  const expiresAt = visitExpiryFrom(now);
  const entryPath = resolveEntryPath(input.req);

  for (let attempt = 0; attempt < VISIT_TX_MAX_ATTEMPTS; attempt++) {
    try {
      return await runVisitTransaction(input, sessionId, now, expiresAt, entryPath);
    } catch (err) {
      if (!isPrismaUniqueViolation(err) || attempt >= VISIT_TX_MAX_ATTEMPTS - 1) {
        throw err;
      }
      await sleep(20 * (attempt + 1));
    }
  }

  throw new Error("startGuestVisitAndRecordScan: exhausted retries");
}

/** Mark visit completed after successful payment — does not create a new scan. */
export async function completeGuestVisit(businessId: string, sessionId: string): Promise<void> {
  const trimmed = sessionId.trim().slice(0, 64);
  if (!trimmed) return;
  await prisma.qrGuestVisit.updateMany({
    where: {
      businessId,
      sessionId: trimmed,
      status: QR_GUEST_VISIT_STATUSES.ACTIVE,
    },
    data: {
      status: QR_GUEST_VISIT_STATUSES.COMPLETED,
      completedAt: new Date(),
    },
  });
}
