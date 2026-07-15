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
  buildScanDedupeKey,
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
};

export type PersistQrScanResult = { inserted: boolean; scanId?: string };

/**
 * Sprint 4.1 — atomic insert; inserted=false when deduped by UNIQUE(dedupe_key).
 */
export async function persistQrScanEvent(input: RecordQrScanEventInput): Promise<PersistQrScanResult> {
  const { req, businessId, scanType } = input;
  const sessionId = resolveScanSessionId(req);
  const userAgent = req.headers["user-agent"]?.slice(0, 512) ?? null;
  const deviceType = parseDeviceType(userAgent ?? undefined);
  const { country, city } = resolveGeoFromRequest(req);
  const dedupeKey = buildScanDedupeKey({
    businessId,
    scanType,
    sessionId,
    employeeId: input.employeeId,
    locationId: input.locationId,
    tableId: input.tableId,
    qrSlug: input.qrSlug,
  });

  try {
    const row = await prisma.qrScanEvent.create({
      data: {
        businessId,
        employeeId: input.employeeId ?? null,
        locationId: input.locationId ?? null,
        tableId: input.tableId ?? null,
        qrSlug: input.qrSlug?.slice(0, 128) ?? null,
        scanType,
        entryPath: resolveEntryPath(req),
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

    /** Activity Center projection — coexists with qr.scanned; UI migrates in Phase C. */
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

    return { inserted: true, scanId: row.id };
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      return { inserted: false };
    }
    throw err;
  }
}

/**
 * Sprint 4B — sole entry point for durable QR scan logging.
 * Notifications remain separate via notifyQrScanForBusiness.
 */
export function recordQrScanEvent(input: RecordQrScanEventInput): void {
  void persistQrScanEvent(input).catch((err) => {
    logServerError("recordQrScanEvent", err);
  });
}
