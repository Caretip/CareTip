import { prisma } from "../../prisma.js";

export const QR_SCAN_OWNERSHIP_MISMATCH_CODE = "QR_SCAN_OWNERSHIP_MISMATCH" as const;

/** Typed domain error — mapped to HTTP 400 by qrScan.controller. */
export class QrScanOwnershipError extends Error {
  readonly code = QR_SCAN_OWNERSHIP_MISMATCH_CODE;

  constructor(message = "QR scan targets do not belong to this business") {
    super(message);
    this.name = "QrScanOwnershipError";
  }
}

export type QrScanOwnershipTargets = {
  businessId: string;
  employeeId?: string | null;
  locationId?: string | null;
  tableId?: string | null;
};

/**
 * Phase 1 — assert optional child IDs belong to businessId before any visit/scan write.
 * Null/omitted child IDs are allowed (business-only scans).
 */
export async function assertQrScanTargetsBelongToBusiness(
  targets: QrScanOwnershipTargets,
): Promise<void> {
  const businessId = targets.businessId.trim();
  if (!businessId) {
    throw new QrScanOwnershipError("businessId is required for ownership validation");
  }

  const employeeId =
    typeof targets.employeeId === "string" && targets.employeeId.trim()
      ? targets.employeeId.trim()
      : null;
  const locationId =
    typeof targets.locationId === "string" && targets.locationId.trim()
      ? targets.locationId.trim()
      : null;
  const tableId =
    typeof targets.tableId === "string" && targets.tableId.trim()
      ? targets.tableId.trim()
      : null;

  if (!employeeId && !locationId && !tableId) {
    return;
  }

  const [employee, location, table] = await Promise.all([
    employeeId
      ? prisma.employee.findUnique({
          where: { id: employeeId },
          select: { id: true, businessId: true, isDeleted: true, isActive: true },
        })
      : Promise.resolve(null),
    locationId
      ? prisma.location.findUnique({
          where: { id: locationId },
          select: { id: true, businessId: true },
        })
      : Promise.resolve(null),
    tableId
      ? prisma.table.findUnique({
          where: { id: tableId },
          select: { id: true, locationId: true, location: { select: { businessId: true } } },
        })
      : Promise.resolve(null),
  ]);

  if (employeeId) {
    if (!employee) {
      throw new QrScanOwnershipError("employeeId does not belong to this business");
    }
    if (employee.businessId !== businessId) {
      throw new QrScanOwnershipError("employeeId does not belong to this business");
    }
    if (employee.isDeleted) {
      throw new QrScanOwnershipError("employeeId does not belong to this business");
    }
    if (!employee.isActive) {
      throw new QrScanOwnershipError("employeeId does not belong to this business");
    }
  }

  if (locationId) {
    if (!location || location.businessId !== businessId) {
      throw new QrScanOwnershipError("locationId does not belong to this business");
    }
  }

  if (tableId) {
    if (!table || table.location.businessId !== businessId) {
      throw new QrScanOwnershipError("tableId does not belong to this business");
    }
    if (locationId && table.locationId !== locationId) {
      throw new QrScanOwnershipError("tableId does not belong to the provided locationId");
    }
  }
}
