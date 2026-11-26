/**
 * Progressive lockout for password sign-in, per account.
 *
 * Policy: 5 consecutive failed password attempts lock the account for 5 minutes. After that
 * lock expires, 5 more consecutive failures lock it for 10 minutes. Every later round of 5
 * failures stays at 10 minutes (capped, never escalating without limit). A successful password
 * check clears the state; 24 hours without a failure also clears it.
 *
 * - Keyed by the normalized email, hashed, and applied whether or not an account exists, so a
 *   lockout never reveals which emails are registered.
 * - State lives in the shared Redis store. Two Lua scripts make each step atomic and read time
 *   from Redis, so every instance uses one clock. Before a password is checked, the attempt
 *   reserves a slot: at most 5 password checks can run per round, even when requests arrive
 *   at the same moment.
 * - Without Redis (not configured or unreachable) the same rules run in process memory. Each
 *   instance then enforces its own lockout, and the IP and email rate limits still apply.
 * - Only password sign-in (and the password-confirmed verification resend) is affected. OAuth
 *   sign-in and password reset stay available, so a lockout cannot shut a user out entirely.
 * - Device scope: a browser that already signed in to this email (trustedLoginDevice.service.ts)
 *   counts its failures in its own state, so failures by anyone else (who has no such cookie) can
 *   lock the email-wide state but never that browser. Everything else, attackers included, uses
 *   the email-wide state, so rotating IP addresses gains nothing.
 * - A completed password reset clears the email-wide state.
 */
import crypto from "node:crypto";
import { getRateLimitRedisClient } from "../utils/rateLimitStore.js";

export const LOGIN_LOCKOUT_MAX_FAILURES = 5;
/** Lock duration per level: level 1 = 5 minutes, level 2 (and every later round) = 10 minutes. */
export const LOGIN_LOCKOUT_DURATIONS_MS = [5 * 60_000, 10 * 60_000] as const;
const MAX_LEVEL = LOGIN_LOCKOUT_DURATIONS_MS.length;
/** A reserved attempt that never reports back (crashed request) is released after this. */
const PENDING_TTL_MS = 30_000;
/** Failure history is forgotten after this long without a new failure. */
const STATE_TTL_MS = 24 * 60 * 60_000;

export type LoginAttemptTicket = {
  key: string;
  token: string;
};

export type LoginLockoutBegin =
  | { allowed: true; ticket: LoginAttemptTicket }
  | { allowed: false; retryAfterMs: number };

export type LoginLockoutFailure =
  | { locked: false; level: number }
  /** This failure started a lock (level 1 = 5 min, level 2 = 10 min). */
  | { locked: true; newlyLocked: boolean; retryAfterMs: number; level: number };

export type LoginLockoutSuccess = {
  /** The account had been locked at least once in the current failure history. */
  hadLockout: boolean;
};

function stateKey(normalizedEmail: string, deviceId?: string | null): string {
  const digest = crypto.createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 32);
  // Braces keep both keys in one Redis Cluster hash slot.
  const base = `auth:lockout:v1:{${digest}}`;
  if (!deviceId) return base;
  return `${base}:d:${crypto.createHash("sha256").update(deviceId).digest("hex").slice(0, 24)}`;
}

export type LoginLockoutScope = { deviceId?: string | null };

/* ---------------- Redis implementation ---------------- */

const NOW_MS = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
`;

/**
 * KEYS[1] state hash (f = failures this round, l = level, u = locked until ms), KEYS[2] pending zset.
 * ARGV: token, maxFailures, pendingTtlMs.
 * Returns {0, 0} allowed, {1, retryMs} locked, {2, retryMs} round full while attempts are in flight.
 */
export const LOCKOUT_BEGIN_SCRIPT = `${NOW_MS}
local u = tonumber(redis.call('HGET', KEYS[1], 'u') or '0')
if u > now then
  return {1, u - now}
end
local pendingTtl = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - pendingTtl)
local f = tonumber(redis.call('HGET', KEYS[1], 'f') or '0')
local pending = redis.call('ZCARD', KEYS[2])
if f + pending >= tonumber(ARGV[2]) then
  return {2, pendingTtl}
end
redis.call('ZADD', KEYS[2], now, ARGV[1])
redis.call('PEXPIRE', KEYS[2], pendingTtl * 2)
return {0, 0}
`;

/**
 * ARGV: token, maxFailures, stateTtlMs, level1Ms, level2Ms, maxLevel.
 * Returns {0, level, 0} counted, {1, level, retryMs} already locked (not counted),
 * {2, level, retryMs} this failure started a lock.
 */
export const LOCKOUT_FAILURE_SCRIPT = `${NOW_MS}
redis.call('ZREM', KEYS[2], ARGV[1])
local level = tonumber(redis.call('HGET', KEYS[1], 'l') or '0')
local u = tonumber(redis.call('HGET', KEYS[1], 'u') or '0')
if u > now then
  return {1, level, u - now}
end
local f = tonumber(redis.call('HGET', KEYS[1], 'f') or '0') + 1
local stateTtl = tonumber(ARGV[3])
if f >= tonumber(ARGV[2]) then
  level = math.min(level + 1, tonumber(ARGV[6]))
  local duration = tonumber(ARGV[5])
  if level == 1 then duration = tonumber(ARGV[4]) end
  redis.call('HSET', KEYS[1], 'f', 0, 'l', level, 'u', now + duration)
  redis.call('PEXPIRE', KEYS[1], duration + stateTtl)
  redis.call('DEL', KEYS[2])
  return {2, level, duration}
end
redis.call('HSET', KEYS[1], 'f', f, 'l', level)
redis.call('PEXPIRE', KEYS[1], stateTtl)
return {0, level, 0}
`;

/** ARGV: token. Clears all state. Returns the level the account had reached. */
export const LOCKOUT_SUCCESS_SCRIPT = `
redis.call('ZREM', KEYS[2], ARGV[1])
local level = tonumber(redis.call('HGET', KEYS[1], 'l') or '0')
redis.call('DEL', KEYS[1])
return level
`;

/** ARGV: token. Releases a reserved attempt that ended without a credential result. */
export const LOCKOUT_RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

type EvalClient = { eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> };

async function redisEval(script: string, key: string, args: Array<string | number>): Promise<unknown[] | number | null> {
  const redis = (await getRateLimitRedisClient()) as EvalClient | null;
  if (!redis) return null;
  try {
    return (await redis.eval(script, 2, key, `${key}:p`, ...args)) as unknown[] | number;
  } catch (err) {
    console.warn("[auth.lockout] shared store unavailable; using this instance's memory", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/* ---------------- In-memory fallback (same rules) ---------------- */

type MemoryState = { f: number; l: number; u: number; pending: Map<string, number>; touched: number };
const memory = new Map<string, MemoryState>();
let clockForTests: (() => number) | null = null;

/** Test seam for the in-memory store: a controllable clock. */
export function __setLoginLockoutClockForTests(fn: (() => number) | null): void {
  clockForTests = fn;
}

/** Test seam: forget in-memory state. */
export function __resetLoginLockoutMemoryForTests(): void {
  memory.clear();
}

function now(): number {
  return clockForTests ? clockForTests() : Date.now();
}

function memoryState(key: string, at: number): MemoryState {
  let s = memory.get(key);
  if (s && s.u <= at && at - s.touched > STATE_TTL_MS) {
    memory.delete(key);
    s = undefined;
  }
  if (!s) {
    s = { f: 0, l: 0, u: 0, pending: new Map(), touched: at };
    memory.set(key, s);
  }
  if (memory.size > 50_000) {
    // Bound memory under a spray of random emails: drop the oldest entries.
    for (const k of memory.keys()) {
      if (memory.size <= 40_000) break;
      memory.delete(k);
    }
  }
  return s;
}

function memoryBegin(key: string, token: string): LoginLockoutBegin {
  const at = now();
  const s = memoryState(key, at);
  if (s.u > at) return { allowed: false, retryAfterMs: s.u - at };
  for (const [t, startedAt] of s.pending) {
    if (startedAt <= at - PENDING_TTL_MS) s.pending.delete(t);
  }
  if (s.f + s.pending.size >= LOGIN_LOCKOUT_MAX_FAILURES) {
    return { allowed: false, retryAfterMs: PENDING_TTL_MS };
  }
  s.pending.set(token, at);
  return { allowed: true, ticket: { key, token } };
}

function memoryFailure(key: string, token: string): LoginLockoutFailure {
  const at = now();
  const s = memoryState(key, at);
  s.pending.delete(token);
  if (s.u > at) return { locked: true, newlyLocked: false, retryAfterMs: s.u - at, level: s.l };
  s.f += 1;
  s.touched = at;
  if (s.f >= LOGIN_LOCKOUT_MAX_FAILURES) {
    s.l = Math.min(s.l + 1, MAX_LEVEL);
    const duration = LOGIN_LOCKOUT_DURATIONS_MS[s.l - 1];
    s.f = 0;
    s.u = at + duration;
    s.pending.clear();
    return { locked: true, newlyLocked: true, retryAfterMs: duration, level: s.l };
  }
  return { locked: false, level: s.l };
}

function memorySuccess(key: string): LoginLockoutSuccess {
  const s = memory.get(key);
  memory.delete(key);
  return { hadLockout: (s?.l ?? 0) > 0 };
}

/* ---------------- Public API ---------------- */

/** Call before checking a password. A refused attempt must not check the password at all. */
export async function beginLoginAttempt(normalizedEmail: string, scope?: LoginLockoutScope): Promise<LoginLockoutBegin> {
  const key = stateKey(normalizedEmail, scope?.deviceId);
  const token = crypto.randomUUID();
  const raw = await redisEval(LOCKOUT_BEGIN_SCRIPT, key, [token, LOGIN_LOCKOUT_MAX_FAILURES, PENDING_TTL_MS]);
  if (!Array.isArray(raw)) return memoryBegin(key, token);
  const code = Number(raw[0]);
  if (code === 0) return { allowed: true, ticket: { key, token } };
  return { allowed: false, retryAfterMs: Math.max(1000, Number(raw[1]) || PENDING_TTL_MS) };
}

/** The password (or account) did not match. */
export async function recordLoginFailure(ticket: LoginAttemptTicket): Promise<LoginLockoutFailure> {
  const raw = await redisEval(LOCKOUT_FAILURE_SCRIPT, ticket.key, [
    ticket.token,
    LOGIN_LOCKOUT_MAX_FAILURES,
    STATE_TTL_MS,
    LOGIN_LOCKOUT_DURATIONS_MS[0],
    LOGIN_LOCKOUT_DURATIONS_MS[1],
    MAX_LEVEL,
  ]);
  const result: LoginLockoutFailure = Array.isArray(raw)
    ? Number(raw[0]) === 0
      ? { locked: false, level: Number(raw[1]) || 0 }
      : {
          locked: true,
          newlyLocked: Number(raw[0]) === 2,
          retryAfterMs: Math.max(1000, Number(raw[2]) || 0),
          level: Number(raw[1]) || 0,
        }
    : memoryFailure(ticket.key, ticket.token);

  if (result.locked && result.newlyLocked) {
    console.warn("[auth.lockout] account sign-in locked", {
      // First 8 hex characters of the hashed email: correlates events without logging the address.
      account: ticket.key.slice(ticket.key.indexOf("{") + 1, ticket.key.indexOf("{") + 9),
      scope: ticket.key.includes("}:d:") ? "trusted-device" : "email",
      level: result.level,
      minutes: Math.round(result.retryAfterMs / 60_000),
    });
  }
  return result;
}

/** The password matched: clear the failure history. */
export async function recordLoginSuccess(ticket: LoginAttemptTicket): Promise<LoginLockoutSuccess> {
  const raw = await redisEval(LOCKOUT_SUCCESS_SCRIPT, ticket.key, [ticket.token]);
  if (raw == null) return memorySuccess(ticket.key);
  memory.delete(ticket.key);
  return { hadLockout: Number(raw) > 0 };
}

/**
 * Clears the email-wide lockout after the user proved control of the inbox (completed password
 * reset), so a user locked out on a new device can sign in with the new password.
 */
export async function clearLoginLockout(normalizedEmail: string): Promise<void> {
  const key = stateKey(normalizedEmail);
  memory.delete(key);
  const redis = (await getRateLimitRedisClient()) as { del(...keys: string[]): Promise<unknown> } | null;
  if (!redis) return;
  try {
    await redis.del(key, `${key}:p`);
  } catch (err) {
    console.warn("[auth.lockout] could not clear shared lockout state", { reason: err instanceof Error ? err.message : String(err) });
  }
}

/** The attempt ended without a credential result (e.g. database error): release its slot. */
export async function releaseLoginAttempt(ticket: LoginAttemptTicket): Promise<void> {
  const raw = await redisEval(LOCKOUT_RELEASE_SCRIPT, ticket.key, [ticket.token]);
  if (raw == null) memory.get(ticket.key)?.pending.delete(ticket.token);
}

/* ---------------- Response copy ---------------- */

export const LOGIN_TEMPORARILY_LOCKED_CODE = "LOGIN_TEMPORARILY_LOCKED";

/** Localized, identical for every email whether or not an account exists. */
export function loginLockedMessage(locale: "en" | "de", retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  if (locale === "de") {
    const span = minutes === 1 ? "1 Minute" : `${minutes} Minuten`;
    return `Die Anmeldung ist wegen zu vieler fehlgeschlagener Versuche vorübergehend gesperrt. Bitte versuchen Sie es in ${span} erneut oder setzen Sie Ihr Passwort zurück.`;
  }
  const span = minutes === 1 ? "1 minute" : `${minutes} minutes`;
  return `Sign-in is temporarily locked after too many failed attempts. Please try again in ${span} or reset your password.`;
}
