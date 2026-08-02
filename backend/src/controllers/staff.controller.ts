import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { isOnboardingApprovedForPublicGoLive } from "../lib/verificationWorkflow.js";
import { logServerError, clientSafeMessage, CLIENT_FALLBACK } from "../utils/httpErrors.js";
import { absolutizePublicMediaPath } from "../utils/publicMediaUrl.js";
import { toPublicGuestBrandingDto, BUSINESS_BRANDING_SELECT, type PublicGuestBrandingDto } from "../services/businessBranding.dto.js";

const VERIFICATION_REQUIRED_MSG = "QR code generation will be enabled after admin verification.";

/**
 * GET /api/staff/directory/business/:slug
 * Public: active employees for a business (team / directory QR).
 */
export async function listActiveEmployeesByBusinessSlug(req: Request, res: Response) {
  try {
    const raw = req.params.slug?.trim().toLowerCase();
    if (!raw) {
      return res.status(400).json({ message: "Slug is required" });
    }
    const business = await prisma.business.findFirst({
      where: { slug: raw },
      select: {
        ...BUSINESS_BRANDING_SELECT,
        slug: true,
        onboardingVerificationStatus: true,
        businessType: true,
        location: true,
      },
    });
    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }
    if (!isOnboardingApprovedForPublicGoLive(business.onboardingVerificationStatus)) {
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }
    const employees = await prisma.employee.findMany({
      where: {
        businessId: business.id,
        isDeleted: false,
        isActive: true,
        activationStatus: "active",
        user: { is: { emailVerified: true } },
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        jobTitle: true,
        avatar: true,
      },
    });
    return res.json({
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        logo: absolutizePublicMediaPath(business.logoPath ?? null),
        type: business.businessType ?? null,
        location: business.location ?? null,
        branding: toPublicGuestBrandingDto(business),
      },
      employees: employees.map((e) => ({
        ...e,
        avatar: absolutizePublicMediaPath(e.avatar),
      })),
    });
  } catch (err) {
    logServerError("staff.listActiveEmployeesByBusinessSlug", err);
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.staff),
    });
  }
}

type StaffBySlugRow = {
  id: string;
  name: string;
  slug: string | null;
  avatar: string | null;
  jobTitle: string;
  bio?: string | null;
  businessId: string;
  business: {
    id: string;
    name: string;
    slug: string;
    onboardingVerificationStatus?: import("@prisma/client").OnboardingVerificationStatus;
    logoPath: string | null;
    bannerImagePath: string | null;
    brandPrimaryColor: string | null;
    brandSecondaryColor: string | null;
    welcomeMessage: string | null;
    thankYouMessage: string | null;
    brandDisplayName: string | null;
    brandTagline: string | null;
    qrTemplate: string;
    qrBorderStyle: string;
    qrShape: string;
    qrAccentColor: string | null;
    qrBackgroundColor: string | null;
    subscriptionTier: import("@prisma/client").BusinessSubscriptionTier | null;
  };
};

async function findActiveStaffBySlug(trimmedSlug: string): Promise<StaffBySlugRow | null> {
  const full = {
    id: true,
    name: true,
    slug: true,
    avatar: true,
    jobTitle: true,
    bio: true,
    businessId: true,
    business: { select: { ...BUSINESS_BRANDING_SELECT, slug: true, onboardingVerificationStatus: true } },
  } as const;
  try {
    return prisma.employee.findFirst({
      where: {
        slug: trimmedSlug,
        isDeleted: false,
        isActive: true,
        activationStatus: "active",
        user: { is: { emailVerified: true } },
      },
      select: full,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2022") {
      return prisma.employee.findFirst({
        where: {
          slug: trimmedSlug,
          isDeleted: false,
          isActive: true,
          activationStatus: "active",
          user: { is: { emailVerified: true } },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          avatar: true,
          jobTitle: true,
          bio: true,
          businessId: true,
          business: { select: { ...BUSINESS_BRANDING_SELECT, slug: true, onboardingVerificationStatus: true } },
        },
      });
    }
    throw e;
  }
}

async function buildPublicStaffTipResponse(employee: StaffBySlugRow) {
  const branding = toPublicGuestBrandingDto(employee.business);
  return {
    id: employee.id,
    name: employee.name,
    slug: employee.slug,
    avatar: absolutizePublicMediaPath(employee.avatar),
    jobTitle: employee.jobTitle,
    bio: employee.bio ?? null,
    businessId: employee.businessId,
    businessName: employee.business.name,
    businessSlug: employee.business.slug,
    businessLogo: branding.logoPath,
    branding,
  };
}

/**
 * GET /api/staff/directory/business/:businessSlug/employee/:employeeSlug
 * Public: staff under a venue when URL segments match Postgres `Business.slug` + `Employee.slug`.
 */
export async function getStaffByBusinessAndEmployeeSlug(req: Request, res: Response) {
  try {
    const businessSlug = req.params.businessSlug?.trim().toLowerCase();
    const employeeSlug = req.params.employeeSlug?.trim().toLowerCase();
    if (!businessSlug || !employeeSlug) {
      return res.status(400).json({ message: "Business and employee slugs are required" });
    }
    const business = await prisma.business.findFirst({
      where: { slug: businessSlug },
      select: { id: true, onboardingVerificationStatus: true },
    });
    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }
    if (!isOnboardingApprovedForPublicGoLive(business.onboardingVerificationStatus)) {
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }

    const full = {
      id: true,
      name: true,
      slug: true,
      avatar: true,
      jobTitle: true,
      bio: true,
      businessId: true,
      business: { select: { ...BUSINESS_BRANDING_SELECT, slug: true, onboardingVerificationStatus: true } },
    } as const;

    const employee = await prisma.employee.findFirst({
      where: {
        businessId: business.id,
        slug: employeeSlug,
        isDeleted: false,
        isActive: true,
        activationStatus: "active",
        user: { is: { emailVerified: true } },
      },
      select: full,
    });
    if (!employee) {
      return res.status(404).json({ message: "Staff member not found" });
    }

    return res.json(await buildPublicStaffTipResponse(employee));
  } catch (err) {
    logServerError("staff.getStaffByBusinessAndEmployeeSlug", err);
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.staff),
    });
  }
}

/**
 * GET /api/staff/:slug
 * Public: Find employee by slug for direct tipping links (e.g. /staff/john-doe)
 */
export async function getStaffBySlug(req: Request, res: Response) {
  try {
    const { slug } = req.params;
    if (!slug?.trim()) {
      return res.status(400).json({ message: "Slug is required" });
    }
    const employee = await findActiveStaffBySlug(slug.trim());
    if (!employee) {
      return res.status(404).json({ message: "Staff member not found" });
    }
    if (
      employee.business.onboardingVerificationStatus &&
      !isOnboardingApprovedForPublicGoLive(employee.business.onboardingVerificationStatus)
    ) {
      return res.status(403).json({ message: VERIFICATION_REQUIRED_MSG });
    }

    return res.json(await buildPublicStaffTipResponse(employee));
  } catch (err) {
    logServerError("staff.getStaffBySlug", err);
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.staff),
    });
  }
}
