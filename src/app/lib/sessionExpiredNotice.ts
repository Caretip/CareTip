const SESSION_EXPIRED_NOTICE_KEY = "caretip_session_expired_notice";
/** The notice explains the redirect that follows an expiry; later it would only be misleading. */
const NOTICE_MAX_AGE_MS = 2 * 60_000;

/** Mark that the next login view should explain a definitive session expiration. */
export function markSessionExpiredNotice(): void {
  try {
    sessionStorage.setItem(SESSION_EXPIRED_NOTICE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

/** A sign-in or an explicit sign-out makes an unshown notice obsolete. */
export function clearSessionExpiredNotice(): void {
  try {
    sessionStorage.removeItem(SESSION_EXPIRED_NOTICE_KEY);
  } catch {
    // ignore
  }
}

/** Consume the session-expired banner flag (one-shot). */
export function consumeSessionExpiredNotice(): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_EXPIRED_NOTICE_KEY);
    sessionStorage.removeItem(SESSION_EXPIRED_NOTICE_KEY);
    if (raw == null) return false;
    const age = Date.now() - Number(raw);
    return age >= 0 && age < NOTICE_MAX_AGE_MS;
  } catch {
    return false;
  }
}
