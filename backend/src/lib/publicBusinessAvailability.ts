import type { Prisma } from "@prisma/client";

/**
 * SEC-04 — single rule for "may this business be shown to anonymous guests?".
 *
 * A business that is suspended / inactive (operationalStatus), soft-closed (deletedAt) or past the active
 * GDPR lifecycle stage (lifecycleStatus / tombstonedAt) must not expose its profile, staff names, photos,
 * locations or tables on public endpoints and must not accept tips. Public endpoints answer exactly as
 * they do for an unknown business ("not found"), so the status and any suspension reason never leak.
 *
 * Use as a Prisma `where` fragment so the filter is applied in the query:
 *   prisma.business.findFirst({ where: { slug, ...PUBLIC_BUSINESS_WHERE } })
 *   prisma.employee.findFirst({ where: { ..., business: { is: PUBLIC_BUSINESS_WHERE } } })
 *
 * Authenticated managers / employees / platform admins use their own (non-public) routes and are not
 * affected. Reactivating a business (operationalStatus back to `active`) restores public access.
 */
export const PUBLIC_BUSINESS_WHERE = {
  operationalStatus: "active",
  deletedAt: null,
  tombstonedAt: null,
  lifecycleStatus: "active",
} as const satisfies Prisma.BusinessWhereInput;

export const PUBLIC_BUSINESS_AVAILABILITY_SELECT = {
  operationalStatus: true,
  deletedAt: true,
  tombstonedAt: true,
  lifecycleStatus: true,
} as const satisfies Prisma.BusinessSelect;

export type PublicBusinessAvailabilityFields = {
  operationalStatus: string;
  deletedAt: Date | null;
  tombstonedAt: Date | null;
  lifecycleStatus: string;
};

/** In-memory form of PUBLIC_BUSINESS_WHERE for rows already loaded with PUBLIC_BUSINESS_AVAILABILITY_SELECT. */
export function isBusinessPubliclyAvailable(b: PublicBusinessAvailabilityFields | null | undefined): boolean {
  return (
    !!b &&
    b.operationalStatus === "active" &&
    b.deletedAt == null &&
    b.tombstonedAt == null &&
    b.lifecycleStatus === "active"
  );
}
