/** CareTip native app custom scheme (see mobile `app.json` → `scheme`). */
export const CARETIP_APP_SCHEME = "caretip";

/** Open the native login screen after email verification completed on the web fallback. */
export function buildMobileLoginAfterVerifyUrl(email?: string | null): string {
  const params = new URLSearchParams({ emailVerified: "1" });
  const trimmed = email?.trim();
  if (trimmed) params.set("pendingEmail", trimmed);
  return `${CARETIP_APP_SCHEME}://login?${params.toString()}`;
}

export function isMobileClientQuery(searchParams: URLSearchParams): boolean {
  const client = (searchParams.get("client") ?? "").trim().toLowerCase();
  return client === "mobile" || client === "app";
}
