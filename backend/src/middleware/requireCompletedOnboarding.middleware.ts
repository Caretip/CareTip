import type { Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../prisma.js";
import { resolveRequestUserId } from "./auth.middleware.js";
import { managerHasCompletedOnboarding } from "../services/auth.service.js";

/**
 * Blocks business managers who have not finished the onboarding wizard from dashboard APIs.
 * Profile/onboarding routes stay open so the wizard can save progress.
 *
 * Platform onboarding *approval* (admin review) does not block dashboard access — it gates
 * go-live features (QR generation, public tipping) via `requireBusinessVerificationCapability`.
 */
export async function requireCompletedOnboarding(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.user?.impersonatedBy) {
    next();
    return;
  }

  const userId = resolveRequestUserId(req);
  if (!userId) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const role = req.authUser?.role ?? req.user?.role;
  if (role !== Role.MANAGER) {
    next();
    return;
  }

  let user = req.authUser?.id === userId ? req.authUser : null;
  if (!user) {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        authTokenVersion: true,
        isActive: true,
        accountStatus: true,
        role: true,
        emailVerified: true,
        isPlatformAdmin: true,
        hasCompletedOnboarding: true,
        onboardingCompletedAt: true,
      },
    });
    if (user) {
      req.authUser = user;
    }
  }

  if (!user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  if (!managerHasCompletedOnboarding(user)) {
    res.status(403).json({
      success: false,
      code: "ONBOARDING_INCOMPLETE",
      message: "Complete onboarding before accessing dashboard data.",
    });
    return;
  }

  next();
}
