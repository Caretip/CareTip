/**
 * Primary walkthrough / demo login emails from `db:seed`.
 * Exact-match only — never treat all @caretip.de addresses as demos.
 */

const PROTECTED_WALKTHROUGH_DEMO_EMAILS = new Set(
  ["demo@caretip.de", "employee@caretip.de", "admin@caretip.de"].map((e) => e.toLowerCase()),
);

/** Same convention as {@link normalizeLoginEmail} in auth.service (trim + lower). */
export function normalizeWalkthroughEmail(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase();
}

/**
 * True when the CareTip account email is one of the three primary walkthrough logins.
 * Used to forbid OAuth provider linking onto shared demo accounts.
 */
export function isWalkthroughDemoAccount(email: string | null | undefined): boolean {
  const normalized = normalizeWalkthroughEmail(email);
  if (!normalized) return false;
  return PROTECTED_WALKTHROUGH_DEMO_EMAILS.has(normalized);
}
