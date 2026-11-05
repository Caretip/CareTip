type Bucket = {
  count: number;
  resetAtMs: number;
};

/** Process-local sliding windows — suitable for single-instance; use Redis for multi-node parity. */
const buckets = new Map<string, Bucket>();

/** Hard ceiling: attackers can mint unlimited distinct keys, and memory must not follow them. */
export const MAX_MEMORY_BUCKETS = 50_000;

function makeRoomForNewBucket(nowMs: number): void {
  if (buckets.size < MAX_MEMORY_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAtMs <= nowMs) buckets.delete(key);
  }
  // Still full of live buckets: drop the oldest entries (Map keeps insertion order).
  let excess = buckets.size - MAX_MEMORY_BUCKETS + 1;
  for (const key of buckets.keys()) {
    if (excess-- <= 0) break;
    buckets.delete(key);
  }
}

export function memoryBucketCount(): number {
  return buckets.size;
}

export type LayeredRateLimitResult = {
  allowed: boolean;
  count: number;
  resetAtMs: number;
};

export function checkAndIncrementLimit(params: {
  key: string;
  maxPerWindow: number;
  windowMs: number;
  nowMs?: number;
}): LayeredRateLimitResult {
  const nowMs = params.nowMs ?? Date.now();
  const k = params.key.trim();
  if (!k) {
    return { allowed: true, count: 0, resetAtMs: nowMs + params.windowMs };
  }

  const cur = buckets.get(k);
  if (!cur || cur.resetAtMs <= nowMs) {
    const next: Bucket = { count: 1, resetAtMs: nowMs + params.windowMs };
    if (!cur) makeRoomForNewBucket(nowMs);
    buckets.set(k, next);
    return { allowed: 1 <= params.maxPerWindow, count: 1, resetAtMs: next.resetAtMs };
  }

  cur.count += 1;

  return { allowed: cur.count <= params.maxPerWindow, count: cur.count, resetAtMs: cur.resetAtMs };
}

/** Read current bucket without incrementing (for lockout checks). */
export function peekLimit(params: {
  key: string;
  maxPerWindow: number;
  windowMs: number;
  nowMs?: number;
}): LayeredRateLimitResult {
  const nowMs = params.nowMs ?? Date.now();
  const k = params.key.trim();
  if (!k) {
    return { allowed: true, count: 0, resetAtMs: nowMs + params.windowMs };
  }
  const cur = buckets.get(k);
  if (!cur || cur.resetAtMs <= nowMs) {
    return { allowed: true, count: 0, resetAtMs: nowMs + params.windowMs };
  }
  return {
    allowed: cur.count < params.maxPerWindow,
    count: cur.count,
    resetAtMs: cur.resetAtMs,
  };
}

export type RateLimitLayer = {
  name: string;
  key: string;
  max: number;
  windowMs: number;
};

export function enforceRateLimitLayers(
  layers: RateLimitLayer[],
): { ok: true } | { ok: false; layer: string; resetAtMs: number } {
  for (const layer of layers) {
    if (!layer.key) continue;
    const result = checkAndIncrementLimit({
      key: layer.key,
      maxPerWindow: layer.max,
      windowMs: layer.windowMs,
    });
    if (!result.allowed) {
      return { ok: false, layer: layer.name, resetAtMs: result.resetAtMs };
    }
  }
  return { ok: true };
}
