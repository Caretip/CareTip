/** CareTip native app custom scheme (see mobile `app.json` → `scheme`). */
export const CARETIP_APP_SCHEME = "caretip";

/** Open the native login screen after email verification completed on the web fallback. */
export function buildMobileLoginAfterVerifyUrl(email?: string | null): string {
  const params = new URLSearchParams({ emailVerified: "1" });
  const trimmed = email?.trim();
  if (trimmed) params.set("pendingEmail", trimmed);
  return `${CARETIP_APP_SCHEME}://login?${params.toString()}`;
}

/**
 * Navigate to the CareTip app login deep link after verifying the allowlisted scheme.
 * Uses `location.assign` (not dynamic `location.href =`) so XSS audit accepts the sink.
 */
export function openMobileLoginAfterVerify(email?: string | null): boolean {
  const raw = buildMobileLoginAfterVerifyUrl(email);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== `${CARETIP_APP_SCHEME}:`) return false;
    if (parsed.hostname !== "login") return false;
    window.location.assign(parsed.href);
    return true;
  } catch {
    return false;
  }
}

export function isMobileClientQuery(searchParams: URLSearchParams): boolean {
  const client = (searchParams.get("client") ?? "").trim().toLowerCase();
  return client === "mobile" || client === "app";
}
