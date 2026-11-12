import { prisma } from "../prisma.js";
import { PUBLIC_BUSINESS_WHERE } from "../lib/publicBusinessAvailability.js";
import { absolutizePublicMediaPath } from "../utils/publicMediaUrl.js";
import { isOnboardingApprovedForPublicGoLive } from "../lib/verificationWorkflow.js";
import {
  toPublicGuestBrandingDto,
  type PublicGuestBrandingDto,
} from "./businessBranding.dto.js";

export type PublicTippingBusiness = {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
  branding: PublicGuestBrandingDto;
};

function mapPublicTippingBusiness(
  row: {
    id: string;
    name: string;
    slug: string;
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
  },
): PublicTippingBusiness {
  const branding = toPublicGuestBrandingDto(row);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: branding.logoPath,
    branding,
  };
}

const tippingBusinessSelect = {
  id: true,
  name: true,
  slug: true,
  logoPath: true,
  bannerImagePath: true,
  brandPrimaryColor: true,
  brandSecondaryColor: true,
  welcomeMessage: true,
  thankYouMessage: true,
  brandDisplayName: true,
  brandTagline: true,
  qrTemplate: true,
  qrBorderStyle: true,
  qrShape: true,
  qrAccentColor: true,
  qrBackgroundColor: true,
  subscriptionTier: true,
  onboardingVerificationStatus: true,
} as const;

export interface PublicTippingEmployee {
  id: string;
  name: string;
  slug: string | null;
  jobTitle: string;
  avatar: string | null;
}

export interface PublicLocationContext {
  business: PublicTippingBusiness;
  location: { id: string; name: string; description: string | null };
  employees: PublicTippingEmployee[];
}

export interface PublicTableContext {
  business: PublicTippingBusiness;
  location: { id: string; name: string };
  table: { id: string; name: string; qrSlug: string };
  employees: PublicTippingEmployee[];
}

export type PublicTippingContextResult<T> = T | { locked: true };

const publicEmployeeSelect = {
  id: true,
  name: true,
  slug: true,
  jobTitle: true,
  avatar: true,
} as const;

async function listActiveEmployeesForBusiness(businessId: string): Promise<PublicTippingEmployee[]> {
  return prisma.employee.findMany({
    where: {
      businessId,
      isActive: true,
      activationStatus: "active",
      user: { is: { emailVerified: true } },
    },
    orderBy: { name: "asc" },
    select: publicEmployeeSelect,
  });
}

/** When no one has location assignments yet, keep showing all active staff (legacy behavior). */
async function employeesForLocationQr(
  businessId: string,
  locationId: string
): Promise<PublicTippingEmployee[]> {
  const assigned = await prisma.employee.findMany({
    where: {
      businessId,
      isActive: true,
      activationStatus: "active",
      locationId,
      user: { is: { emailVerified: true } },
    },
    orderBy: { name: "asc" },
    select: publicEmployeeSelect,
  });
  if (assigned.length > 0) return assigned;
  const anyWithLocation = await prisma.employee.count({
    where: {
      businessId,
      locationId: { not: null },
      activationStatus: "active",
      isActive: true,
      user: { is: { emailVerified: true } },
    },
  });
  if (anyWithLocation === 0) return listActiveEmployeesForBusiness(businessId);
  return [];
}

/** When no one has table assignments yet, keep showing all active staff (legacy behavior). */
async function employeesForTableQr(businessId: string, tableId: string): Promise<PublicTippingEmployee[]> {
  const assigned = await prisma.employee.findMany({
    where: {
      businessId,
      isActive: true,
      activationStatus: "active",
      tableAssignments: { some: { tableId } },
      user: { is: { emailVerified: true } },
    },
    orderBy: { name: "asc" },
    select: publicEmployeeSelect,
  });
  if (assigned.length > 0) return assigned;
  const anyWithTable = await prisma.employee.count({
    where: {
      businessId,
      activationStatus: "active",
      isActive: true,
      tableAssignments: { some: {} },
      user: { is: { emailVerified: true } },
    },
  });
  if (anyWithTable === 0) return listActiveEmployeesForBusiness(businessId);
  return [];
}

/** Public guest flow: location QR — team list for that business at this venue. */
export async function getPublicLocationContext(
  locationId: string
): Promise<PublicTippingContextResult<PublicLocationContext> | null> {
  const loc = await prisma.location.findFirst({
    where: { id: locationId, business: { is: PUBLIC_BUSINESS_WHERE } },
    select: {
      id: true,
      name: true,
      description: true,
      businessId: true,
      business: { select: tippingBusinessSelect },
    },
  });
  if (!loc) return null;
  if (!isOnboardingApprovedForPublicGoLive(loc.business.onboardingVerificationStatus)) {
    return { locked: true };
  }

  const employees = await employeesForLocationQr(loc.businessId, loc.id);
  return {
    business: mapPublicTippingBusiness(loc.business),
    location: { id: loc.id, name: loc.name, description: loc.description },
    employees: employees.map((e) => ({
      ...e,
      avatar: absolutizePublicMediaPath(e.avatar),
    })),
  };
}

/** Public guest flow: table QR by primary key (parallel to slug-based /api/tipping-context/:qrSlug). */
export async function getPublicTableContextById(
  tableId: string
): Promise<PublicTippingContextResult<PublicTableContext> | null> {
  const table = await prisma.table.findFirst({
    where: { id: tableId, location: { is: { business: { is: PUBLIC_BUSINESS_WHERE } } } },
    select: {
      id: true,
      name: true,
      qrSlug: true,
      locationId: true,
      location: {
        select: {
          id: true,
          name: true,
          businessId: true,
          business: { select: tippingBusinessSelect },
        },
      },
    },
  });
  if (!table) return null;
  if (!isOnboardingApprovedForPublicGoLive(table.location.business.onboardingVerificationStatus)) {
    return { locked: true };
  }

  const employees = await employeesForTableQr(table.location.businessId, table.id);
  return {
    business: mapPublicTippingBusiness(table.location.business),
    location: { id: table.location.id, name: table.location.name },
    table: { id: table.id, name: table.name, qrSlug: table.qrSlug },
    employees: employees.map((e) => ({
      ...e,
      avatar: absolutizePublicMediaPath(e.avatar),
    })),
  };
}
