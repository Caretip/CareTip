const SESSION_EXPIRED_NOTICE_KEY = "caretip_session_expired_notice";

/** Mark that the next login view should explain a definitive session expiration. */
export function markSessionExpiredNotice(): void {
  try {
    sessionStorage.setItem(SESSION_EXPIRED_NOTICE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

/** Consume the session-expired banner flag (one-shot). */
export function consumeSessionExpiredNotice(): boolean {
  try {
    const had = sessionStorage.getItem(SESSION_EXPIRED_NOTICE_KEY) != null;
    sessionStorage.removeItem(SESSION_EXPIRED_NOTICE_KEY);
    return had;
  } catch {
    return false;
  }
}
