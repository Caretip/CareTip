/**
 * Cross-tab auth refresh coordination — deterministic architecture + unit tests.
 * Run: npm run test:auth-refresh-coordination
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authRefreshCoordinationTestHooks,
  coordinateCrossTabRefresh,
  getActiveCoordinationMechanism,
  hasRecentPeerRefreshSuccess,
  isRefreshBlockedByPeerLock,
  isWebLocksAvailable,
  RefreshCoordinationTimeoutError,
  REFRESH_ABORT_SETTLE_MAX_MS,
  REFRESH_COORD_TIMEOUT_MS,
  WEB_LOCK_NAME,
} from "../src/app/lib/authRefreshCoordination";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type TestResult = { id: string; ok: boolean; detail: string };

const results: TestResult[] = [];
const pass = (id: string, detail: string) => results.push({ id, ok: true, detail });
const fail = (id: string, detail: string) => results.push({ id, ok: false, detail });

function assert(condition: unknown, id: string, detail: string): boolean {
  if (condition) {
    pass(id, detail);
    return true;
  }
  fail(id, detail);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

// --- Environment shims ---
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

class MockBroadcastChannel {
  static channels = new Map<string, Set<MockBroadcastChannel>>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, new Set());
    }
    MockBroadcastChannel.channels.get(name)!.add(this);
  }
  postMessage(data: unknown): void {
    for (const peer of MockBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data } as MessageEvent);
    }
  }
  close(): void {
    MockBroadcastChannel.channels.get(this.name)?.delete(this);
  }
  static reset(): void {
    MockBroadcastChannel.channels.clear();
  }
}

Object.defineProperty(globalThis, "BroadcastChannel", {
  value: MockBroadcastChannel,
  configurable: true,
});

Object.defineProperty(globalThis, "window", {
  value: {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
  },
  configurable: true,
});

function createSerializingWebLocks() {
  let chain: Promise<unknown> = Promise.resolve();
  let inCritical = 0;
  let maxConcurrent = 0;
  let held = false;

  const locks = {
    request: async (_name: string, callback: (lock: unknown) => Promise<unknown>) => {
      const run = async () => {
        inCritical += 1;
        maxConcurrent = Math.max(maxConcurrent, inCritical);
        held = true;
        try {
          return await callback({});
        } finally {
          inCritical -= 1;
          held = false;
        }
      };
      const result = chain.then(run, run);
      chain = result.catch(() => undefined);
      return result;
    },
    query: async () => ({
      held: held ? [{ name: WEB_LOCK_NAME }] : [],
      pending: [],
    }),
  };

  return {
    locks: locks as unknown as typeof navigator.locks,
    getMaxConcurrent: () => maxConcurrent,
    resetMetrics: () => {
      maxConcurrent = 0;
      inCritical = 0;
      held = false;
      chain = Promise.resolve();
    },
  };
}

function resetCoordinationEnv(): void {
  storage.clear();
  MockBroadcastChannel.reset();
  authRefreshCoordinationTestHooks.reset();
  authRefreshCoordinationTestHooks.resetWebLocksOverride();
  authRefreshCoordinationTestHooks.setLocalStorageBroken(false);
  authRefreshCoordinationTestHooks.setTabIdForTests(`tab-${Math.random().toString(36).slice(2, 8)}`);
}

// --- Architecture assertions ---
const coordinationSrc = read("src/app/lib/authRefreshCoordination.ts");
const apiSrc = read("src/app/lib/api.ts");

assert(coordinationSrc.includes("navigator.locks") || coordinationSrc.includes("resolveWebLocks()"), "arch", "Web Locks primary path present");
assert(coordinationSrc.includes(WEB_LOCK_NAME), "arch", "CareTip-specific lock name");
assert(!coordinationSrc.includes("if (peerDone?.ok)"), "arch", "peer-success bypass removed");
assert(!coordinationSrc.includes("LOCK_TTL_MS"), "arch", "20s TTL steal removed");
assert(coordinationSrc.includes("RefreshCoordinationTimeoutError"), "arch", "coordination timeout error defined");
const COORDINATED_REFRESH = "coordinateCrossTabRefresh((signal) => runRefreshAuthWithRetries(options, signal))";
assert(apiSrc.includes(COORDINATED_REFRESH), "arch", "refresh uses coordination (with abort signal)");
assert(
  !apiSrc.includes("out = await runRefreshAuthWithRetries(") &&
    apiSrc.split(COORDINATED_REFRESH).length - 1 === 2,
  "arch",
  "peer retry remains coordinated",
);
assert(!apiSrc.includes("localStorage.setItem") || !apiSrc.match(/setToken.*localStorage/), "arch", "access tokens not in localStorage via api");

// --- Test A: two tabs simultaneous refresh ---
async function testA(): Promise<void> {
  resetCoordinationEnv();
  const { locks, getMaxConcurrent, resetMetrics } = createSerializingWebLocks();
  authRefreshCoordinationTestHooks.setWebLocksOverride(locks);
  resetMetrics();

  let active = 0;
  let maxActive = 0;
  const runner = async (label: string) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await sleep(40);
    active -= 1;
    return { ok: true, status: 200, label };
  };

  authRefreshCoordinationTestHooks.setTabIdForTests("tab-a");
  const pA = coordinateCrossTabRefresh(() => runner("a"));
  authRefreshCoordinationTestHooks.setTabIdForTests("tab-b");
  const pB = coordinateCrossTabRefresh(() => runner("b"));
  const [rA, rB] = await Promise.all([pA, pB]);

  assert(maxActive === 1, "A", "two tabs: no concurrent refresh critical section");
  assert(getMaxConcurrent() === 1, "A", "two tabs: Web Lock serializes holders");
  assert(rA.ok && rB.ok, "A", "two tabs: both authenticated (runner ok)");
}

// --- Test B: three tabs simultaneous refresh ---
async function testB(): Promise<void> {
  resetCoordinationEnv();
  const { locks, getMaxConcurrent, resetMetrics } = createSerializingWebLocks();
  authRefreshCoordinationTestHooks.setWebLocksOverride(locks);
  resetMetrics();

  const order: string[] = [];
  const runner = async (label: string) => {
    order.push(`start-${label}`);
    await sleep(20);
    order.push(`end-${label}`);
    return { ok: true, status: 200, label };
  };

  authRefreshCoordinationTestHooks.setTabIdForTests("tab-a");
  const pA = coordinateCrossTabRefresh(() => runner("a"));
  authRefreshCoordinationTestHooks.setTabIdForTests("tab-b");
  const pB = coordinateCrossTabRefresh(() => runner("b"));
  authRefreshCoordinationTestHooks.setTabIdForTests("tab-c");
  const pC = coordinateCrossTabRefresh(() => runner("c"));
  await Promise.all([pA, pB, pC]);

  assert(getMaxConcurrent() === 1, "B", "three tabs: sequential Web Lock holders");
  assert(order.length === 6, "B", "three tabs: all runners completed");
}

// --- Test C: BroadcastChannel disabled ---
async function testC(): Promise<void> {
  resetCoordinationEnv();
  // @ts-expect-error test override
  globalThis.BroadcastChannel = undefined;
  authRefreshCoordinationTestHooks.resetWebLocksOverride();
  authRefreshCoordinationTestHooks.setWebLocksOverride(null);

  authRefreshCoordinationTestHooks.setTabIdForTests("leader");
  const leader = coordinateCrossTabRefresh(async () => {
    await sleep(30);
    return { ok: true, status: 200 };
  });

  await sleep(10);
  authRefreshCoordinationTestHooks.setTabIdForTests("follower");
  const follower = coordinateCrossTabRefresh(async () => ({ ok: true, status: 200 }));

  const [l, f] = await Promise.all([leader, follower]);
  assert(l.ok && f.ok, "C", "BroadcastChannel disabled: both tabs complete via storage fallback");

  Object.defineProperty(globalThis, "BroadcastChannel", {
    value: MockBroadcastChannel,
    configurable: true,
  });
}

// --- Test D: Web Locks unavailable ---
async function testD(): Promise<void> {
  resetCoordinationEnv();
  authRefreshCoordinationTestHooks.setWebLocksOverride(null);
  assert(getActiveCoordinationMechanism() === "localStorage-fallback", "D", "fallback mechanism selected");

  let concurrent = 0;
  let maxConcurrent = 0;
  authRefreshCoordinationTestHooks.setTabIdForTests("tab-a");
  const pA = coordinateCrossTabRefresh(async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(50);
    concurrent -= 1;
    return { ok: true, status: 200 };
  });
  await sleep(5);
  authRefreshCoordinationTestHooks.setTabIdForTests("tab-b");
  const pB = coordinateCrossTabRefresh(async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(50);
    concurrent -= 1;
    return { ok: true, status: 200 };
  });
  await Promise.all([pA, pB]);
  assert(maxConcurrent === 1, "D", "localStorage fallback serializes under normal timing");
}

// --- Test E: slow (250ms) refresh with Web Locks — no TTL steal; real timeouts are F/F2/F3 ---
async function testE(): Promise<void> {
  resetCoordinationEnv();
  const { locks, getMaxConcurrent, resetMetrics } = createSerializingWebLocks();
  authRefreshCoordinationTestHooks.setWebLocksOverride(locks);
  resetMetrics();

  let concurrent = 0;
  let maxConcurrent = 0;

  authRefreshCoordinationTestHooks.setTabIdForTests("slow-tab");
  const slow = coordinateCrossTabRefresh(async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(250);
    concurrent -= 1;
    return { ok: true, status: 200 };
  });

  await sleep(30);
  authRefreshCoordinationTestHooks.setTabIdForTests("fast-tab");
  const fast = coordinateCrossTabRefresh(async () => ({ ok: true, status: 200 }));

  await Promise.all([slow, fast]);
  assert(maxConcurrent === 1, "E", "slow refresh: no TTL-based concurrent refresh with Web Locks");
  assert(getMaxConcurrent() === 1, "E", "slow refresh: Web Lock held until slow refresh completes");
}

// --- Test F: refresh timeout ---
async function testF(): Promise<void> {
  resetCoordinationEnv();
  const { locks, resetMetrics } = createSerializingWebLocks();
  authRefreshCoordinationTestHooks.setWebLocksOverride(locks);
  resetMetrics();

  authRefreshCoordinationTestHooks.setTabIdForTests("timeout-tab");
  let timedOut = false;
  try {
    await coordinateCrossTabRefresh(async () => {
      await sleep(REFRESH_COORD_TIMEOUT_MS + 200);
      return { ok: true, status: 200 };
    });
  } catch (err) {
    timedOut = err instanceof RefreshCoordinationTimeoutError;
  }
  assert(timedOut, "F", "refresh timeout throws RefreshCoordinationTimeoutError");

  authRefreshCoordinationTestHooks.setTabIdForTests("recovery-tab");
  const recovered = await coordinateCrossTabRefresh(async () => ({ ok: true, status: 200 }));
  assert(recovered.ok, "F", "after timeout, another tab can refresh (lock released)");
}

// --- Test F2: real 12s timeout aborts the request; next tab waits until it has settled ---
async function testF2(): Promise<void> {
  resetCoordinationEnv();
  const { locks, resetMetrics } = createSerializingWebLocks();
  authRefreshCoordinationTestHooks.setWebLocksOverride(locks);
  resetMetrics();

  const t0 = Date.now();
  let firstSettledAt = 0;
  let firstSawAbort = false;
  let secondStartedAt = 0;

  authRefreshCoordinationTestHooks.setTabIdForTests("slow-tab");
  const first = coordinateCrossTabRefresh(
    (signal) =>
      new Promise<{ ok: boolean; shouldClearSession: boolean; status: number }>((resolve) => {
        signal.addEventListener("abort", () => {
          firstSawAbort = true;
          // Abort takes a moment to unwind (like fetch rejecting with AbortError).
          setTimeout(() => {
            firstSettledAt = Date.now();
            resolve({ ok: false, shouldClearSession: false, status: 504 });
          }, 400);
        });
      }),
  ).then(
    () => "resolved",
    (err) => (err instanceof RefreshCoordinationTimeoutError ? "timeout" : "other"),
  );

  await sleep(50);
  authRefreshCoordinationTestHooks.setTabIdForTests("queued-tab");
  const second = coordinateCrossTabRefresh(async () => {
    secondStartedAt = Date.now();
    return { ok: true, shouldClearSession: false, status: 200 };
  });

  const [firstOutcome, secondOut] = await Promise.all([first, second]);
  const abortedAfterMs = firstSettledAt - 400 - t0;
  assert(firstOutcome === "timeout", "F2", "timed-out refresh rejects with RefreshCoordinationTimeoutError");
  assert(firstSawAbort, "F2", "the in-flight request receives an abort signal at the deadline");
  assert(
    abortedAfterMs >= REFRESH_COORD_TIMEOUT_MS - 50 && abortedAfterMs < REFRESH_COORD_TIMEOUT_MS + 1_000,
    "F2",
    `abort fires at the real ${REFRESH_COORD_TIMEOUT_MS}ms deadline (observed ${abortedAfterMs}ms)`,
  );
  assert(
    secondStartedAt >= firstSettledAt,
    "F2",
    "queued tab cannot POST until the aborted request has settled (no overlap)",
  );
  assert(secondOut.ok, "F2", "queued tab refreshes normally afterwards");
}

// --- Test F3: request ignoring abort cannot hold the lock forever ---
async function testF3(): Promise<void> {
  resetCoordinationEnv();
  const { locks, resetMetrics } = createSerializingWebLocks();
  authRefreshCoordinationTestHooks.setWebLocksOverride(locks);
  resetMetrics();

  const t0 = Date.now();
  authRefreshCoordinationTestHooks.setTabIdForTests("stuck-tab");
  const stuck = coordinateCrossTabRefresh(async () => {
    await sleep(REFRESH_COORD_TIMEOUT_MS + REFRESH_ABORT_SETTLE_MAX_MS + 3_000);
    return { ok: true, status: 200 };
  }).catch((err) => err);

  await sleep(50);
  let nextStartedAt = 0;
  authRefreshCoordinationTestHooks.setTabIdForTests("next-tab");
  const next = coordinateCrossTabRefresh(async () => {
    nextStartedAt = Date.now() - t0;
    return { ok: true, status: 200 };
  });
  const [stuckErr] = await Promise.all([stuck, next]);
  const bound = REFRESH_COORD_TIMEOUT_MS + REFRESH_ABORT_SETTLE_MAX_MS;
  assert(stuckErr instanceof RefreshCoordinationTimeoutError, "F3", "stuck refresh times out");
  assert(
    nextStartedAt >= bound - 50 && nextStartedAt < bound + 1_000,
    "F3",
    `lock released after deadline + settle cap (${bound}ms), not earlier (observed ${nextStartedAt}ms)`,
  );
}

// --- Test G: refresh 503 ---
async function testG(): Promise<void> {
  resetCoordinationEnv();
  authRefreshCoordinationTestHooks.setWebLocksOverride(createSerializingWebLocks().locks);
  authRefreshCoordinationTestHooks.setTabIdForTests("503-tab");
  const out = await coordinateCrossTabRefresh(async () => ({
    ok: false,
    shouldClearSession: false,
    status: 503,
  }));
  assert(!out.ok && out.status === 503 && !out.shouldClearSession, "G", "503 published as transient failure (no session clear signal)");
}

// --- Test H: genuine 401 ---
async function testH(): Promise<void> {
  resetCoordinationEnv();
  authRefreshCoordinationTestHooks.setWebLocksOverride(createSerializingWebLocks().locks);
  authRefreshCoordinationTestHooks.setTabIdForTests("401-tab");
  const out = await coordinateCrossTabRefresh(async () => ({
    ok: false,
    shouldClearSession: true,
    status: 401,
  }));
  assert(!out.ok && out.shouldClearSession && out.status === 401, "H", "401 classified as definitive auth failure");
}

// --- Test I: peer success — follower still coordinates ---
async function testI(): Promise<void> {
  resetCoordinationEnv();
  const { locks, getMaxConcurrent, resetMetrics } = createSerializingWebLocks();
  authRefreshCoordinationTestHooks.setWebLocksOverride(locks);
  resetMetrics();

  authRefreshCoordinationTestHooks.setPeerDone("peer-leader", true, 200);
  assert(hasRecentPeerRefreshSuccess(), "I", "peer success signal detected");

  let runnerCalls = 0;
  authRefreshCoordinationTestHooks.setTabIdForTests("follower-tab");
  const out = await coordinateCrossTabRefresh(async () => {
    runnerCalls += 1;
    return { ok: true, status: 200, token: "follower-jwt" };
  });

  assert(runnerCalls === 1, "I", "follower still runs its own refresh (no JWT transfer)");
  assert(out.ok, "I", "follower obtains own JWT through coordination");
  assert(getMaxConcurrent() === 1, "I", "follower refresh entered Web Lock queue");
}

// --- Test J: logout semantics unchanged (architecture) ---
function testJ(): void {
  const logout = read("src/app/lib/authLogoutTransition.ts");
  assert(logout.includes("POST_LOGOUT_BOOTSTRAP_SUPPRESS"), "J", "logout bootstrap suppress unchanged");
  assert(apiSrc.includes("clearAuthStorageForDefinitiveFailure"), "J", "definitive failure clearing preserved");
}

// --- Test K: stale lock recovery (simulates crashed tab) ---
async function testK(): Promise<void> {
  resetCoordinationEnv();
  authRefreshCoordinationTestHooks.setWebLocksOverride(null);
  const staleAt = Date.now() - 121_000;
  authRefreshCoordinationTestHooks.setPeerLock("crashed-tab", staleAt);
  assert(!isRefreshBlockedByPeerLock(), "K", "stale peer lock not blocking");

  authRefreshCoordinationTestHooks.setTabIdForTests("recovery-tab");
  const out = await coordinateCrossTabRefresh(async () => ({ ok: true, status: 200 }));
  assert(out.ok, "K", "remaining tab recovers after stale lock");
}

// --- localStorage broken must not make every tab leader ---
async function testLocalStorageBroken(): Promise<void> {
  resetCoordinationEnv();
  authRefreshCoordinationTestHooks.setWebLocksOverride(null);
  authRefreshCoordinationTestHooks.setLocalStorageBroken(true);
  authRefreshCoordinationTestHooks.setTabIdForTests("degraded-tab");
  const out = await coordinateCrossTabRefresh(async () => ({ ok: true, status: 200 }));
  assert(out.ok, "LS-broken", "degraded mode still completes refresh (per-tab singleton only)");
}

await testA();
await testB();
await testC();
await testD();
await testE();
await testF();
await testF2();
await testF3();
await testG();
await testH();
await testI();
testJ();
await testK();
await testLocalStorageBroken();

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} [${r.id}] ${r.detail}`);
}
if (failed.length > 0) {
  console.error(`auth-refresh-coordination-runtime: ${failed.length} failed`);
  process.exit(1);
}
console.log(`auth-refresh-coordination-runtime: ok (${results.length} checks)`);
