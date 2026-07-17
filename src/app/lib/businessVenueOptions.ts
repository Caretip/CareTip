import type { TFunction } from "i18next";
import { CARETIP_INDUSTRY_DEFINITIONS } from "../data/caretipIndustries";

/** Canonical business type values (stored on Business.businessType). */
export const BUSINESS_TYPE_OPTIONS = CARETIP_INDUSTRY_DEFINITIONS.filter((d) => d.showInOnboarding).map(
  (d) => ({
    value: d.storageValue,
    labelKey: d.onboardingLabelKey ?? d.labelKey,
  }),
);

export const BUSINESS_TYPE_I18N: Record<string, string> = Object.fromEntries(
  BUSINESS_TYPE_OPTIONS.map((opt) => [opt.value, opt.labelKey]),
);

/** Select value for a custom staff job title (stored as free text on Employee.jobTitle). */
export const STAFF_ROLE_OTHER_VALUE = "__other__";

/**
 * Standard CareTip job titles (Basic plan: select-only).
 * Keep value list in sync with backend `staffRolePresets.ts`.
 */
export const STANDARD_STAFF_ROLE_OPTIONS = [
  { value: "Waiter", labelKey: "business.staffPage.roleWaiter" },
  { value: "Waitress", labelKey: "business.staffPage.roleWaitress" },
  { value: "Server", labelKey: "business.staffPage.roleServer" },
  { value: "Bartender", labelKey: "business.staffPage.roleBartender" },
  { value: "Barista", labelKey: "business.staffPage.roleBarista" },
  { value: "Chef", labelKey: "business.staffPage.roleChef" },
  { value: "Host", labelKey: "business.staffPage.roleHost" },
  { value: "Manager", labelKey: "business.staffPage.roleManager" },
  { value: "Receptionist", labelKey: "business.staffPage.roleReceptionist" },
  { value: "Housekeeper", labelKey: "business.staffPage.roleHousekeeper" },
  { value: "Cleaner", labelKey: "business.staffPage.roleCleaner" },
  { value: "Barber", labelKey: "business.staffPage.roleBarber" },
  { value: "Stylist", labelKey: "business.staffPage.roleStylist" },
  { value: "Nurse", labelKey: "business.staffPage.roleNurse" },
  { value: "Doctor", labelKey: "business.staffPage.roleDoctor" },
  { value: "Caregiver", labelKey: "business.staffPage.roleCaregiver" },
  { value: "Therapist", labelKey: "business.staffPage.roleTherapist" },
  { value: "Orderly", labelKey: "business.staffPage.roleOrderly" },
  { value: "Freelancer", labelKey: "business.staffPage.roleFreelancer" },
  { value: "Driver", labelKey: "business.staffPage.roleDriver" },
  { value: "Tour Guide", labelKey: "business.staffPage.roleTourGuide" },
  { value: "Technician", labelKey: "business.staffPage.roleTechnician" },
] as const;

/** @deprecated Prefer STANDARD_STAFF_ROLE_OPTIONS + optional Other for Pro+. */
export const STAFF_ROLE_OPTIONS = [
  ...STANDARD_STAFF_ROLE_OPTIONS,
  { value: STAFF_ROLE_OTHER_VALUE, labelKey: "business.staffPage.roleOther" },
] as const;

const PRESET_ROLE_VALUES = new Set<string>(
  STANDARD_STAFF_ROLE_OPTIONS.map((opt) => opt.value),
);

export function isPresetStaffRole(role: string): boolean {
  return PRESET_ROLE_VALUES.has(role.trim());
}

/** Distinct non-preset job titles already used by the team (reusable on Pro+). */
export function collectCustomStaffRoles(storedRoles: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of storedRoles) {
    const trimmed = raw.trim();
    if (!trimmed || isPresetStaffRole(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function resolveStaffRoleForForm(
  storedRole: string,
  knownCustomRoles: readonly string[] = [],
): { role: string; customRole: string } {
  const trimmed = storedRole.trim();
  if (!trimmed) return { role: "Server", customRole: "" };
  if (isPresetStaffRole(trimmed)) return { role: trimmed, customRole: "" };
  if (knownCustomRoles.some((r) => r.trim().toLowerCase() === trimmed.toLowerCase())) {
    return { role: trimmed, customRole: "" };
  }
  return { role: STAFF_ROLE_OTHER_VALUE, customRole: trimmed };
}

export function resolveStaffRoleForSave(role: string, customRole: string): string {
  if (role === STAFF_ROLE_OTHER_VALUE) {
    return customRole.trim();
  }
  return role.trim();
}

export function formatStaffRoleLabel(role: string, t: TFunction): string {
  const trimmed = role.trim();
  if (!trimmed) return "";
  const preset = STANDARD_STAFF_ROLE_OPTIONS.find((opt) => opt.value === trimmed);
  if (preset) return t(preset.labelKey);
  if (trimmed === STAFF_ROLE_OTHER_VALUE) return t("business.staffPage.roleOther");
  return trimmed;
}
