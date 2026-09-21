/**
 * Cross-tab coordination for POST /api/auth/refresh.
 *
 * Primary mutex: Web Locks API (`caretip-auth-refresh-v1`) when available.
 * Fallback: hardened localStorage lock + BroadcastChannel/storage completion signaling.
 *
 * The mutex protects only the refresh-token rotation critical section (runner callback),
 * not entire bootstrap or unrelated API calls.
 *
 * Degraded mode (localStorage unavailable): per-tab refreshSingleton still applies, but
 * cross-tab serialization is best-effort only — tabs may POST concurrently.
 */

import { authDebug } from "./authDebugLog";

/** Reserved exclusively for refresh-token rotation coordination — do not reuse for other features. */
export const WEB_LOCK_NAME = "caretip-auth-refresh-v1";
const REFRESH_CHANNEL_NAME = WEB_LOCK_NAME;
const LOCK_STORAGE_KEY = "caretip_auth_refresh_lock";
const DONE_STORAGE_KEY = "caretip_auth_refresh_done";

/** Aligns with {@link BOOTSTRAP_REFRESH_TIMEOUT_MS} in useAuthInitializer. */
export const REFRESH_COORD_TIMEOUT_MS = 12_000;

/** Peer completion signal window for hasRecentPeerRefreshSuccess. */
const DONE_SIGNAL_TTL_MS = 4_000;

/** localStorage fallback: treat abandoned locks as stale after this (crashed tab recovery). */
const STALE_LOCK_MS = 120_000;

/** localStorage fallback: max time to wait in queue before degraded uncoordinated refresh. */
const FALLBACK_QUEUE_MAX_MS = REFRESH_COORD_TIMEOUT_MS + 5_000;

type RefreshLockPayload = { tabId: string; at: number };
type RefreshDonePayload = { tabId: string; at: number; ok: boolean; status: number };
type LockMechanism = "web-locks" | "localStorage-fallback" | "degraded";

let tabId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Thrown when refresh exceeds REFRESH_COORD_TIMEOUT_MS inside the coordination critical section. */
export class RefreshCoordinationTimeoutError extends Error {
  readonly name = "RefreshCoordinationTimeoutError";
  constructor() {
    super("Auth refresh coordination timed out");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRefreshLikeResult(value: unknown): value is { ok: boolean; status?: number } {
  return Boolean(value && typeof value === "object" && "ok" in value && typeof (value as { ok: unknown }).ok === "boolean");
}

function publishFromRunnerResult(result: unknown): void {
  if (isRefreshLikeResult(result)) {
    publishRefreshDone(result.ok, result.ok ? 200 : result.status ?? 0);
  } else {
    publishRefreshDone(true, 200);
  }
}

let testLocalStorageBroken = false;
let webLocksOverride: typeof navigator.locks | null | undefined;

export function isWebLocksAvailable(): boolean {
  if (webLocksOverride !== undefined) {
    return webLocksOverride !== null && typeof webLocksOverride.request === "function";
  }
  try {
    return typeof navigator !== "undefined" && typeof navigator.locks?.request === "function";
  } catch {
    return false;
  }
}

function resolveWebLocks(): typeof navigator.locks | null {
  if (webLocksOverride !== undefined) {
    return webLocksOverride;
  }
  if (isWebLocksAvailable()) {
    return navigator.locks;
  }
  return null;
}

function canUseLocalStorage(): boolean {
  if (testLocalStorageBroken) return false;
  try {
    const probe = "__caretip_ls_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function readLock(): RefreshLockPayload | null {
  try {
    const raw = localStorage.getItem(LOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RefreshLockPayload;
    if (typeof parsed.tabId !== "string" || typeof parsed.at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function readDone(): RefreshDonePayload | null {
  try {
    const raw = localStorage.getItem(DONE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RefreshDonePayload;
    if (typeof parsed.at !== "number" || typeof parsed.ok !== "boolean") return null;
    return parsed;
  } catch {
    return null;
  }
}

function isLockStale(lock: RefreshLockPayload | null): boolean {
  if (!lock) return true;
  return Date.now() - lock.at >= STALE_LOCK_MS;
}

function tryAcquireRefreshLock(): boolean {
  const now = Date.now();
  if (!canUseLocalStorage()) return false;
  try {
    const existing = readLock();
    if (existing && existing.tabId !== tabId && !isLockStale(existing)) {
      return false;
    }
    localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify({ tabId, at: now } satisfies RefreshLockPayload));
    return true;
  } catch {
    return false;
  }
}

function releaseRefreshLock(): void {
  try {
    const existing = readLock();
    if (existing?.tabId === tabId) {
      localStorage.removeItem(LOCK_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function publishRefreshDone(ok: boolean, status: number): void {
  const payload: RefreshDonePayload = { tabId, at: Date.now(), ok, status };
  try {
    localStorage.setItem(DONE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const bc = new BroadcastChannel(REFRESH_CHANNEL_NAME);
      bc.postMessage(payload);
      bc.close();
    } catch {
      // ignore
    }
  }
}

async function waitForPeerRefreshDone(maxWaitMs: number): Promise<RefreshDonePayload | null> {
  const start = Date.now();

  return new Promise((resolve) => {
    let bc: BroadcastChannel | null = null;
    let settled = false;

    const finish = (payload: RefreshDonePayload | null) => {
      if (settled) return;
      settled = true;
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("storage", onStorage);
      }
      bc?.close();
      resolve(payload);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== DONE_STORAGE_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as RefreshDonePayload;
        if (parsed.tabId !== tabId) finish(parsed);
      } catch {
        // ignore
      }
    };

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("storage", onStorage);
    }

    if (typeof BroadcastChannel !== "undefined") {
      try {
        bc = new BroadcastChannel(REFRESH_CHANNEL_NAME);
        bc.onmessage = (event: MessageEvent) => {
          const data = event.data as RefreshDonePayload;
          if (data?.tabId && data.tabId !== tabId) finish(data);
        };
      } catch {
        bc = null;
      }
    }

    const poll = () => {
      if (settled) return;
      const done = readDone();
      if (done && done.tabId !== tabId && Date.now() - done.at < DONE_SIGNAL_TTL_MS) {
        finish(done);
        return;
      }
      if (Date.now() - start >= maxWaitMs) {
        finish(null);
        return;
      }
      window.setTimeout(poll, 80);
    };
    poll();
  });
}

async function withRefreshCoordTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new RefreshCoordinationTimeoutError()), ms);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function executeRefreshCriticalSection<T>(
  runner: () => Promise<T>,
  mechanism: LockMechanism,
  attemptId: string,
): Promise<T> {
  const startedAt = Date.now();
  authDebug("refresh_coord.critical.start", { tabId, attemptId, mechanism });

  try {
    const result = await withRefreshCoordTimeout(runner, REFRESH_COORD_TIMEOUT_MS);
    publishFromRunnerResult(result);
    authDebug("refresh_coord.critical.done", {
      tabId,
      attemptId,
      mechanism,
      durationMs: Date.now() - startedAt,
      ok: isRefreshLikeResult(result) ? result.ok : true,
      status: isRefreshLikeResult(result) ? result.status ?? 0 : 200,
    });
    return result;
  } catch (err) {
    if (err instanceof RefreshCoordinationTimeoutError) {
      publishRefreshDone(false, 504);
      authDebug("refresh_coord.critical.timeout", {
        tabId,
        attemptId,
        mechanism,
        durationMs: Date.now() - startedAt,
      });
      throw err;
    }
    publishRefreshDone(false, 0);
    authDebug("refresh_coord.critical.error", {
      tabId,
      attemptId,
      mechanism,
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }
}

async function coordinateWithWebLocks<T>(runner: () => Promise<T>): Promise<T> {
  const attemptId =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  authDebug("refresh_coord.web_lock.queue", { tabId, attemptId });

  const locks = resolveWebLocks();
  if (!locks) {
    throw new Error("Web Locks unavailable despite availability check");
  }
  return locks.request(WEB_LOCK_NAME, async () => {
    authDebug("refresh_coord.web_lock.acquired", { tabId, attemptId });
    try {
      return await executeRefreshCriticalSection(runner, "web-locks", attemptId);
    } finally {
      authDebug("refresh_coord.web_lock.released", { tabId, attemptId });
    }
  });
}

async function coordinateWithLocalStorageFallback<T>(runner: () => Promise<T>): Promise<T> {
  const attemptId =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const waitStart = Date.now();
  authDebug("refresh_coord.fallback.queue", { tabId, attemptId });

  while (!tryAcquireRefreshLock()) {
    const peerDone = await waitForPeerRefreshDone(500);
    if (peerDone) {
      authDebug("refresh_coord.fallback.peer_signal", {
        tabId,
        attemptId,
        peerTabId: peerDone.tabId,
        peerOk: peerDone.ok,
      });
    }

    const existing = readLock();
    if (existing && isLockStale(existing)) {
      tryAcquireRefreshLock();
      break;
    }

    if (Date.now() - waitStart >= FALLBACK_QUEUE_MAX_MS) {
      authDebug("refresh_coord.fallback.degraded", {
        tabId,
        attemptId,
        reason: "queue_timeout",
      });
      return executeRefreshCriticalSection(runner, "degraded", attemptId);
    }

    await sleep(100);
  }

  authDebug("refresh_coord.fallback.acquired", { tabId, attemptId });
  try {
    return await executeRefreshCriticalSection(runner, "localStorage-fallback", attemptId);
  } finally {
    releaseRefreshLock();
  }
}

/**
 * Ensures at most one tab POSTs /api/auth/refresh at a time.
 * Followers still run their own refresh after acquiring the mutex — JWTs are never transferred between tabs.
 */
export async function coordinateCrossTabRefresh<T>(runner: () => Promise<T>): Promise<T> {
  if (isWebLocksAvailable()) {
    return coordinateWithWebLocks(runner);
  }

  if (!canUseLocalStorage()) {
    authDebug("refresh_coord.degraded", { tabId, reason: "localStorage_unavailable" });
    const attemptId = String(Date.now());
    return executeRefreshCriticalSection(runner, "degraded", attemptId);
  }

  return coordinateWithLocalStorageFallback(runner);
}

/** True when another tab refreshed successfully within the recent window. */
export function hasRecentPeerRefreshSuccess(withinMs = DONE_SIGNAL_TTL_MS): boolean {
  const done = readDone();
  return Boolean(done && done.ok && done.tabId !== tabId && Date.now() - done.at < withinMs);
}

/** True when a peer tab currently holds the localStorage fallback refresh lock. */
export function isRefreshBlockedByPeerLock(): boolean {
  if (isWebLocksAvailable()) {
    return false;
  }
  const existing = readLock();
  if (!existing) return false;
  return existing.tabId !== tabId && !isLockStale(existing);
}

/** Regression-test helpers — not used in production UI. */
export const authRefreshCoordinationTestHooks = {
  reset(): void {
    try {
      localStorage.removeItem(LOCK_STORAGE_KEY);
      localStorage.removeItem(DONE_STORAGE_KEY);
    } catch {
      // ignore
    }
  },
  setTabIdForTests(id: string): void {
    tabId = id;
  },
  getTabIdForTests(): string {
    return tabId;
  },
  setPeerLock(peerTabId: string, at = Date.now()): void {
    try {
      localStorage.setItem(
        LOCK_STORAGE_KEY,
        JSON.stringify({ tabId: peerTabId, at } satisfies RefreshLockPayload),
      );
    } catch {
      // ignore
    }
  },
  setPeerDone(peerTabId: string, ok: boolean, status: number, at = Date.now()): void {
    try {
      localStorage.setItem(
        DONE_STORAGE_KEY,
        JSON.stringify({ tabId: peerTabId, at, ok, status } satisfies RefreshDonePayload),
      );
    } catch {
      // ignore
    }
  },
  /** Simulate localStorage write failures — tryAcquire must not grant lock to every tab. */
  setLocalStorageBroken(broken: boolean): void {
    testLocalStorageBroken = broken;
  },
  setWebLocksOverride(override: typeof navigator.locks | null): void {
    webLocksOverride = override;
  },
  resetWebLocksOverride(): void {
    webLocksOverride = undefined;
  },
};

/** Regression-test helper — reports which mutex path coordinateCrossTabRefresh would use. */
export function getActiveCoordinationMechanism(): "web-locks" | "localStorage-fallback" {
  return resolveWebLocks() ? "web-locks" : "localStorage-fallback";
}
