import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import * as tablesService from "../services/tables.service.js";
import * as tippingContextService from "../services/tippingContext.service.js";
import { logServerError, clientSafeMessage, CLIENT_FALLBACK } from "../utils/httpErrors.js";
import { QR_SCAN_TYPES, recordQrScanEvent } from "../services/qr/qrScanEvent.service.js";

const VERIFICATION_REQUIRED_MSG = "QR code generation will be enabled after admin verification.";

/** GET /api/tipping-context/location/:locationId — public (venue QR). */
export async function getLocationById(req: Request, res: Response) {
  try {
    const { locationId } = req.params;
    if (!locationId?.trim()) {
      return res.status(400).json({ message: "locationId is required" });
    }
    const ctx = await tippingContextService.getPublicLocationContext(locationId.trim());
    if (!ctx) {
      return res.status(404).json({ message: "Location not found" });
    }
    if ("locked" in ctx) {
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }
    recordQrScanEvent({
      businessId: ctx.business.id,
      scanType: QR_SCAN_TYPES.LOCATION,
      locationId: ctx.location.id,
      req,
    });
    void import("../services/push/notificationContext.js").then(({ notifyQrScanForBusiness }) => {
      notifyQrScanForBusiness({
        businessId: ctx.business.id,
        locationName: ctx.location.name,
      });
    });
    return res.json(ctx);
  } catch (err) {
    logServerError("tippingContext.getLocationById", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

/** GET /api/tipping-context/table/:tableId — public (table QR by id). */
export async function getTableById(req: Request, res: Response) {
  try {
    const { tableId } = req.params;
    if (!tableId?.trim()) {
      return res.status(400).json({ message: "tableId is required" });
    }
    const ctx = await tippingContextService.getPublicTableContextById(tableId.trim());
    if (!ctx) {
      return res.status(404).json({ message: "Table not found" });
    }
    if ("locked" in ctx) {
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }
    recordQrScanEvent({
      businessId: ctx.business.id,
      scanType: QR_SCAN_TYPES.TABLE_ID,
      locationId: ctx.location.id,
      tableId: ctx.table.id,
      qrSlug: ctx.table.qrSlug,
      req,
    });
    void import("../services/push/notificationContext.js").then(({ notifyQrScanForBusiness }) => {
      notifyQrScanForBusiness({
        businessId: ctx.business.id,
        locationName: ctx.location.name,
        tableName: ctx.table.name,
        qrSlug: ctx.table.qrSlug,
      });
    });
    return res.json(ctx);
  } catch (err) {
    logServerError("tippingContext.getTableById", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}

export async function getByQrSlug(req: Request, res: Response) {
  try {
    const { qrSlug } = req.params;
    if (!qrSlug || typeof qrSlug !== "string") {
      return res.status(400).json({ message: "qrSlug is required" });
    }

    // QR slug enumeration resistance:
    // - Reject obviously invalid formats with the same response as locked/unverified QR.
    // - Support optional signed QR tokens (format: `st-${inner}.${hexSig}`) when `QR_TOKEN_SECRET` is configured.
    const raw = qrSlug.trim();
    let lookupQrSlug = raw;

    const secret = process.env.QR_TOKEN_SECRET?.trim();
    if (raw.startsWith("st-") && raw.includes(".")) {
      if (!secret) {
        return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
      }

      const payload = raw.slice(3); // remove `st-`
      const dotIdx = payload.indexOf(".");
      if (dotIdx <= 0) {
        return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
      }

      const inner = payload.slice(0, dotIdx);
      const sig = payload.slice(dotIdx + 1);

      if (!inner || !sig) {
        return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
      }

      const expectedHex = createHmac("sha256", secret).update(inner, "utf8").digest("hex");
      // Constant-time compare to reduce trivial timing differences.
      const expectedBuf = Buffer.from(expectedHex, "hex");
      const sigBuf = Buffer.from(sig, "hex");
      if (
        expectedBuf.length !== sigBuf.length ||
        !timingSafeEqual(expectedBuf, sigBuf)
      ) {
        return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
      }

      lookupQrSlug = inner;
    } else {
      // Generated slugs are alphanumeric with -/_ and within a small length window.
      if (!/^[a-zA-Z0-9_-]{3,128}$/.test(raw)) {
        return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
      }
    }

    const ctx = await tablesService.getTippingContextByQrSlug(lookupQrSlug);
    if (!ctx) {
      // Hide whether a slug exists (avoid 404-vs-403 oracle).
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }
    if ("locked" in ctx) {
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }
    recordQrScanEvent({
      businessId: ctx.businessId,
      scanType: QR_SCAN_TYPES.TABLE_SLUG,
      locationId: ctx.locationId,
      tableId: ctx.tableId,
      qrSlug,
      req,
    });
    void import("../services/push/notificationContext.js").then(({ notifyQrScanForBusiness }) => {
      notifyQrScanForBusiness({
        businessId: ctx.businessId,
        locationName: ctx.locationName,
        tableName: ctx.tableName,
        qrSlug,
      });
    });
    return res.json({
      locationName: ctx.locationName,
      tableName: ctx.tableName,
      businessId: ctx.businessId,
      locationId: ctx.locationId,
      tableId: ctx.tableId,
      businessName: ctx.businessName,
    });
  } catch (err) {
    logServerError("tippingContext.getByQrSlug", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.business),
    });
  }
}
