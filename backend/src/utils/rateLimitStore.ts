import type { LayeredRateLimitResult } from "./layeredRateLimit.js";
import { checkAndIncrementLimit as memoryCheckAndIncrement, peekLimit as memoryPeekLimit } from "./layeredRateLimit.js";

type RedisClient = {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  get(key: string): Promise<string | null>;
  pttl(key: string): Promise<number>;
  quit(): Promise<string>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
};

/**
 * Increment and expiry in one step, returning the count and remaining window.
 * A separate INCR then PEXPIRE could leave a key with no expiry if the second call failed, which
 * would block that key permanently. Any key found without an expiry is repaired here for the same
 * reason, so a lockout can never outlive its window.
 */
const INCREMENT_WITH_EXPIRY_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/** How long to wait before retrying a Redis connection that failed or dropped. */
const REDIS_RECONNECT_COOLDOWN_MS = 30_000;
/** Retry-After sent when a fail-closed check cannot reach shared storage. */
export const RATE_LIMIT_STORE_UNAVAILABLE_RETRY_MS = 30_000;
const DEGRADED_WARN_INTERVAL_MS = 60_000;

let redisClient: RedisClient | null = null;
let redisReady = false;
let lastConnectAttemptMs = 0;
let connectInFlight: Promise<RedisClient | null> | null = null;
let lastDegradedWarnMs = 0;
let testClientActive = false;

function redisConfigured(): boolean {
  return testClientActive || Boolean(process.env.REDIS_URL?.trim());
}

function markRedisUnavailable(err: unknown): void {
  if (testClientActive) return;
  redisReady = false;
  redisClient = null;
  const now = Date.now();
  if (now - lastDegradedWarnMs >= DEGRADED_WARN_INTERVAL_MS) {
    lastDegradedWarnMs = now;
    console.warn(
      "[rateLimit] Redis unavailable: limits are per process until it returns",
      err instanceof Error ? err.message : err,
    );
  }
}

async function connectRedis(url: string): Promise<RedisClient | null> {
  let client: (RedisClient & { connect(): Promise<void>; disconnect(): void }) | null = null;
  try {
    const RedisModule = await import("ioredis");
    const RedisCtor = RedisModule.default as unknown as new (
      url: string,
      opts?: Record<string, unknown>,
    ) => RedisClient & { connect(): Promise<void>; disconnect(): void };
    client = new RedisCtor(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    client.on("error", () => {
      // absorbed — avoids ioredis "Unhandled error event" when host is unreachable
    });
    client.on("end", () => {
      // ioredis will not reconnect with this retry strategy; allow the next call to rebuild it.
      redisReady = false;
      redisClient = null;
    });
    await client.connect();
    redisClient = client;
    redisReady = true;
    console.info("[rateLimit] Redis connected for distributed auth limits");
    return redisClient;
  } catch (err) {
    client?.disconnect();
    markRedisUnavailable(err);
    return null;
  }
}

async function getRedis(): Promise<RedisClient | null> {
  if (redisReady && redisClient) return redisClient;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    if (lastConnectAttemptMs === 0) {
      lastConnectAttemptMs = Date.now();
      console.info("[rateLimit] REDIS_URL not set — using in-memory buckets");
    }
    return null;
  }
  const now = Date.now();
  if (connectInFlight) return connectInFlight;
  if (lastConnectAttemptMs !== 0 && now - lastConnectAttemptMs < REDIS_RECONNECT_COOLDOWN_MS) {
    return null;
  }
  lastConnectAttemptMs = now;
  connectInFlight = connectRedis(url).finally(() => {
    connectInFlight = null;
  });
  return connectInFlight;
}

/** Test seam: run the limiter against a supplied client. Pass null to restore normal behaviour. */
export function setRateLimitRedisClientForTests(client: RedisClient | null): void {
  testClientActive = client != null;
  redisClient = client;
  redisReady = client != null;
}

/** True when shared storage is configured and currently reachable. */
export function isRateLimitStoreShared(): boolean {
  return redisReady && redisClient != null;
}

export type DistributedLimitResult = LayeredRateLimitResult & {
  /** Shared storage is configured but could not be reached for this check. */
  storeUnavailable?: boolean;
};

/**
 * Distributed fixed-window counter. Falls back to process memory when Redis is absent or fails.
 * Pass `failClosed` for operations that must not run on per-process counts: with shared storage
 * configured but unreachable, the check is refused rather than counted locally.
 */
export async function checkAndIncrementLimitDistributed(params: {
  key: string;
  maxPerWindow: number;
  windowMs: number;
  nowMs?: number;
  failClosed?: boolean;
}): Promise<DistributedLimitResult> {
  const nowMs = params.nowMs ?? Date.now();
  const k = params.key.trim();
  if (!k) {
    return { allowed: true, count: 0, resetAtMs: nowMs + params.windowMs };
  }

  const refuse = (): DistributedLimitResult => ({
    allowed: false,
    count: 0,
    resetAtMs: nowMs + RATE_LIMIT_STORE_UNAVAILABLE_RETRY_MS,
    storeUnavailable: true,
  });

  const redis = await getRedis();
  if (!redis) {
    if (params.failClosed && redisConfigured()) return refuse();
    return memoryCheckAndIncrement(params);
  }

  try {
    const raw = (await redis.eval(
      INCREMENT_WITH_EXPIRY_SCRIPT,
      1,
      k,
      String(params.windowMs),
    )) as [number | string, number | string];
    const count = Number(raw[0]);
    const ttlMs = Number(raw[1]);
    return {
      allowed: count <= params.maxPerWindow,
      count,
      resetAtMs: nowMs + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : params.windowMs),
    };
  } catch (err) {
    markRedisUnavailable(err);
    if (params.failClosed) return refuse();
    return memoryCheckAndIncrement(params);
  }
}

/** Peek without incrementing — used for MFA lockout checks. */
export async function peekLimitDistributed(params: {
  key: string;
  maxPerWindow: number;
  windowMs: number;
  nowMs?: number;
}): Promise<LayeredRateLimitResult> {
  const nowMs = params.nowMs ?? Date.now();
  const k = params.key.trim();
  if (!k) {
    return { allowed: true, count: 0, resetAtMs: nowMs + params.windowMs };
  }

  const redis = await getRedis();
  if (!redis) {
    return memoryPeekLimit(params);
  }

  try {
    const [raw, ttlMs] = await Promise.all([redis.get(k), redis.pttl(k)]);
    const count = raw ? Number.parseInt(raw, 10) : 0;
    return {
      allowed: count < params.maxPerWindow,
      count: Number.isFinite(count) ? count : 0,
      resetAtMs: nowMs + (ttlMs > 0 ? ttlMs : params.windowMs),
    };
  } catch (err) {
    markRedisUnavailable(err);
    return memoryPeekLimit(params);
  }
}

export async function enforceRateLimitLayersDistributed(
  layers: Array<{ name: string; key: string; max: number; windowMs: number }>,
  opts?: { failClosed?: boolean },
): Promise<{ ok: true } | { ok: false; layer: string; resetAtMs: number }> {
  for (const layer of layers) {
    if (!layer.key) continue;
    const result = await checkAndIncrementLimitDistributed({
      key: layer.key,
      maxPerWindow: layer.max,
      windowMs: layer.windowMs,
      failClosed: opts?.failClosed,
    });
    if (!result.allowed) {
      return {
        ok: false,
        layer: result.storeUnavailable ? "store_unavailable" : layer.name,
        resetAtMs: result.resetAtMs,
      };
    }
  }
  return { ok: true };
}
