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
    /Unable to preload CSS/i.test(message) ||
    /Loading chunk [\w.-]+ failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Unable to preload CSS/i.test(message)
  );
}

/**
 * Handles Vite's `vite:preloadError`. The event is never cancelled: cancelling makes the failed
 * dynamic import resolve to undefined and crash its caller. Left alone it stays a rejection for the
 * retry and "needs a refresh" paths to handle, and any recovery reload proceeds regardless.
 */
export function handleVitePreloadError(): void {
  recoverStaleChunkOnce();
}

/**
 * A route's code must arrive within this. A dynamic import has no browser timeout: one started on a
 * connection that died (device sleep, app switch, network change) can stay pending for minutes, and
 * React Router then never renders the page or its error screen — the boot loader stays up until its
 * failsafe drops it onto a blank page, recoverable only by leaving for an eagerly loaded page such as
 * the landing page. Kept below that failsafe so the route error screen (with Try again) shows instead.
 */
export const ROUTE_MODULE_LOAD_DEADLINE_MS = 15_000;

const ROUTE_MODULE_TIMEOUT_NAME = "RouteModuleTimeoutError";

export class RouteModuleTimeoutError extends Error {
  constructor() {
    super("Route module did not arrive in time");
    this.name = ROUTE_MODULE_TIMEOUT_NAME;
  }
}

export function isRouteModuleTimeout(error: unknown): boolean {
  return (
    error != null &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === ROUTE_MODULE_TIMEOUT_NAME
  );
}

function withRouteModuleDeadline<T>(load: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RouteModuleTimeoutError()), ROUTE_MODULE_LOAD_DEADLINE_MS);
  });
  return Promise.race([load, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Retry the same factory once after a chunk failure. Does not reload the document.
 * A timeout is not retried here: the browser would hand back the same pending request. It surfaces as
 * {@link RouteModuleTimeoutError} for the route error screen, whose Try again starts fresh connections.
 */
export async function loadRouteModuleWithRetry<T>(factory: () => Promise<T>): Promise<T> {
  try {
    return await withRouteModuleDeadline(factory());
  } catch (error) {
    if (!isChunkLoadFailure(error)) throw error;
    return await withRouteModuleDeadline(factory());
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
