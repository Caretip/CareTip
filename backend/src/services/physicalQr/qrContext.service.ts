import { prisma } from "../../prisma.js";
import {
  PHYSICAL_QR_SAMPLE_URL_FORBIDDEN,
  type PhysicalQrContextType,
} from "../../lib/physicalQr/types.js";
import {
  canonicalEmployeeLegacyUrl,
  canonicalEmployeeUrl,
  canonicalLocationUrl,
  canonicalStorefrontUrl,
  canonicalTableUrl,
} from "../../lib/physicalQr/publicUrl.js";
import { isPhysicalQrFreeOrderAvailable } from "./physicalQrPricing.service.js";

export class PhysicalQrContextError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type ResolvedPhysicalQrContext = {
  qrContextType: PhysicalQrContextType;
  qrSubjectId: string | null;
  qrTargetUrl: string;
  label: string;
  locationId: string | null;
  locationName: string | null;
};

function assertNotSampleUrl(url: string): void {
  if (url.trim() === PHYSICAL_QR_SAMPLE_URL_FORBIDDEN) {
    throw new PhysicalQrContextError(
      "FORBIDDEN_SAMPLE_URL",
      "Physical orders cannot encode the QR Studio sample URL.",
      400,
    );
  }
}

export async function listBusinessLocationsForPrint(businessId: string): Promise<
  Array<{ id: string; name: string }>
> {
  return prisma.location.findMany({
    where: { businessId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Stable primary venue: first location by name. Null when the business has no venue rows. */
export function derivePrimaryLocationId(locations: Array<{ id: string }>): string | null {
  return locations[0]?.id ?? null;
}

export async function resolvePhysicalQrContext(input: {
  businessId: string;
  qrContextType: unknown;
  qrSubjectId?: unknown;
  locations?: Array<{ id: string; name: string }>;
}): Promise<ResolvedPhysicalQrContext> {
  const type = String(input.qrContextType ?? "").trim() as PhysicalQrContextType;
  const subjectId =
    typeof input.qrSubjectId === "string" && input.qrSubjectId.trim()
      ? input.qrSubjectId.trim()
      : null;

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, slug: true, name: true, brandDisplayName: true },
  });
  if (!business) {
    throw new PhysicalQrContextError("BUSINESS_NOT_FOUND", "Business not found", 404);
  }

  const brand = business.brandDisplayName?.trim() || business.name;
  const locations = input.locations ?? (await listBusinessLocationsForPrint(input.businessId));
  const primaryId = derivePrimaryLocationId(locations);
  const primaryName = locations.find((l) => l.id === primaryId)?.name ?? brand;

  if (type === "storefront") {
    const url = canonicalStorefrontUrl(business.slug);
    assertNotSampleUrl(url);
    return {
      qrContextType: "storefront",
      qrSubjectId: null,
      qrTargetUrl: url,
      label: brand,
      locationId: primaryId,
      locationName: primaryName,
    };
  }

  if (type === "employee") {
    if (!subjectId) {
      throw new PhysicalQrContextError("QR_SUBJECT_REQUIRED", "Employee id is required");
    }
    const employee = await prisma.employee.findFirst({
      where: { id: subjectId, isDeleted: false },
      select: { id: true, name: true, slug: true, businessId: true, locationId: true, location: { select: { name: true } } },
    });
    if (!employee || employee.businessId !== input.businessId) {
      throw new PhysicalQrContextError(
        "CROSS_TENANT_QR",
        "That QR does not belong to this business.",
        403,
      );
    }
    const url =
      employee.slug && business.slug
        ? canonicalEmployeeUrl(business.slug, employee.slug)
        : canonicalEmployeeLegacyUrl(employee.id);
    assertNotSampleUrl(url);
    const locationId = employee.locationId || primaryId;
    return {
      qrContextType: "employee",
      qrSubjectId: employee.id,
      qrTargetUrl: url,
      label: employee.name,
      locationId,
      locationName: employee.location?.name ?? primaryName,
    };
  }

  if (type === "location") {
    if (!subjectId) {
      throw new PhysicalQrContextError("QR_SUBJECT_REQUIRED", "Location id is required");
    }
    const location = await prisma.location.findUnique({
      where: { id: subjectId },
      select: { id: true, name: true, businessId: true },
    });
    if (!location || location.businessId !== input.businessId) {
      throw new PhysicalQrContextError(
        "CROSS_TENANT_QR",
        "That QR does not belong to this business.",
        403,
      );
    }
    const url = canonicalLocationUrl(location.id);
    assertNotSampleUrl(url);
    return {
      qrContextType: "location",
      qrSubjectId: location.id,
      qrTargetUrl: url,
      label: location.name,
      locationId: location.id,
      locationName: location.name,
    };
  }

  if (type === "table") {
    if (!subjectId) {
      throw new PhysicalQrContextError("QR_SUBJECT_REQUIRED", "Table id is required");
    }
    const table = await prisma.table.findUnique({
      where: { id: subjectId },
      select: {
        id: true,
        name: true,
        locationId: true,
        location: { select: { businessId: true, name: true } },
      },
    });
    if (!table || table.location.businessId !== input.businessId) {
      throw new PhysicalQrContextError(
        "CROSS_TENANT_QR",
        "That QR does not belong to this business.",
        403,
      );
    }
    const url = canonicalTableUrl(table.id);
    assertNotSampleUrl(url);
    return {
      qrContextType: "table",
      qrSubjectId: table.id,
      qrTargetUrl: url,
      label: `${table.name} · ${table.location.name}`,
      locationId: table.locationId,
      locationName: table.location.name,
    };
  }

  throw new PhysicalQrContextError("INVALID_QR_CONTEXT", "Unsupported QR type");
}

export async function listPhysicalQrContextOptions(businessId: string) {
  const [business, employees, locations, tables, freeOrderAvailable] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, brandDisplayName: true, slug: true },
    }),
    prisma.employee.findMany({
      where: { businessId, isDeleted: false, isActive: true },
      select: { id: true, name: true, slug: true, locationId: true },
      orderBy: { name: "asc" },
    }),
    listBusinessLocationsForPrint(businessId),
    prisma.table.findMany({
      where: { location: { businessId } },
      select: { id: true, name: true, locationId: true, location: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    isPhysicalQrFreeOrderAvailable(businessId),
  ]);
  if (!business) {
    throw new PhysicalQrContextError("BUSINESS_NOT_FOUND", "Business not found", 404);
  }
  const primaryLocationId = derivePrimaryLocationId(locations);
  return {
    storefront: {
      id: business.id,
      label: business.brandDisplayName?.trim() || business.name,
      locationId: primaryLocationId,
    },
    employees: employees.map((e) => ({
      id: e.id,
      label: e.name,
      locationId: e.locationId || primaryLocationId,
    })),
    locations: locations.map((l) => ({
      id: l.id,
      label: l.name,
      locationId: l.id,
      isPrimary: l.id === primaryLocationId,
    })),
    tables: tables.map((t) => ({
      id: t.id,
      label: `${t.name} · ${t.location.name}`,
      locationId: t.locationId,
    })),
    primaryLocationId,
    freeOrderAvailable,
  };
}
