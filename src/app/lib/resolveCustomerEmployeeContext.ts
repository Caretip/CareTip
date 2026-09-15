import {
  getEmployeeById,
  getStaffByBusinessEmployeeSlug,
  getStaffBySlug,
} from "./api";

export type ResolvedCustomerEmployee = {
  businessId: string;
  employeeId: string;
  employeeName: string;
  employeeAvatar?: string;
  businessName: string;
  businessLogo: string | null;
  branding?: import("./businessBranding").PublicGuestBranding | null;
  locationId?: string | null;
  locationName?: string | null;
};

type ResolveOpts = {
  employeeId: string;
  returnSlug?: string | null;
  returnBusinessSlug?: string | null;
  returnEmployeeSlug?: string | null;
  fallbackTeamMemberLabel: string;
  fallbackVenueLabel: string;
};

/** Single staff/employee resolution for the guest tip journey (guard + hydration). */
export async function resolveCustomerEmployeeContext(
  opts: ResolveOpts,
): Promise<ResolvedCustomerEmployee> {
  const {
    employeeId,
    returnSlug,
    returnBusinessSlug,
    returnEmployeeSlug,
    fallbackTeamMemberLabel,
    fallbackVenueLabel,
  } = opts;

  if (returnBusinessSlug?.trim() && returnEmployeeSlug?.trim()) {
    const s = await getStaffByBusinessEmployeeSlug(
      returnBusinessSlug.trim(),
      returnEmployeeSlug.trim(),
    );
    return {
      businessId: s.businessId,
      employeeId: s.id,
      employeeName: s.name,
      employeeAvatar: s.avatar ?? undefined,
      businessName: s.businessName,
      businessLogo: s.businessLogo ?? null,
      branding: s.branding ?? null,
      locationId: s.locationId ?? null,
      locationName: s.locationName ?? null,
    };
  }

  if (returnSlug?.trim()) {
    const s = await getStaffBySlug(returnSlug.trim());
    return {
      businessId: s.businessId,
      employeeId: s.id,
      employeeName: s.name,
      employeeAvatar: s.avatar ?? undefined,
      businessName: s.businessName,
      businessLogo: s.businessLogo ?? null,
      branding: s.branding ?? null,
      locationId: s.locationId ?? null,
      locationName: s.locationName ?? null,
    };
  }

  const emp = await getEmployeeById(employeeId);
  return {
    businessId: emp.businessId,
    employeeId: emp.id,
    employeeName: emp.name ?? fallbackTeamMemberLabel,
    employeeAvatar: emp.avatar ?? undefined,
    businessName: String(emp.businessName ?? "").trim() || fallbackVenueLabel,
    businessLogo: emp.businessLogo ?? null,
    branding: emp.branding ?? null,
    locationId: emp.locationId ?? null,
    locationName: emp.locationName ?? null,
  };
}

export function isCustomerEmployeeContextReady(
  employeeId: string | null | undefined,
  ctx: {
    businessId: string | null;
    employeeId: string | null;
    employeeName: string | null;
  },
): boolean {
  if (!employeeId?.trim()) return false;
  return Boolean(
    ctx.businessId &&
      ctx.employeeId === employeeId &&
      ctx.employeeName?.trim(),
  );
}

let remembered: ResolvedCustomerEmployee | null = null;

/** Last public employee resolved on this tab — TipAmount must not refetch after QR. */
export function rememberGuestTipEmployee(emp: ResolvedCustomerEmployee): void {
  if (!emp.employeeId?.trim() || !emp.businessId?.trim()) return;
  remembered = emp;
}

export function peekGuestTipEmployee(employeeId: string | null | undefined): ResolvedCustomerEmployee | null {
  const id = employeeId?.trim();
  if (!id || !remembered || remembered.employeeId !== id) return null;
  return remembered;
}
