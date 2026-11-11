import { captureServerException } from "../instrument/sentry.js";

/**
 * Redis is optional for one instance and required for several to behave as one. Each component
 * reports state here; alerts fire on transitions only (plus a reminder while an outage persists),
 * so a flapping or dead Redis cannot flood logs or Sentry.
 */
export type RedisComponent = "rateLimit" | "socketAdapter";
export type RedisComponentState = "not_configured" | "disabled" | "connecting" | "ready" | "degraded";

type ComponentHealth = {
  state: RedisComponentState;
  since: number;
  lastError: string | null;
  lastPersistentAlertAt: number;
};

/** First reminder after this long degraded, then one per interval until it recovers. */
export const REDIS_PERSISTENT_OUTAGE_ALERT_MS = 5 * 60_000;
export const REDIS_PERSISTENT_OUTAGE_REPEAT_MS = 60 * 60_000;

const components = new Map<RedisComponent, ComponentHealth>();

const LABEL: Record<RedisComponent, string> = {
  rateLimit: "rate_limit_store",
  socketAdapter: "socket_adapter",
};

const DEFAULT_IMPACT: Record<RedisComponent, string> = {
  rateLimit: "rate limits are per instance; financial writes are refused",
  socketAdapter: "live events reach only sockets connected to this instance",
};
const impactProviders = new Map<RedisComponent, () => string>();

/** Lets a component describe its own outage impact from its current configuration. */
export function setRedisImpactDescription(component: RedisComponent, describe: () => string): void {
  impactProviders.set(component, describe);
}

function impact(component: RedisComponent): string {
  try {
    return impactProviders.get(component)?.() ?? DEFAULT_IMPACT[component];
  } catch {
    return DEFAULT_IMPACT[component];
  }
}

/** Connection errors can embed the URL, and with it the password. Keep only what helps triage. */
export function sanitizeRedisError(err: unknown): string {
  const raw =
    err instanceof Error
      ? `${(err as { code?: unknown }).code ? `${String((err as { code?: unknown }).code)}: ` : ""}${err.message}`
      : String(err ?? "unknown");
  return raw
    .replace(/rediss?:\/\/\S+/gi, "redis://[redacted]")
    .replace(/(password|pass|auth)[=:]\S+/gi, "$1=[redacted]")
    .slice(0, 200);
}

function instanceLabel(): string {
  return process.env.RENDER_INSTANCE_ID?.trim() || "local";
}

function get(component: RedisComponent): ComponentHealth {
  let h = components.get(component);
  if (!h) {
    h = { state: "not_configured", since: Date.now(), lastError: null, lastPersistentAlertAt: 0 };
    components.set(component, h);
  }
  return h;
}

/** Record a state. Logs and alerts only when the state actually changes. */
export function reportRedisState(component: RedisComponent, next: RedisComponentState, err?: unknown): void {
  const h = get(component);
  const now = Date.now();
  if (err !== undefined) h.lastError = sanitizeRedisError(err);
  if (h.state === next) return;
  // A reconnect attempt is not a recovery: stay degraded (and keep the outage start) until ready.
  if (next === "connecting" && h.state === "degraded") return;

  const prev = h.state;
  const downForMs = now - h.since;
  h.state = next;
  h.since = now;
  h.lastPersistentAlertAt = 0;
  const label = LABEL[component];

  if (next === "degraded") {
    console.error(
      `[redis] ${label} DEGRADED instance=${instanceLabel()} from=${prev} — ${impact(component)}`,
      ...(h.lastError ? [{ error: h.lastError }] : []),
    );
    captureServerException(new Error(`Redis ${label} degraded`), {
      component,
      previousState: prev,
      instance: instanceLabel(),
      error: h.lastError,
    });
    return;
  }
  if (next === "ready") {
    if (prev === "degraded") {
      console.info(
        `[redis] ${label} RECOVERED instance=${instanceLabel()} after ${Math.round(downForMs / 1000)}s`,
      );
    } else {
      console.info(`[redis] ${label} ready instance=${instanceLabel()}`);
    }
    h.lastError = null;
    return;
  }
  if (next === "not_configured" || next === "disabled") {
    console.info(`[redis] ${label} ${next} instance=${instanceLabel()}`);
  }
}

/** Call periodically (any cadence): raises a reminder while a component stays degraded. */
export function checkPersistentRedisOutage(nowMs = Date.now()): void {
  for (const [component, h] of components) {
    if (h.state !== "degraded") continue;
    const downFor = nowMs - h.since;
    if (downFor < REDIS_PERSISTENT_OUTAGE_ALERT_MS) continue;
    if (h.lastPersistentAlertAt && nowMs - h.lastPersistentAlertAt < REDIS_PERSISTENT_OUTAGE_REPEAT_MS) continue;
    h.lastPersistentAlertAt = nowMs;
    const label = LABEL[component];
    console.error(
      `[redis] ${label} STILL DEGRADED instance=${instanceLabel()} for ${Math.round(downFor / 60_000)}min — ${impact(component)}`,
    );
    captureServerException(new Error(`Redis ${label} persistently unavailable`), {
      component,
      instance: instanceLabel(),
      downForMinutes: Math.round(downFor / 60_000),
      error: h.lastError,
    });
  }
}

export type RedisHealthSnapshot = Record<RedisComponent, { state: RedisComponentState; sinceSeconds: number }>;

/** Non-secret status for /api/health. */
export function getRedisHealthSnapshot(nowMs = Date.now()): RedisHealthSnapshot {
  const out = {} as RedisHealthSnapshot;
  for (const component of ["rateLimit", "socketAdapter"] as const) {
    const h = get(component);
    out[component] = { state: h.state, sinceSeconds: Math.max(0, Math.round((nowMs - h.since) / 1000)) };
  }
  return out;
}

/** Test seam. */
export function resetRedisHealthForTests(): void {
  components.clear();
}
