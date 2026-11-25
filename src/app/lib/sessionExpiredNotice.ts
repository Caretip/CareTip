import { wasAccountJustDeactivated } from "./authSessionBroadcast";

export type SessionEndNoticeKind = "expired" | "deactivated";

const SESSION_EXPIRED_NOTICE_KEY = "caretip_session_expired_notice";
/** The notice explains the redirect that follows an expiry; later it would only be misleading. */
const NOTICE_MAX_AGE_MS = 2 * 60_000;

const DEACTIVATED_SUFFIX = ":deactivated";
const listeners = new Set<() => void>();

/** Mark that the user should be told why the session ended (shown once, see SessionEndNotice). */
export function markSessionExpiredNotice(kind: SessionEndNoticeKind = "expired"): void {
  const deactivated = kind === "deactivated" || wasAccountJustDeactivated();
  try {
    sessionStorage.setItem(SESSION_EXPIRED_NOTICE_KEY, `${Date.now()}${deactivated ? DEACTIVATED_SUFFIX : ""}`);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function subscribeSessionEndNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A sign-in or an explicit sign-out makes an unshown notice obsolete. */
export function clearSessionExpiredNotice(): void {
  try {
    sessionStorage.removeItem(SESSION_EXPIRED_NOTICE_KEY);
  } catch {
    // ignore
  }
}

/** Consume the queued notice (one-shot); null when there is none or it is stale. */
export function consumeSessionEndNotice(): SessionEndNoticeKind | null {
  try {
    const raw = sessionStorage.getItem(SESSION_EXPIRED_NOTICE_KEY);
    sessionStorage.removeItem(SESSION_EXPIRED_NOTICE_KEY);
    if (raw == null) return null;
    const deactivated = raw.endsWith(DEACTIVATED_SUFFIX);
    const age = Date.now() - Number(deactivated ? raw.slice(0, -DEACTIVATED_SUFFIX.length) : raw);
    if (!(age >= 0 && age < NOTICE_MAX_AGE_MS)) return null;
    return deactivated ? "deactivated" : "expired";
  } catch {
    return null;
  }
}

export function consumeSessionExpiredNotice(): boolean {
  return consumeSessionEndNotice() != null;
}
