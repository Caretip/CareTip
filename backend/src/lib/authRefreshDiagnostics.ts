/**
 * Structured POST /api/auth/refresh outcomes for production forensics.
 * Never pass tokens, cookies, Authorization headers, emails or request bodies.
 */

export type RefreshOutcomeReason =
  | "ok"
  | "bearer_fallback_ok"
  | "missing_cookie"
  | "not_found"
  | "expired"
  | "revoked_logout"
  | "reuse_detected"
  | "rotation_conflict"
  | "db_error"
  | "account_unavailable"
  | "email_not_verified";

export type RefreshOutcomeEvent = {
  reason: RefreshOutcomeReason;
  status: number;
  /** Opaque user id (cuid) — no other personal data. */
  userId?: string;
  /** Refresh session row ids are not secrets (they are the access JWT `sid`). */
  sessionId?: string;
  recovered?: boolean;
  msSinceRotation?: number;
  revokedSessions?: number;
  committed?: boolean;
  errorCode?: string;
};

/** Short, non-sensitive identifier for a store failure (Prisma code or error class name). */
export function storeErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]{2,16}$/.test(code)) return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string" && /^[A-Za-z]{2,64}$/.test(name)) return name;
  }
  return "unknown";
}

export function logRefreshOutcome(event: RefreshOutcomeEvent): void {
  try {
    const line = JSON.stringify({ event: "auth.refresh", ...event });
    if (event.reason === "ok" || event.reason === "bearer_fallback_ok" || event.reason === "missing_cookie") {
      console.info(line);
    } else {
      console.warn(line);
    }
  } catch {
    // Diagnostics must never affect authentication.
  }
}
