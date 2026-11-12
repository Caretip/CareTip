import type { Request, Response } from "express";
import { prisma } from "../prisma.js";
import { PUBLIC_BUSINESS_WHERE } from "../lib/publicBusinessAvailability.js";
import { kycStatusToLegacyMirror } from "../lib/verificationWorkflow.js";
import { hasBusinessVerificationCapability } from "../config/businessVerificationCapabilities.js";
import { signPublicSocketRoomToken } from "../services/publicSocketToken.service.js";
import { logServerError, clientSafeMessage } from "../utils/httpErrors.js";

/**
 * GET /api/socket/public-room-token?businessId= | ?businessSlug=
 * Issues a short-lived signed token required to join public Socket.IO business rooms.
 */
export async function getPublicRoomToken(req: Request, res: Response) {
  try {
    const businessId =
      typeof req.query.businessId === "string" ? req.query.businessId.trim() : "";
    const businessSlug =
      typeof req.query.businessSlug === "string" ? req.query.businessSlug.trim().toLowerCase() : "";

    if (!businessId && !businessSlug) {
      return res.status(400).json({ message: "businessId or businessSlug is required" });
    }

    const business = businessId
      ? await prisma.business.findFirst({
          where: { id: businessId, ...PUBLIC_BUSINESS_WHERE },
          select: { id: true, kycVerificationStatus: true, onboardingVerificationStatus: true },
        })
      : await prisma.business.findFirst({
          where: { slug: businessSlug, ...PUBLIC_BUSINESS_WHERE },
          select: { id: true, kycVerificationStatus: true, onboardingVerificationStatus: true },
        });

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    if (
      !hasBusinessVerificationCapability(
        kycStatusToLegacyMirror(business.kycVerificationStatus),
        "activateTipping",
        {
          onboardingVerificationStatus: business.onboardingVerificationStatus,
        },
      )
    ) {
      return res.status(403).json({ message: "This business is not accepting tips yet." });
    }

    const issued = signPublicSocketRoomToken(business.id);
    return res.json({
      businessId: business.id,
      token: issued.token,
      expiresAt: issued.expiresAt,
    });
  } catch (err) {
    logServerError("socket.getPublicRoomToken", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't start a live connection. Please try again."),
    });
  }
}
