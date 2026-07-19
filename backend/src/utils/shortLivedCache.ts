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

export function invalidateCacheKey(key: string): void {
  cache.delete(key);
  inflight.delete(key);
}

export function invalidateCacheKeyPrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

export { sweepExpiredCacheEntries };
