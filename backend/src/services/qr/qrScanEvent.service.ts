import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { ActivityEventSource } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { logServerError } from "../../utils/httpErrors.js";
import { isPrismaUniqueViolation } from "../../utils/prismaErrors.js";
import { emitQrScannedCanonical } from "../../socket/realtimeContracts.js";
import {
  ACTIVITY_EVENT_TYPES,
  projectBusinessActivityEvent,
} from "../activity/businessActivityEvent.service.js";
import {
  parseDeviceType,
  resolveEntryPath,
  resolveGeoFromRequest,
  resolveScanSessionId,
} from "./qrScanRequestContext.js";

/** Sprint 4B — scan types aligned with public QR entry routes. */
export const QR_SCAN_TYPES = {
  EMPLOYEE: "employee",
  EMPLOYEE_LEGACY_SLUG: "employee_legacy_slug",
  EMPLOYEE_LEGACY_ID: "employee_legacy_id",
  BUSINESS_DIRECTORY: "business_directory",
  BUSINESS_ID: "business_id",
  LOCATION: "location",
  TABLE_ID: "table_id",
  TABLE_SLUG: "table_slug",
} as const;

export type QrScanType = (typeof QR_SCAN_TYPES)[keyof typeof QR_SCAN_TYPES];

export type RecordQrScanEventInput = {
  businessId: string;
  scanType: QrScanType;
  req: Request;
  employeeId?: string | null;
  locationId?: string | null;
  tableId?: string | null;
  qrSlug?: string | null;
  /** Phase 3 — visit-scoped dedupe key supplied by qrGuestVisit.service. */
  dedupeKey?: string;
  /** When set, manager QR scan notification fires only after a successful insert. */
  notify?: {
    locationName?: string;
    tableName?: string;
  };
};

export type PersistQrScanResult = { inserted: boolean; scanId?: string };

type PrismaTx = Prisma.TransactionClient | typeof prisma;

function scanClient(tx?: Prisma.TransactionClient): PrismaTx {
  return tx ?? prisma;
}

/**
 * Phase 3 — internal insert only; called from startGuestVisitAndRecordScan.
 * Read endpoints must never invoke this.
 */
export async function persistQrScanEvent(
  input: RecordQrScanEventInput,
  tx?: Prisma.TransactionClient,
): Promise<PersistQrScanResult> {
  const { req, businessId, scanType } = input;
  if (!input.dedupeKey?.trim()) {
    throw new Error("persistQrScanEvent requires a visit-scoped dedupeKey");
  }
  const sessionId = resolveScanSessionId(req);
  const userAgent = req.headers["user-agent"]?.slice(0, 512) ?? null;
  const deviceType = parseDeviceType(userAgent ?? undefined);
  const { country, city } = resolveGeoFromRequest(req);
  const dedupeKey = input.dedupeKey.trim().slice(0, 191);
  const entryPath = resolveEntryPath(req);
  const db = scanClient(tx);

  try {
    const row = await db.qrScanEvent.create({
      data: {
        businessId,
        employeeId: input.employeeId ?? null,
        locationId: input.locationId ?? null,
        tableId: input.tableId ?? null,
        qrSlug: input.qrSlug?.slice(0, 128) ?? null,
        scanType,
        entryPath,
        userAgent,
        deviceType,
        country,
        city,
        sessionId,
        dedupeKey,
      },
      select: {
        id: true,
        scanType: true,
        scannedAt: true,
        deviceType: true,
        employeeId: true,
        locationId: true,
        tableId: true,
        qrSlug: true,
      },
    });

    if (!tx) {
      emitSideEffects(row, input, sessionId);
    }

    return { inserted: true, scanId: row.id };
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      return { inserted: false };
    }
    throw err;
  }
}

function emitSideEffects(
  row: {
    id: string;
    scanType: string;
    scannedAt: Date;
    deviceType: string;
    employeeId: string | null;
    locationId: string | null;
    tableId: string | null;
    qrSlug: string | null;
  },
  input: RecordQrScanEventInput,
  sessionId: string,
): void {
  const { businessId } = input;

  emitQrScannedCanonical(
    businessId,
    {
      scanId: row.id,
      employeeId: row.employeeId ?? undefined,
      locationId: row.locationId ?? undefined,
      tableId: row.tableId ?? undefined,
    },
    {
      scanType: row.scanType,
      scannedAt: row.scannedAt.toISOString(),
      deviceType: row.deviceType,
      qrSlug: row.qrSlug,
      sessionId,
    },
  );

  projectBusinessActivityEvent({
    businessId,
    type: ACTIVITY_EVENT_TYPES.QR_SCANNED,
    source: ActivityEventSource.QR,
    occurredAt: row.scannedAt,
    dedupeKey: `scan:${row.id}:scanned`,
    subjectType: "scan",
    subjectId: row.id,
    actorEmployeeId: row.employeeId,
    locationId: row.locationId,
    tableId: row.tableId,
    summary: {
      scanType: row.scanType,
      deviceType: row.deviceType,
      qrSlug: row.qrSlug,
      sessionId,
    },
  });

  if (input.notify) {
    void import("../push/notificationContext.js").then(({ notifyQrScanForBusiness }) => {
      notifyQrScanForBusiness({
        businessId,
        scanId: row.id,
        locationName: input.notify?.locationName,
        tableName: input.notify?.tableName,
        qrSlug: row.qrSlug ?? input.qrSlug ?? undefined,
      });
    });
  }
}

/** Emit websocket/activity/notification after transactional scan insert commits. */
export async function emitQrScanSideEffects(input: RecordQrScanEventInput, scanId: string): Promise<void> {
  const row = await prisma.qrScanEvent.findUnique({
    where: { id: scanId },
    select: {
      id: true,
      scanType: true,
      scannedAt: true,
      deviceType: true,
      employeeId: true,
      locationId: true,
      tableId: true,
      qrSlug: true,
      sessionId: true,
    },
  });
  if (!row) return;
  emitSideEffects(row, input, row.sessionId);
}

/**
 * @deprecated Phase 3 — use startGuestVisitAndRecordScan via POST /api/qr/scan only.
 */
export function recordQrScanEvent(input: RecordQrScanEventInput): void {
  void (async () => {
    const { startGuestVisitAndRecordScan } = await import("./qrGuestVisit.service.js");
    const result = await startGuestVisitAndRecordScan(input);
    if (result.inserted && result.scanId) {
      await emitQrScanSideEffects(input, result.scanId);
    }
  })().catch((err) => {
    logServerError("recordQrScanEvent", err);
  });
}
