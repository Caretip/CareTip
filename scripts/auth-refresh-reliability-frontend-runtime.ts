/**
 * Frontend refresh reliability (no backend, no credentials): drives the real `api.ts` refresh path
 * against a scripted `fetch`.
 * Run: npm run test:auth-refresh-reliability-frontend
 *
 * Covers: no blind replay of the refresh POST, bounded retry only for confirmed no-commit answers
 * (409 / 503 retryable), transient failures never clearing the session, real 12s deadline abort,
 * overlapping tabs serialised, degraded recovery, and logout in another tab.
 */
import {
  authRefreshCoordinationTestHooks,
  REFRESH_COORD_TIMEOUT_MS,
} from "../src/app/lib/authRefreshCoordination";
import { clearMemoryAccessToken, getMemoryAccessToken, setMemoryAccessToken } from "../src/app/lib/accessTokenStore";
import { markSessionBootstrapSettled, resetSessionBootstrap } from "../src/app/lib/authSessionBootstrap";
import { isDefinitiveRefreshFailure } from "../src/app/lib/authRefreshFailureClassification";

// --- Browser shims (must exist before api.ts loads) ---
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
  },
  configurable: true,
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  configurable: true,
});
Object.defineProperty(globalThis, "window", {
  value: {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    location: {
      hostname: "localhost",
      host: "localhost:5173",
      origin: "http://localhost:5173",
      protocol: "http:",
      href: "http://localhost:5173/",
      pathname: "/",
    },
  },
  configurable: true,
});

// App debug logging is buffered and only printed when a check fails.
const logBuffer: string[] = [];
const realConsole = { ...console };
for (const level of ["log", "info", "debug", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => {
    logBuffer.push(`[${level}] ${args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
  };
}
class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {}
  postMessage(): void {}
  close(): void {}
}
Object.defineProperty(globalThis, "BroadcastChannel", { value: MockBroadcastChannel, configurable: true });

const {
  bootstrapRefreshSession,
  refreshSessionAPI,
  cancelPendingSessionRefresh,
  clearClientAuthStorage,
  clearClientSessionRevoked,
  markClientSessionRevoked,
  isClientSessionRevoked,
  getMyAccountSettings,
} = await import("../src/app/lib/api");

type Check = { id: string; ok: boolean; detail: string };
const results: Check[] = [];
const assert = (cond: unknown, id: string, detail: string) => results.push({ id, ok: Boolean(cond), detail });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- Scripted fetch ---
type Reply =
  | { kind: "json"; status: number; body: unknown; delayMs?: number }
  | { kind: "network" }
  | { kind: "hang" };
let refreshReplies: Reply[] = [];
let refreshCalls = 0;
let inFlight = 0;
let maxInFlight = 0;
let protectedStatus = 401;
const refreshSignals: Array<AbortSignal | undefined> = [];

const okBody = (n: number) => ({
  token: `access-${n}`,
  user: { id: "u1", email: "user@example.test", role: "employee" },
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/api/auth/refresh")) {
    return jsonResponse(protectedStatus, protectedStatus === 200 ? { ok: true } : { message: "Unauthorized" });
  }
  refreshCalls += 1;
  refreshSignals.push(init?.signal ?? undefined);
  const reply = refreshReplies.shift() ?? { kind: "network" as const };
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    if (reply.kind === "network") {
      await sleep(5);
      throw new TypeError("Failed to fetch");
    }
    if (reply.kind === "hang") {
      return await new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          setTimeout(() => reject(new DOMException("The operation was aborted.", "AbortError")), 50);
        });
      });
    }
    await sleep(reply.delayMs ?? 5);
    return jsonResponse(reply.status, reply.body);
  } finally {
    inFlight -= 1;
  }
}) as typeof fetch;

const CACHED_USER = JSON.stringify({ id: "u1", email: "user@example.test", role: "employee" });

function reset(replies: Reply[]): void {
  clearClientAuthStorage({ notifySync: false });
  clearClientSessionRevoked();
  cancelPendingSessionRefresh();
  clearMemoryAccessToken();
  storage.clear();
  storage.set("caretip_user", CACHED_USER);
  resetSessionBootstrap();
  authRefreshCoordinationTestHooks.reset();
  authRefreshCoordinationTestHooks.resetWebLocksOverride();
  authRefreshCoordinationTestHooks.setLocalStorageBroken(false);
  authRefreshCoordinationTestHooks.setTabIdForTests(`tab-${Math.random().toString(36).slice(2, 8)}`);
  refreshReplies = [...replies];
  refreshCalls = 0;
  inFlight = 0;
  maxInFlight = 0;
  protectedStatus = 401;
  refreshSignals.length = 0;
}

function serializingLocks() {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    request: (_name: string, cb: (lock: unknown) => Promise<unknown>) => {
      const run = () => cb({});
      const result = chain.then(run, run);
      chain = result.catch(() => undefined);
      return result;
    },
    query: async () => ({ held: [], pending: [] }),
  } as unknown as LockManager;
}

// 11 + 12a: network failure → one POST, transient, cached user kept, nothing cleared
reset([{ kind: "network" }, { kind: "json", status: 200, body: okBody(1) }]);
{
  const out = await bootstrapRefreshSession();
  assert(out.kind === "transient_error", "11", "network failure during refresh is transient, not unauthenticated");
  assert(storage.get("caretip_user") === CACHED_USER, "11", "cached user survives the network failure");
  assert(!isClientSessionRevoked(), "11", "session is not marked revoked");
  assert(refreshCalls === 1, "12a", `ambiguous network failure is not replayed (POSTs: ${refreshCalls})`);
}

// 12b: 409 conflict → retried exactly once
reset([
  { kind: "json", status: 409, body: { code: "REFRESH_CONFLICT" } },
  { kind: "json", status: 200, body: okBody(2) },
]);
{
  const out = await bootstrapRefreshSession();
  assert(out.kind === "authenticated", "12b", "409 conflict is retried and recovers");
  assert(refreshCalls === 2, "12b", `409 retried exactly once (POSTs: ${refreshCalls})`);
  assert(getMemoryAccessToken() === "access-2", "12b", "access token from the retry is kept in memory");
}

// 12c: 503 retryable:true → retried once
reset([
  { kind: "json", status: 503, body: { code: "REFRESH_UNAVAILABLE", retryable: true } },
  { kind: "json", status: 200, body: okBody(3) },
]);
{
  const out = await bootstrapRefreshSession();
  assert(out.kind === "authenticated" && refreshCalls === 2, "12c", "503 retryable:true is retried once and recovers");
}

// 12d: 503 retryable:false (outcome unknown) → not replayed
reset([
  { kind: "json", status: 503, body: { code: "REFRESH_UNAVAILABLE", retryable: false } },
  { kind: "json", status: 200, body: okBody(4) },
]);
{
  const out = await bootstrapRefreshSession();
  assert(out.kind === "transient_error" && refreshCalls === 1, "12d", "503 retryable:false is not replayed");
  assert(storage.get("caretip_user") === CACHED_USER, "12d", "cached user kept after unknown-outcome 503");
}

// 12e: 502 from a proxy (no body) → not replayed
reset([{ kind: "json", status: 502, body: null }, { kind: "json", status: 200, body: okBody(5) }]);
{
  const out = await bootstrapRefreshSession();
  assert(out.kind === "transient_error" && refreshCalls === 1, "12e", "502 without retryable is not replayed");
}

// 12f: persistent 409 → bounded to two POSTs, still transient
reset([
  { kind: "json", status: 409, body: { code: "REFRESH_CONFLICT" } },
  { kind: "json", status: 409, body: { code: "REFRESH_CONFLICT" } },
  { kind: "json", status: 200, body: okBody(6) },
]);
{
  const out = await bootstrapRefreshSession();
  assert(out.kind === "transient_error" && refreshCalls === 2, "12f", "repeated 409 stops after two POSTs");
}

// 12g: genuine 401 → unauthenticated, one POST
reset([{ kind: "json", status: 401, body: { message: "Invalid session" } }]);
{
  const out = await bootstrapRefreshSession();
  assert(out.kind === "unauthenticated" && refreshCalls === 1, "12g", "genuine 401 is definitive and not retried");
}

// refreshSessionAPI wording: conflict is never phrased as session expiry
reset([
  { kind: "json", status: 409, body: { code: "REFRESH_CONFLICT" } },
  { kind: "json", status: 409, body: { code: "REFRESH_CONFLICT" } },
]);
{
  let err: unknown = null;
  try {
    await refreshSessionAPI();
  } catch (e) {
    err = e;
  }
  assert(err instanceof Error && !isDefinitiveRefreshFailure(err), "msg", "refreshSessionAPI 409 error is non-definitive");
}

// 13a: same tab, concurrent callers → one POST (single-flight)
reset([{ kind: "json", status: 200, body: okBody(7), delayMs: 60 }]);
{
  const [a, b, c] = await Promise.all([bootstrapRefreshSession(), bootstrapRefreshSession(), bootstrapRefreshSession()]);
  assert(
    a.kind === "authenticated" && b.kind === "authenticated" && c.kind === "authenticated" && refreshCalls === 1,
    "13a",
    `concurrent callers in one tab share one POST (POSTs: ${refreshCalls})`,
  );
}

// 13b: two tabs overlapping → serialised by the lock, never two POSTs in flight
reset([
  { kind: "json", status: 200, body: okBody(8), delayMs: 80 },
  { kind: "json", status: 200, body: okBody(9), delayMs: 80 },
]);
{
  authRefreshCoordinationTestHooks.setWebLocksOverride(serializingLocks());
  authRefreshCoordinationTestHooks.setTabIdForTests("tab-a");
  const pA = bootstrapRefreshSession();
  // Drop this module's single-flight handle so the next call behaves like an independent tab.
  cancelPendingSessionRefresh();
  authRefreshCoordinationTestHooks.setTabIdForTests("tab-b");
  const pB = bootstrapRefreshSession();
  const [a, b] = await Promise.all([pA, pB]);
  assert(refreshCalls === 2, "13b", "both tabs reached the refresh step (calls genuinely overlapped)");
  assert(maxInFlight === 1, "13b", `refresh POSTs never overlapped across tabs (max in flight: ${maxInFlight})`);
  assert(a.kind === "authenticated" && b.kind === "authenticated", "13b", "both tabs end authenticated");
}

// 14: degraded recovery — transient failure first, next attempt restores the session
reset([{ kind: "network" }, { kind: "json", status: 200, body: okBody(10) }]);
{
  const first = await bootstrapRefreshSession();
  const second = await bootstrapRefreshSession();
  assert(first.kind === "transient_error", "14", "first attempt degraded (transient)");
  assert(second.kind === "authenticated", "14", "degraded retry restores the session without re-login");
  assert(storage.get("caretip_user") === CACHED_USER, "14", "cached user kept across degraded period");
}

// 15: logout in another tab → no refresh POST, unauthenticated
reset([{ kind: "json", status: 200, body: okBody(11) }]);
{
  markClientSessionRevoked();
  const out = await bootstrapRefreshSession();
  assert(out.kind === "unauthenticated", "15", "logout signal from another tab yields unauthenticated");
  assert(refreshCalls === 0, "15", "no refresh POST after logout (cannot revive the session)");
}

// API 401 + transient refresh failure → session kept; contrast: refresh 401 → session cleared
reset([{ kind: "network" }]);
{
  markSessionBootstrapSettled();
  setMemoryAccessToken("stale-access");
  await getMyAccountSettings().catch(() => undefined);
  assert(storage.get("caretip_user") === CACHED_USER, "api401", "transient refresh failure on API 401 keeps cached user");
  assert(!isClientSessionRevoked(), "api401", "transient refresh failure on API 401 does not mark revoked");
}
reset([{ kind: "json", status: 401, body: { message: "Invalid session" } }]);
{
  markSessionBootstrapSettled();
  setMemoryAccessToken("stale-access");
  await getMyAccountSettings().catch(() => undefined);
  assert(!storage.has("caretip_user"), "api401", "definitive refresh 401 on API 401 still clears the session");
}

// F5: real 12s deadline through api.ts — request aborted, one POST, session kept
reset([{ kind: "hang" }, { kind: "json", status: 200, body: okBody(12) }]);
{
  const t0 = Date.now();
  const out = await bootstrapRefreshSession();
  const elapsed = Date.now() - t0;
  assert(out.kind === "transient_error", "F5", "deadline timeout is transient");
  assert(refreshSignals[0]?.aborted === true, "F5", "the hung refresh POST was aborted");
  assert(
    elapsed >= REFRESH_COORD_TIMEOUT_MS - 50 && elapsed < REFRESH_COORD_TIMEOUT_MS + 2_000,
    "F5",
    `aborted at the real ${REFRESH_COORD_TIMEOUT_MS}ms deadline (observed ${elapsed}ms)`,
  );
  assert(refreshCalls === 1, "F5", "timed-out refresh is not replayed");
  assert(storage.get("caretip_user") === CACHED_USER, "F5", "cached user kept after deadline timeout");
}

Object.assign(console, realConsole);
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) console.log(logBuffer.slice(-60).join("\n"));
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} [${r.id}] ${r.detail}`);
if (failed.length > 0) {
  console.error(`auth-refresh-reliability-frontend-runtime: ${failed.length} failed`);
  process.exit(1);
}
console.log(`auth-refresh-reliability-frontend-runtime: ok (${results.length} checks)`);
process.exit(0);
