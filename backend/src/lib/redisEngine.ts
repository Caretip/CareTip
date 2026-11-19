/**
 * Identify the server behind REDIS_URL from `INFO server`. Valkey reports `redis_version:7.2.4`
 * for client compatibility, so that field alone does not identify it: Valkey adds
 * `server_name:valkey` and `valkey_version:<x.y.z>`. Redis has neither.
 */
export type RedisEngine = { engine: "valkey" | "redis" | "unknown"; version: string | null; redisCompatVersion: string | null };

export function describeRedisEngine(info: string): RedisEngine {
  const field = (name: string) => info.match(new RegExp(`^${name}:([^\\r\\n]+)`, "m"))?.[1]?.trim() ?? null;
  const serverName = field("server_name")?.toLowerCase() ?? null;
  const valkeyVersion = field("valkey_version");
  const redisVersion = field("redis_version");
  if (serverName === "valkey" || valkeyVersion) {
    return { engine: "valkey", version: valkeyVersion, redisCompatVersion: redisVersion };
  }
  if (redisVersion) return { engine: "redis", version: redisVersion, redisCompatVersion: redisVersion };
  return { engine: "unknown", version: null, redisCompatVersion: null };
}

/** Lua with TIME before writes needs effect replication: Redis 5+ or any Valkey. */
export function engineSupportsLockoutScripts(e: RedisEngine): boolean {
  if (e.engine === "valkey") return true;
  const major = Number(e.version?.split(".")[0]);
  return e.engine === "redis" && Number.isFinite(major) && major >= 5;
}
