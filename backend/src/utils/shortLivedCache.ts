const cache = new Map<string, { expiresAt: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

const SWEEP_INTERVAL_MS = 5 * 60_000;
const SWEEP_SIZE_THRESHOLD = 500;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function sweepExpiredCacheEntries(now = Date.now()): number {
  let removed = 0;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
      removed++;
    }
  }
  return removed;
}

function maybeSweepExpired(): void {
  if (cache.size >= SWEEP_SIZE_THRESHOLD) {
    sweepExpiredCacheEntries();
    return;
  }
  if (cache.size > 0 && Math.random() < 0.01) {
    sweepExpiredCacheEntries();
  }
}

/** Periodic TTL eviction so expired entries do not grow the Map unbounded. */
export function startShortLivedCacheMaintenance(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepExpiredCacheEntries(), SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

/** In-memory TTL cache with in-flight deduplication (per Node process). */
export function getCachedOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return Promise.resolve(hit.value as T);
  }
  if (hit) cache.delete(key);

  maybeSweepExpired();

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = loader()
    .then((value) => {
      cache.set(key, { expiresAt: Date.now() + ttlMs, value });
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/** Warm cache after a combined loader (e.g. meta+summary single SQL). */
export function primeCachedValue<T>(key: string, ttlMs: number, value: T): void {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

/** Read a fresh cache entry without loading (undefined on miss/expiry). */
export function getCachedIfFresh<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  if (hit) cache.delete(key);
  return undefined;
}

export type CacheInvalidation = { key?: string; prefix?: string };

/**
 * Each API instance has its own cache, so an invalidation must reach the others too, or they keep
 * serving the old value until it expires (up to 10 minutes for the dashboard context). Batched
 * per tick: one write handler can invalidate a dozen keys.
 */
let invalidationBroadcaster: ((ops: CacheInvalidation[]) => void) | null = null;
let pendingBroadcast: CacheInvalidation[] = [];
let broadcastScheduled = false;
const MAX_OPS_PER_BROADCAST = 200;

export function setCacheInvalidationBroadcaster(fn: ((ops: CacheInvalidation[]) => void) | null): void {
  invalidationBroadcaster = fn;
}

function queueBroadcast(op: CacheInvalidation): void {
  if (!invalidationBroadcaster) return;
  pendingBroadcast.push(op);
  if (broadcastScheduled) return;
  broadcastScheduled = true;
  setImmediate(() => {
    broadcastScheduled = false;
    const ops = pendingBroadcast;
    pendingBroadcast = [];
    const send = invalidationBroadcaster;
    if (!send) return;
    for (let i = 0; i < ops.length; i += MAX_OPS_PER_BROADCAST) {
      try {
        send(ops.slice(i, i + MAX_OPS_PER_BROADCAST));
      } catch {
        // Best effort: the entry still expires on its TTL.
      }
    }
  });
}

function invalidateLocalKey(key: string): void {
  cache.delete(key);
  inflight.delete(key);
}

function invalidateLocalPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

/** Apply invalidations received from another instance (never re-broadcast). */
export function applyRemoteCacheInvalidations(ops: unknown): number {
  if (!Array.isArray(ops)) return 0;
  let applied = 0;
  for (const op of ops.slice(0, MAX_OPS_PER_BROADCAST)) {
    if (!op || typeof op !== "object") continue;
    const { key, prefix } = op as CacheInvalidation;
    if (typeof key === "string" && key.length > 0 && key.length <= 300) {
      invalidateLocalKey(key);
      applied++;
    } else if (typeof prefix === "string" && prefix.length >= 8 && prefix.length <= 300) {
      // A short prefix ("b", "") would wipe most of the cache; real prefixes carry an id.
      invalidateLocalPrefix(prefix);
      applied++;
    }
  }
  return applied;
}

export function invalidateCacheKey(key: string): void {
  invalidateLocalKey(key);
  queueBroadcast({ key });
}

export function invalidateCacheKeyPrefix(prefix: string): void {
  invalidateLocalPrefix(prefix);
  queueBroadcast({ prefix });
}

export { sweepExpiredCacheEntries };
