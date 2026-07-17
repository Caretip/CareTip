/**
 * Canonical CareTip staff job title presets (stored on Employee.jobTitle).
 * Keep in sync with frontend `businessVenueOptions.ts` STANDARD_STAFF_ROLE_VALUES.
 */
export const STANDARD_STAFF_ROLE_VALUES = [
  "Waiter",
  "Waitress",
  "Server",
  "Bartender",
  "Barista",
  "Chef",
  "Host",
  "Manager",
  "Receptionist",
  "Housekeeper",
  "Cleaner",
  "Barber",
  "Stylist",
  "Nurse",
  "Doctor",
  "Caregiver",
  "Therapist",
  "Orderly",
  "Freelancer",
  "Driver",
  "Tour Guide",
  "Technician",
] as const;

const PRESET_SET = new Set<string>(STANDARD_STAFF_ROLE_VALUES);

export function isPresetStaffRole(role: string): boolean {
  return PRESET_SET.has(role.trim());
}
