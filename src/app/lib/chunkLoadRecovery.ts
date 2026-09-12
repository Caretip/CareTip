/**
 * Stale hashed chunks after a deploy (old index.html / SW precache vs new assets)
 * surface as dynamic-import failures and an empty Outlet — not as a React render error.
 */

const RECOVERY_AT_KEY = "caretip-chunk-recovery-at";
/** One reload per tab within this window — never loop. */
const RECOVERY_COOLDOWN_MS = 30_000;

export function isChunkLoadFailure(error: unknown): boolean {
  if (error == null) return false;
  const record = typeof error === "object" ? (error as { name?: unknown; message?: unknown }) : null;
  const name = record && record.name != null ? String(record.name) : "";
  const message =
    error instanceof Error
      ? error.message
      : record && record.message != null
        ? String(record.message)
        : String(error);
  return (
    name === "ChunkLoadError" ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Loading chunk [\w.-]+ failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message)
  );
}

/** Retry the same factory once. Does not reload the document. */
export async function loadRouteModuleWithRetry<T>(factory: () => Promise<T>): Promise<T> {
  try {
    return await factory();
  } catch (error) {
    if (!isChunkLoadFailure(error)) throw error;
    return await factory();
  }
}

/**
 * Bounded document reload after a proven missing-chunk failure.
 * Returns false when cooldown is active so ErrorBoundary can show recovery UI instead.
 */
export function recoverStaleChunkOnce(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const prev = Number(sessionStorage.getItem(RECOVERY_AT_KEY) || "0");
    if (Number.isFinite(prev) && prev > 0 && Date.now() - prev < RECOVERY_COOLDOWN_MS) {
      return false;
    }
    sessionStorage.setItem(RECOVERY_AT_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
