import type { LayeredRateLimitResult } from "./layeredRateLimit.js";
import { checkAndIncrementLimit as memoryCheckAndIncrement, peekLimit as memoryPeekLimit } from "./layeredRateLimit.js";
import { reportRedisState, setRedisImpactDescription } from "../lib/redisHealth.js";

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

let redisClient: RedisClient | null = null;
let redisReady = false;
let lastConnectAttemptMs = 0;
let connectInFlight: Promise<RedisClient | null> | null = null;
let testClientActive = false;
let closing = false;

/**
 * How a check behaves when it has to count in process memory (Redis absent or unreachable).
 * - "local": count per process (ordinary traffic; N instances allow up to N times the limit).
 * - "divided": count per process against limit / RATE_LIMIT_FALLBACK_INSTANCE_COUNT, so the
 *   whole fleet still allows no more than the configured limit. Used for auth and MFA.
 * failClosed (financial writes) takes precedence: those refuse instead of counting locally.
 */
export type RateLimitFallback = "local" | "divided";

const MAX_FALLBACK_INSTANCE_COUNT = 20;

/** Instances that may share traffic while Redis is down. Defaults to 1 (single instance). */
export function rateLimitFallbackInstanceCount(): number {
  const n = Number.parseInt(process.env.RATE_LIMIT_FALLBACK_INSTANCE_COUNT?.trim() ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_FALLBACK_INSTANCE_COUNT, n);
}

/** Per-process allowance under the divided fallback; never below one attempt. */
export function dividedFallbackMax(max: number): number {
  return Math.max(1, Math.floor(max / rateLimitFallbackInstanceCount()));
}

function fallbackMax(max: number, fallback: RateLimitFallback | undefined): number {
  return fallback === "divided" ? dividedFallbackMax(max) : max;
}

// Outage logs state what actually applies. With the default count of 1 nothing is divided, so on
// N instances every limit (auth included) is effectively N times the configured value.
setRedisImpactDescription("rateLimit", () => {
  const n = rateLimitFallbackInstanceCount();
  const auth =
    n > 1
      ? `auth/MFA limits divided by ${n} per instance`
      : "auth/MFA limits NOT divided (RATE_LIMIT_FALLBACK_INSTANCE_COUNT=1): with N instances they are N times the limit";
  return `rate limits are per instance; ${auth}; financial writes are refused`;
});

function redisConfigured(): boolean {
  return testClientActive || Boolean(process.env.REDIS_URL?.trim());
}

function markRedisUnavailable(err: unknown): void {
  if (testClientActive || closing) return;
  redisReady = false;
  redisClient = null;
  reportRedisState("rateLimit", "degraded", err);
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
    const own = client;
    client.on("end", () => {
      // ioredis will not reconnect with this retry strategy; allow the next call to rebuild it.
      if (redisClient !== own) return;
      markRedisUnavailable(new Error("connection closed"));
    });
    reportRedisState("rateLimit", "connecting");
    await client.connect();
    redisClient = client;
    redisReady = true;
    reportRedisState("rateLimit", "ready");
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
      reportRedisState("rateLimit", "not_configured");
      if (rateLimitFallbackInstanceCount() > 1) {
        console.error(
          "[rateLimit] REDIS_URL is not set while RATE_LIMIT_FALLBACK_INSTANCE_COUNT > 1: limits are per instance (auth and MFA divided)",
        );
      }
    }
    return null;
  }
  const now = Date.now();
  if (closing) return null;
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

/**
 * Connect at boot so state is known (and logged) before traffic; call again periodically so a
 * recovery is noticed even when no limited request arrives. Honors the reconnect cooldown.
 */
export async function warmRateLimitStore(): Promise<boolean> {
  if (testClientActive) return true;
  return (await getRedis()) != null;
}

/** Shutdown: release the connection without reporting an outage. */
export async function closeRateLimitStore(): Promise<void> {
  closing = true;
  const client = redisClient;
  redisClient = null;
  redisReady = false;
  if (client && !testClientActive) {
    await client.quit().catch(() => undefined);
  }
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
  fallback?: RateLimitFallback;
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

  const local = () =>
    memoryCheckAndIncrement({ ...params, maxPerWindow: fallbackMax(params.maxPerWindow, params.fallback) });

  const redis = await getRedis();
  if (!redis) {
    if (params.failClosed && redisConfigured()) return refuse();
    return local();
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
    return local();
  }
}

/** Peek without incrementing — used for MFA lockout checks. */
export async function peekLimitDistributed(params: {
  key: string;
  maxPerWindow: number;
  windowMs: number;
  nowMs?: number;
  fallback?: RateLimitFallback;
}): Promise<LayeredRateLimitResult> {
  const nowMs = params.nowMs ?? Date.now();
  const k = params.key.trim();
  if (!k) {
    return { allowed: true, count: 0, resetAtMs: nowMs + params.windowMs };
  }

  const local = () =>
    memoryPeekLimit({ ...params, maxPerWindow: fallbackMax(params.maxPerWindow, params.fallback) });

  const redis = await getRedis();
  if (!redis) {
    return local();
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
    return local();
  }
}

export async function enforceRateLimitLayersDistributed(
  layers: Array<{ name: string; key: string; max: number; windowMs: number }>,
  opts?: { failClosed?: boolean; fallback?: RateLimitFallback },
): Promise<{ ok: true } | { ok: false; layer: string; resetAtMs: number }> {
  for (const layer of layers) {
    if (!layer.key) continue;
    const result = await checkAndIncrementLimitDistributed({
      key: layer.key,
      maxPerWindow: layer.max,
      windowMs: layer.windowMs,
      failClosed: opts?.failClosed,
      fallback: opts?.fallback,
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
