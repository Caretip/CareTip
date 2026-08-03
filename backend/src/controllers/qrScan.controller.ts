import type { Request, Response } from "express";
import { prisma } from "../prisma.js";
import { isOnboardingApprovedForPublicGoLive } from "../lib/verificationWorkflow.js";
import { clientSafeMessage, logServerError, CLIENT_FALLBACK } from "../utils/httpErrors.js";
import { MissingScanSessionError } from "../services/qr/qrScanRequestContext.js";
import { QR_SCAN_TYPES, type QrScanType } from "../services/qr/qrScanEvent.service.js";
import { startGuestVisitAndRecordScan } from "../services/qr/qrGuestVisit.service.js";
import { emitQrScanSideEffects } from "../services/qr/qrScanEvent.service.js";
import { QrScanOwnershipError } from "../services/qr/qrScanOwnership.service.js";

const VERIFICATION_REQUIRED_MSG = "QR code generation will be enabled after admin verification.";

const VALID_SCAN_TYPES = new Set<string>(Object.values(QR_SCAN_TYPES));

type RecordScanBody = {
  businessId?: string;
  scanType?: string;
  employeeId?: string | null;
  locationId?: string | null;
  tableId?: string | null;
  qrSlug?: string | null;
  entryPath?: string | null;
  notify?: {
    locationName?: string;
    tableName?: string;
  };
};

function optionalTrim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * POST /api/qr/scan — sole public entry point for durable QR scan analytics.
 * Context GET endpoints are read-only and must not create scan rows.
 */
export async function recordGuestScan(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as RecordScanBody;
    const businessId = optionalTrim(body.businessId);
    const scanTypeRaw = optionalTrim(body.scanType);

    if (!businessId) {
      res.status(400).json({ message: "businessId is required" });
      return;
    }
    if (!scanTypeRaw || !VALID_SCAN_TYPES.has(scanTypeRaw)) {
      res.status(400).json({ message: "Valid scanType is required" });
      return;
    }
    const scanType = scanTypeRaw as QrScanType;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, onboardingVerificationStatus: true },
    });
    if (!business) {
      res.status(404).json({ message: "Business not found" });
      return;
    }
    if (!isOnboardingApprovedForPublicGoLive(business.onboardingVerificationStatus)) {
      res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
      return;
    }

    const entryPath = optionalTrim(body.entryPath);
    if (entryPath) {
      req.originalUrl = entryPath.slice(0, 512);
    }

    const result = await startGuestVisitAndRecordScan({
      businessId,
      scanType,
      req,
      employeeId: optionalTrim(body.employeeId),
      locationId: optionalTrim(body.locationId),
      tableId: optionalTrim(body.tableId),
      qrSlug: optionalTrim(body.qrSlug),
      notify: body.notify,
    });

    if (result.inserted && result.scanId) {
      await emitQrScanSideEffects(
        {
          businessId,
          scanType,
          req,
          employeeId: optionalTrim(body.employeeId),
          locationId: optionalTrim(body.locationId),
          tableId: optionalTrim(body.tableId),
          qrSlug: optionalTrim(body.qrSlug),
          notify: body.notify,
        },
        result.scanId,
      );
    }

    res.status(result.inserted ? 201 : 200).json({
      inserted: result.inserted,
      scanId: result.scanId ?? null,
      visitId: result.visitId ?? null,
      visitStatus: result.visitStatus ?? null,
    });
  } catch (err) {
    if (err instanceof MissingScanSessionError) {
      res.status(400).json({ message: err.message });
      return;
    }
    if (err instanceof QrScanOwnershipError) {
      res.status(400).json({ message: err.message, code: err.code });
      return;
    }
    logServerError("qrScan.recordGuestScan", err);
    res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}
