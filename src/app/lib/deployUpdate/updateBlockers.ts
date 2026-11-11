/**
 * Named critical operations that must not be interrupted by a deployment reload.
 * Blockers only gate the reload of the tab that registered them, and every blocker expires so an
 * abandoned flow can never pin a tab to an old release.
 */

export type UpdateBlockerInfo = { id: number; name: string; startedAt: number; expiresAt: number };

export const UPDATE_BLOCKER_DEFAULT_TTL_MS = 10 * 60_000;
export const UPDATE_BLOCKER_MAX_TTL_MS = 30 * 60_000;

type Listener = () => void;

let clock: () => number = () => Date.now();
let nextId = 1;
const active = new Map<number, UpdateBlockerInfo>();
const listeners = new Set<Listener>();
let onExpired: ((info: UpdateBlockerInfo) => void) | null = null;

function emit(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* listeners must not break blocker bookkeeping */
    }
  });
}

function pruneExpired(): void {
  const now = clock();
  let changed = false;
  for (const [id, info] of active) {
    if (info.expiresAt <= now) {
      active.delete(id);
      changed = true;
      onExpired?.(info);
    }
  }
  if (changed) emit();
}

/**
 * Register a critical operation. Returns an idempotent release function; call it in `finally`
 * (or use {@link withUpdateBlocker}) so error paths release too.
 */
export function acquireUpdateBlocker(name: string, options?: { ttlMs?: number }): () => void {
  const ttl = Math.min(
    Math.max(options?.ttlMs ?? UPDATE_BLOCKER_DEFAULT_TTL_MS, 1),
    UPDATE_BLOCKER_MAX_TTL_MS,
  );
  const id = nextId++;
  const startedAt = clock();
  active.set(id, { id, name, startedAt, expiresAt: startedAt + ttl });
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (active.delete(id)) emit();
  };
}

export async function withUpdateBlocker<T>(
  name: string,
  operation: () => Promise<T>,
  options?: { ttlMs?: number },
): Promise<T> {
  const release = acquireUpdateBlocker(name, options);
  try {
    return await operation();
  } finally {
    release();
  }
}

export function getActiveUpdateBlockers(): UpdateBlockerInfo[] {
  pruneExpired();
  return [...active.values()].map((info) => ({ ...info }));
}

export function hasActiveUpdateBlockers(): boolean {
  return getActiveUpdateBlockers().length > 0;
}

export function subscribeUpdateBlockers(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setUpdateBlockerExpiredHandler(handler: ((info: UpdateBlockerInfo) => void) | null): void {
  onExpired = handler;
}

/** Test-only reset. */
export function resetUpdateBlockersForTests(testClock?: () => number): void {
  active.clear();
  listeners.clear();
  onExpired = null;
  nextId = 1;
  clock = testClock ?? (() => Date.now());
}
