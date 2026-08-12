/**
 * Shared invite-code normalization — mirrors backend `normalizeInviteCode`
 * in employeeInvite.service.ts (trim, uppercase, strip spaces/hyphens).
 */
export function normalizeInviteCode(code: string): string {
  return String(code ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}
