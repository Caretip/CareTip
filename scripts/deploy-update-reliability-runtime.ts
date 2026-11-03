/**
 * Deployment update reliability: build version, version detection, safe reload policy, blockers,
 * stale-chunk recovery and multi-tab coordination. Pure modules with injected fakes — no network,
 * no database, no browser.
 * Run: npm run test:deploy-update-reliability
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deployVersionJson,
  resolveDeployBuildInfo,
} from "./deploy-build-version.mjs";
import { isChunkLoadFailure } from "../src/app/lib/chunkLoadRecovery";
import { isValidDeployVersion, isVersionedBuild, runningDeployBuild } from "../src/app/lib/deployUpdate/buildInfo";
import { fetchDeployedVersion, type DeployVersionCheckResult } from "../src/app/lib/deployUpdate/versionCheck";
import {
  acquireUpdateBlocker,
  getActiveUpdateBlockers,
  resetUpdateBlockersForTests,
  setUpdateBlockerExpiredHandler,
  subscribeUpdateBlockers,
  withUpdateBlocker,
} from "../src/app/lib/deployUpdate/updateBlockers";
import {
  inFlightMutationRequestCount,
  installMutationRequestTracker,
  isMutationRequestSettling,
  MUTATION_SETTLE_GRACE_MS,
  resetMutationRequestTrackerForTests,
  subscribeMutationRequests,
} from "../src/app/lib/deployUpdate/mutationRequestTracker";
import { createAgeLimitedSignal } from "../src/app/lib/deployUpdate/ageLimitedSignal";
import { deployUpdateRouteDeferReason, isGuestTipFlowRoute } from "../src/app/lib/deployUpdate/routePolicy";
import {
  CHUNK_RECOVERY_KEY,
  createDeployUpdateCoordinator,
  MANUAL_RELOAD_KEY,
  parseCrossTabMessage,
  RELOAD_BUDGET_KEY,
  SHARED_CHECK_KEY,
  type CrossTabChannel,
  type CrossTabMessage,
  type DeployUpdateNotice,
  type StorageLike,
} from "../src/app/lib/deployUpdate/updateCoordinator";
import { createDeployUpdateChannel, DEPLOY_UPDATE_FALLBACK_KEY } from "../src/app/lib/deployUpdate/crossTabChannel";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

const flush = async (rounds = 5) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

/** In-memory broadcast bus shared by fake tabs. */
function createBus() {
  const subscribers = new Set<(message: CrossTabMessage) => void>();
  return {
    channel(): CrossTabChannel {
      const own = new Set<(message: CrossTabMessage) => void>();
      return {
        post(message) {
          subscribers.forEach((handler) => {
            if (!own.has(handler)) handler(structuredClone(message));
          });
        },
        subscribe(handler) {
          own.add(handler);
          subscribers.add(handler);
          return () => {
            own.delete(handler);
            subscribers.delete(handler);
          };
        },
        close() {
          own.forEach((handler) => subscribers.delete(handler));
          own.clear();
        },
      };
    },
    size: () => subscribers.size,
  };
}

type TabOptions = {
  running?: string;
  deployed?: string | DeployVersionCheckResult;
  localStore?: StorageLike | null;
  sessionStore?: StorageLike | null;
  channel?: CrossTabChannel | null;
  clock?: { now: number };
  visible?: boolean;
  onPrepare?: () => void;
  /** Replaces `state.blockReason` (e.g. to drive the real mutation tracker). */
  blockReason?: () => string | null;
};

function createTab(options: TabOptions = {}) {
  const clock = options.clock ?? { now: 1_700_000_000_000 };
  const state = {
    visible: options.visible ?? true,
    online: true,
    focused: false,
    blockReason: null as string | null,
    routeReason: null as string | null,
    quiet: false,
    deployed: options.deployed ?? "v1-build1",
  };
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const intervals = new Map<number, () => void>();
  const timeouts: Array<() => void> = [];
  let nextHandle = 1;
  const reloads: string[] = [];
  const notices: DeployUpdateNotice[] = [];
  const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  let fetchCalls = 0;
  let gate: Promise<void> | null = null;
  let prepareCalls = 0;

  const coordinator = createDeployUpdateCoordinator({
    runningVersion: options.running ?? "v1-build1",
    async fetchVersion() {
      fetchCalls += 1;
      if (gate) await gate;
      const deployed = state.deployed;
      return typeof deployed === "string" ? { ok: true, version: deployed, buildTime: null } : deployed;
    },
    now: () => clock.now,
    timers: {
      setTimeout(handler) {
        timeouts.push(handler);
        return 0;
      },
      clearTimeout: () => {},
      setInterval(handler) {
        const handle = nextHandle++;
        intervals.set(handle, handler);
        return handle;
      },
      clearInterval(handle) {
        intervals.delete(handle as number);
      },
    },
    env: {
      isVisible: () => state.visible,
      isOnline: () => state.online,
      hasFocusedEditable: () => state.focused,
      listen(target, type, handler) {
        const key = `${target}:${type}`;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key)!.add(handler);
        return () => listeners.get(key)!.delete(handler);
      },
    },
    localStore: options.localStore === undefined ? new MemoryStorage() : options.localStore,
    sessionStore: options.sessionStore === undefined ? new MemoryStorage() : options.sessionStore,
    channel: options.channel ?? null,
    reload: () => reloads.push("reload"),
    getBlockReason: () => options.blockReason?.() ?? state.blockReason,
    getRouteDeferReason: () => state.routeReason,
    isQuietRoute: () => state.quiet,
    async prepareReload() {
      prepareCalls += 1;
      options.onPrepare?.();
    },
    notify: (notice) => notices.push(notice),
    log: (event, fields) => logs.push({ event, fields }),
  });

  return {
    coordinator,
    state,
    clock,
    reloads,
    notices,
    logs,
    timeouts,
    get fetchCalls() {
      return fetchCalls;
    },
    get prepareCalls() {
      return prepareCalls;
    },
    hold() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = () => {
          gate = null;
          resolve();
        };
      });
      return release;
    },
    dispatch(target: "window" | "document", type: string, event: Partial<Event> & Record<string, unknown> = {}) {
      listeners.get(`${target}:${type}`)?.forEach((handler) => handler(event as Event));
    },
    listenerCount() {
      let count = 0;
      listeners.forEach((set) => (count += set.size));
      return count;
    },
    intervalCount: () => intervals.size,
    async tick() {
      [...intervals.values()].forEach((handler) => handler());
      await flush();
    },
    idle(ms = 6 * 60_000) {
      clock.now += ms;
    },
  };
}

console.log("deploy-update-reliability-runtime");

// ---------------------------------------------------------------- A. version generation
await test("A1 Netlify build uses commit SHA + build id", () => {
  const info = resolveDeployBuildInfo({
    env: { COMMIT_REF: "0123456789abcdef0123456789abcdef01234567", BUILD_ID: "65f1c0ffee" },
    now: new Date("2026-11-02T12:00:00.000Z"),
  });
  assert.equal(info.version, "0123456789ab-65f1c0ffee");
  assert.equal(info.buildTime, "2026-11-02T12:00:00.000Z");
  assert.ok(isValidDeployVersion(info.version));
});

await test("A2 version differs between commits and between builds of the same commit", () => {
  const a = resolveDeployBuildInfo({ env: { COMMIT_REF: "a".repeat(40), BUILD_ID: "b1" } });
  const b = resolveDeployBuildInfo({ env: { COMMIT_REF: "b".repeat(40), BUILD_ID: "b1" } });
  const c = resolveDeployBuildInfo({ env: { COMMIT_REF: "a".repeat(40), BUILD_ID: "b2" } });
  assert.notEqual(a.version, b.version);
  assert.notEqual(a.version, c.version);
});

await test("A3 local fallback: git SHA or 'local' plus a per-build timestamp", () => {
  const t1 = new Date("2026-11-02T12:00:00.000Z");
  const t2 = new Date("2026-11-02T12:00:01.000Z");
  const withGit = resolveDeployBuildInfo({ env: {}, gitSha: "c".repeat(40), now: t1 });
  assert.match(withGit.version, /^cccccccccccc-[0-9a-z]+$/);
  const noGit1 = resolveDeployBuildInfo({ env: {}, now: t1 });
  const noGit2 = resolveDeployBuildInfo({ env: {}, now: t2 });
  assert.match(noGit1.version, /^local-[0-9a-z]+$/);
  assert.notEqual(noGit1.version, noGit2.version);
  assert.ok(!Number.isNaN(Date.parse(noGit1.buildTime)));
});

await test("A4 untrusted env characters are stripped; version.json has only version + buildTime", () => {
  const info = resolveDeployBuildInfo({ env: { COMMIT_REF: "abc<script>", BUILD_ID: "x y/../z" } });
  assert.equal(info.version, "abcscript-xy..z");
  const json = JSON.parse(deployVersionJson(info));
  assert.deepEqual(Object.keys(json).sort(), ["buildTime", "version"]);
});

await test("A5 unversioned bundle (dev / test loader) reports 'dev' and disables polling", () => {
  assert.equal(runningDeployBuild().version, "dev");
  assert.equal(isVersionedBuild("dev"), false);
  assert.equal(isVersionedBuild("0123456789ab-65f1c0ffee"), true);
});

// ---------------------------------------------------------------- B. version check + detection
const jsonResponse = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

await test("B1 fetchDeployedVersion: valid JSON, cache disabled, no credentials", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const result = await fetchDeployedVersion({
    fetchImpl: async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return jsonResponse({ version: "v2-b2", buildTime: "2026-11-02T12:00:00.000Z" });
    },
    now: () => 42,
  });
  assert.deepEqual(result, { ok: true, version: "v2-b2", buildTime: "2026-11-02T12:00:00.000Z" });
  assert.equal(seenUrl, "/version.json?t=42");
  assert.equal(seenInit?.cache, "no-store");
  assert.equal(seenInit?.credentials, "omit");
});

await test("B2 fetchDeployedVersion: HTML fallback, bad shape, HTTP error, network and timeout are typed failures", async () => {
  const html = await fetchDeployedVersion({ fetchImpl: async () => jsonResponse("<!DOCTYPE html><html>") });
  assert.deepEqual(html, { ok: false, reason: "invalid" });
  const shape = await fetchDeployedVersion({ fetchImpl: async () => jsonResponse({ version: "bad version!" }) });
  assert.deepEqual(shape, { ok: false, reason: "invalid" });
  const http = await fetchDeployedVersion({ fetchImpl: async () => jsonResponse({}, 503) });
  assert.deepEqual(http, { ok: false, reason: "http", status: 503 });
  const network = await fetchDeployedVersion({
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  assert.deepEqual(network, { ok: false, reason: "network" });
  const timeout = await fetchDeployedVersion({
    timeoutMs: 20,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  });
  assert.deepEqual(timeout, { ok: false, reason: "timeout" });
});

await test("B3 matching version: no update, no reload, no notice", async () => {
  const tab = createTab({ deployed: "v1-build1" });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.fetchCalls, 1);
  assert.equal(tab.coordinator.getState().pendingVersion, null);
  assert.equal(tab.reloads.length, 0);
  assert.equal(tab.notices.length, 0);
});

await test("B4 different version: update detected", async () => {
  const tab = createTab({ deployed: "v2-build2" });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.coordinator.getState().pendingVersion, "v2-build2");
  assert.ok(tab.logs.some((l) => l.event === "update_detected"));
});

await test("B5 network failure and invalid response never mark an update or reload", async () => {
  for (const failure of [
    { ok: false, reason: "network" },
    { ok: false, reason: "invalid" },
    { ok: false, reason: "http", status: 404 },
    { ok: false, reason: "timeout" },
  ] as DeployVersionCheckResult[]) {
    const tab = createTab({ deployed: failure, visible: false });
    tab.coordinator.start();
    await flush();
    await tab.tick();
    assert.equal(tab.coordinator.getState().pendingVersion, null);
    assert.equal(tab.reloads.length, 0);
    assert.ok(tab.logs.some((l) => l.event === "version_check_failed"));
  }
});

await test("B6 checks never overlap", async () => {
  const tab = createTab({ deployed: "v1-build1" });
  const release = tab.hold();
  tab.coordinator.start();
  const second = tab.coordinator.checkNow("interval", { bypassShared: true });
  const third = tab.coordinator.checkNow("visible", { bypassShared: true });
  assert.equal(tab.fetchCalls, 1);
  release();
  await Promise.all([second, third]);
  assert.equal(tab.fetchCalls, 1);
});

await test("B7 polling every interval and on visibility return; skipped while offline", async () => {
  const clock = { now: 1_700_000_000_000 };
  const tab = createTab({ deployed: "v1-build1", localStore: null, clock });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.fetchCalls, 1);
  await tab.tick();
  assert.equal(tab.fetchCalls, 2);
  tab.state.visible = false;
  tab.dispatch("document", "visibilitychange");
  tab.state.visible = true;
  tab.dispatch("document", "visibilitychange");
  await flush();
  assert.equal(tab.fetchCalls, 3);
  tab.state.online = false;
  await tab.tick();
  assert.equal(tab.fetchCalls, 3, "offline: no request");
  tab.state.online = true;
  tab.dispatch("window", "online");
  await flush();
  assert.equal(tab.fetchCalls, 4);
});

await test("B8 hidden (suspended) tab checks only every 5 minutes", async () => {
  const clock = { now: 1_700_000_000_000 };
  const tab = createTab({ deployed: "v1-build1", localStore: null, clock, visible: false });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.fetchCalls, 1);
  clock.now += 60_000;
  await tab.tick();
  assert.equal(tab.fetchCalls, 1);
  clock.now += 4 * 60_000;
  await tab.tick();
  assert.equal(tab.fetchCalls, 2);
});

await test("B9 start is idempotent (Strict Mode) and stop removes every listener and timer", async () => {
  const tab = createTab();
  tab.coordinator.start();
  const listenersAfterFirst = tab.listenerCount();
  tab.coordinator.start();
  assert.equal(tab.intervalCount(), 1);
  assert.equal(tab.listenerCount(), listenersAfterFirst);
  tab.coordinator.stop();
  assert.equal(tab.intervalCount(), 0);
  assert.equal(tab.listenerCount(), 0);
  await tab.coordinator.checkNow("interval", { bypassShared: true });
  assert.equal(tab.fetchCalls, 1, "no checks after stop");
});

// ---------------------------------------------------------------- C. safe reload + blockers
await test("C1 safe idle application reloads (hidden tab)", async () => {
  const tab = createTab({ deployed: "v2-build2", visible: false });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.reloads.length, 1);
  assert.equal(tab.prepareCalls, 1, "service worker asked to update first");
  assert.equal(tab.notices.length, 0);
});

await test("C2 active visible user: deferred with a single notice; idle or navigation applies it", async () => {
  const tab = createTab({ deployed: "v2-build2" });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.reloads.length, 0);
  assert.deepEqual(tab.notices, [{ kind: "deferred", version: "v2-build2" }]);
  await tab.tick();
  await tab.tick();
  assert.equal(tab.notices.length, 1, "notice not repeated");
  tab.state.focused = true;
  tab.idle();
  await tab.tick();
  assert.equal(tab.reloads.length, 0, "focused field blocks idle reload");
  tab.state.focused = false;
  await tab.tick();
  assert.equal(tab.reloads.length, 1, "idle without focus reloads");
});

await test("C3 committed navigation is a safe point", async () => {
  const tab = createTab({ deployed: "v2-build2" });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.reloads.length, 0);
  tab.coordinator.onRouteChange();
  await flush();
  assert.equal(tab.reloads.length, 1);
});

await test("C4 explicit blockers defer; overlapping blockers; release of the last one reloads", async () => {
  resetUpdateBlockersForTests();
  const tab = createTab({ deployed: "v2-build2", visible: false });
  tab.state.blockReason = null;
  const syncBlock = () => {
    const blockers = getActiveUpdateBlockers();
    tab.state.blockReason = blockers.length ? `blocker:${blockers[0]!.name}` : null;
  };
  subscribeUpdateBlockers(() => {
    syncBlock();
    tab.coordinator.reevaluate();
  });
  const releaseA = acquireUpdateBlocker("form:business-profile-save");
  const releaseB = acquireUpdateBlocker("upload:kyc-document");
  syncBlock();
  tab.coordinator.start();
  await flush();
  assert.equal(tab.reloads.length, 0);
  assert.ok(tab.logs.some((l) => l.event === "update_deferred" && l.fields?.reason === "blocker:form:business-profile-save"));
  releaseA();
  releaseA();
  await flush();
  assert.equal(tab.reloads.length, 0, "second blocker still active");
  releaseB();
  await flush();
  assert.equal(tab.reloads.length, 1);
  resetUpdateBlockersForTests();
});

await test("C5 withUpdateBlocker releases on error; stale blockers expire", async () => {
  const clock = { now: 0 };
  resetUpdateBlockersForTests(() => clock.now);
  await assert.rejects(
    withUpdateBlocker("payout:create", async () => {
      assert.equal(getActiveUpdateBlockers().length, 1);
      throw new Error("payout failed");
    }),
  );
  assert.equal(getActiveUpdateBlockers().length, 0, "released on error path");
  const expired: string[] = [];
  setUpdateBlockerExpiredHandler((info) => expired.push(info.name));
  acquireUpdateBlocker("form:abandoned", { ttlMs: 1_000 });
  acquireUpdateBlocker("form:capped", { ttlMs: 10 * 60 * 60_000 });
  clock.now = 1_001;
  assert.deepEqual(getActiveUpdateBlockers().map((b) => b.name), ["form:capped"]);
  assert.deepEqual(expired, ["form:abandoned"]);
  clock.now = 30 * 60_000 + 1;
  assert.equal(getActiveUpdateBlockers().length, 0, "TTL capped at 30 minutes");
  resetUpdateBlockersForTests();
});

await test("C6 payment, auth and critical-form system blockers prevent reload; manual refresh waits for them", async () => {
  for (const reason of [
    "payment:stripe-redirect",
    "auth:refresh",
    "auth:post-login",
    "auth:logout",
    "request:mutation",
    "request:mutation-settling",
    "blocker:payment:guest-tip-checkout",
  ]) {
    const tab = createTab({ deployed: "v2-build2", visible: false });
    tab.state.blockReason = reason;
    tab.coordinator.start();
    await flush();
    tab.coordinator.onRouteChange();
    await tab.tick();
    assert.equal(tab.reloads.length, 0, reason);
    assert.equal(tab.notices.length, 1);
    tab.coordinator.reloadNow();
    await flush();
    assert.equal(tab.reloads.length, 0, `${reason}: "Refresh now" must not abort the operation`);
    tab.state.blockReason = null;
    tab.coordinator.reevaluate();
    await flush();
    assert.equal(tab.reloads.length, 1, `${reason}: manual refresh runs once released`);
  }
});

await test("C7 blocker that appears while the SW prepares aborts the reload", async () => {
  const tab = createTab({
    deployed: "v2-build2",
    visible: false,
    onPrepare: () => {
      if (tab.prepareCalls === 1) tab.state.blockReason = "request:mutation";
    },
  });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.prepareCalls, 1);
  assert.equal(tab.reloads.length, 0);
  assert.equal(tab.coordinator.getState().reloading, false);
  assert.ok(tab.logs.some((l) => l.event === "reload_aborted"));
  tab.state.blockReason = null;
  tab.coordinator.reevaluate();
  await flush();
  assert.equal(tab.reloads.length, 1, "retried once the request settled");
});

await test("C8 typed form input defers hidden/idle reloads until navigation; lapses after a long absence", async () => {
  const tab = createTab({ deployed: "v2-build2" });
  tab.coordinator.start();
  await flush();
  tab.dispatch("document", "input", { target: { tagName: "TEXTAREA" } });
  tab.state.visible = false;
  tab.dispatch("document", "visibilitychange");
  await flush();
  assert.equal(tab.reloads.length, 0, "unsaved input protected while hidden");
  tab.coordinator.onRouteChange();
  await flush();
  assert.equal(tab.reloads.length, 1, "navigation discards the old page anyway");

  const abandoned = createTab({ deployed: "v2-build2" });
  abandoned.coordinator.start();
  await flush();
  abandoned.dispatch("document", "input", { target: { tagName: "INPUT" } });
  abandoned.state.visible = false;
  abandoned.idle(31 * 60_000);
  await abandoned.tick();
  assert.equal(abandoned.reloads.length, 1, "abandoned form does not block forever");
});

await test("C9 sensitive routes defer; guest tip journey shows no notice", async () => {
  const tab = createTab({ deployed: "v2-build2", visible: false });
  tab.state.routeReason = "route:payment-return";
  tab.coordinator.start();
  await flush();
  assert.equal(tab.reloads.length, 0);
  assert.equal(tab.notices.length, 1);
  tab.state.routeReason = null;
  tab.coordinator.onRouteChange();
  await flush();
  assert.equal(tab.reloads.length, 1);

  const guest = createTab({ deployed: "v2-build2" });
  guest.state.routeReason = "route:guest-tip-flow";
  guest.state.quiet = true;
  guest.coordinator.start();
  await flush();
  assert.equal(guest.notices.length, 0);
});

await test("C10 reload loop guard: at most two automatic reloads per version per tab session", async () => {
  const session = new MemoryStorage();
  const clock = { now: 1_700_000_000_000 };
  let reloads = 0;
  for (let page = 0; page < 4; page += 1) {
    // Simulates a stale HTML response after each reload: running version stays v1.
    const tab = createTab({ deployed: "v2-build2", visible: false, sessionStore: session, clock });
    tab.coordinator.start();
    await flush();
    reloads += tab.reloads.length;
    if (page >= 2) {
      assert.equal(tab.reloads.length, 0);
      assert.ok(tab.logs.some((l) => l.event === "reload_suppressed"));
      assert.equal(tab.notices.length, 1, "manual refresh offered instead");
    }
  }
  assert.equal(reloads, 2);
  assert.equal(JSON.parse(session.getItem(RELOAD_BUDGET_KEY)!).count, 2);
});

await test("C11 without sessionStorage no automatic reload happens (loop guard cannot persist)", async () => {
  const tab = createTab({ deployed: "v2-build2", visible: false, sessionStore: null });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.reloads.length, 0);
  assert.equal(tab.notices.length, 1);
});

await test("C12 rollback to the running version clears a pending update and its notice", async () => {
  const tab = createTab({ deployed: "v2-build2", localStore: null });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.notices.length, 1);
  tab.state.deployed = "v1-build1";
  await tab.tick();
  assert.equal(tab.coordinator.getState().pendingVersion, null);
  assert.deepEqual(tab.notices.at(-1), { kind: "cleared" });
});

await test("C13 mutation tracker: counts POST/PUT/DELETE in flight, ignores GET, forwards results and errors", async () => {
  const clock = { now: 0 };
  resetMutationRequestTrackerForTests(() => clock.now);
  const resolvers: Array<(r: Response) => void> = [];
  const calls: Array<[unknown, RequestInit | undefined]> = [];
  const target = {
    fetch: ((input: unknown, init?: RequestInit) => {
      calls.push([input, init]);
      if (init?.method === "DELETE") return Promise.reject(new TypeError("Failed to fetch"));
      return new Promise<Response>((resolve) => resolvers.push(resolve));
    }) as typeof fetch,
  };
  installMutationRequestTracker(target);
  const get = target.fetch("/api/me");
  assert.equal(inFlightMutationRequestCount(), 0);
  const body = new FormData();
  const post = target.fetch("/api/business/kyc/documents", { method: "post", body });
  assert.equal(inFlightMutationRequestCount(), 1);
  assert.equal(calls[1]![1]!.body, body, "arguments forwarded unchanged");
  await assert.rejects(target.fetch("/api/x", { method: "DELETE" }), /Failed to fetch/);
  await flush();
  assert.equal(inFlightMutationRequestCount(), 1, "rejected request released");
  clock.now = 3 * 60_000;
  assert.equal(inFlightMutationRequestCount(), 0, "hung request stops blocking after 2 minutes");
  clock.now = 0;
  resolvers[1]!(new Response("ok"));
  assert.equal(await (await post).text(), "ok");
  await flush();
  resolvers[0]!(new Response("me"));
  await get;
  assert.equal(inFlightMutationRequestCount(), 0);
  resetMutationRequestTrackerForTests();
  assert.notEqual(typeof target.fetch, "undefined");
});

await test("C14 route policy", () => {
  assert.equal(deployUpdateRouteDeferReason("/dashboard", ""), null);
  assert.equal(deployUpdateRouteDeferReason("/dashboard/settings", "?section=business"), null);
  assert.equal(deployUpdateRouteDeferReason("/payment", ""), "route:guest-tip-flow");
  assert.equal(deployUpdateRouteDeferReason("/success", "?session_id=cs_test"), "route:guest-tip-flow");
  assert.equal(deployUpdateRouteDeferReason("/qr/table/abc", ""), "route:guest-tip-flow");
  assert.equal(deployUpdateRouteDeferReason("/qr-landing/biz", ""), "route:guest-tip-flow");
  assert.equal(deployUpdateRouteDeferReason("/payments-overview", ""), null, "prefix boundary");
  assert.equal(deployUpdateRouteDeferReason("/auth/facebook/complete", "?success=1"), "route:callback");
  assert.equal(deployUpdateRouteDeferReason("/reset-password/tok", ""), "route:callback");
  assert.equal(deployUpdateRouteDeferReason("/subscription/success", "?session_id=x"), "route:callback");
  assert.equal(deployUpdateRouteDeferReason("/dashboard/billing", "?billing=success&session_id=cs"), "route:payment-return");
  assert.equal(deployUpdateRouteDeferReason("/employee/settings", "?payoutConnect=return"), "route:payment-return");
  assert.equal(deployUpdateRouteDeferReason("/dashboard/qr-studio/orders/1", "?checkout=success"), "route:payment-return");
  assert.equal(isGuestTipFlowRoute("/tip-amount/"), true);
  assert.equal(isGuestTipFlowRoute("/dashboard"), false);
});

// ---------------------------------------------------------------- D. chunk recovery
await test("D1 chunk failure classification (incl. Vite CSS preload); ordinary errors excluded", () => {
  assert.ok(isChunkLoadFailure(new TypeError("Failed to fetch dynamically imported module: https://caretip.de/assets/a.js")));
  assert.ok(isChunkLoadFailure(new TypeError("Importing a module script failed.")));
  assert.ok(isChunkLoadFailure(new TypeError("error loading dynamically imported module")));
  assert.ok(isChunkLoadFailure(new Error("Unable to preload CSS for /assets/dashboard-1a2b.css")));
  assert.equal(isChunkLoadFailure(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
  assert.equal(isChunkLoadFailure(new Error("Request failed with status 500")), false);
});

await test("D2 newer deployment: exactly one reload, even on a sensitive route", async () => {
  const session = new MemoryStorage();
  const tab = createTab({ deployed: "v2-build2", sessionStore: session });
  tab.state.routeReason = "route:payment-return";
  const outcome = await tab.coordinator.recoverFromChunkFailure();
  assert.equal(outcome, "reloading");
  await flush();
  assert.equal(tab.reloads.length, 1);
  assert.equal(JSON.parse(session.getItem(CHUNK_RECOVERY_KEY)!).transition, "v1-build1->v2-build2");
});

await test("D3 same transition after reload (stale HTML) does not reload again", async () => {
  const session = new MemoryStorage();
  const first = createTab({ deployed: "v2-build2", sessionStore: session });
  await first.coordinator.recoverFromChunkFailure();
  await flush();
  const afterReload = createTab({ deployed: "v2-build2", sessionStore: session });
  assert.equal(await afterReload.coordinator.recoverFromChunkFailure(), "already-attempted");
  await flush();
  assert.equal(afterReload.reloads.length, 0);
});

await test("D4 same version, failed check or no sessionStorage: no reload (route error UI is the fallback)", async () => {
  const same = createTab({ deployed: "v1-build1" });
  assert.equal(await same.coordinator.recoverFromChunkFailure(), "same-version");
  const offline = createTab({ deployed: { ok: false, reason: "network" } });
  assert.equal(await offline.coordinator.recoverFromChunkFailure(), "check-failed");
  const noSession = createTab({ deployed: "v2-build2", sessionStore: null });
  assert.equal(await noSession.coordinator.recoverFromChunkFailure(), "check-failed");
  await flush();
  assert.equal(same.reloads.length + offline.reloads.length + noSession.reloads.length, 0);
});

await test("D5 concurrent chunk failures share one check; explicit blockers still defer the reload", async () => {
  const tab = createTab({ deployed: "v2-build2" });
  tab.state.blockReason = "auth:refresh";
  const [a, b] = await Promise.all([
    tab.coordinator.recoverFromChunkFailure(),
    tab.coordinator.recoverFromChunkFailure(),
  ]);
  assert.equal(a, "deferred");
  assert.equal(b, "deferred");
  assert.equal(tab.fetchCalls, 1);
  assert.equal(tab.reloads.length, 0);
  tab.state.blockReason = null;
  tab.coordinator.reevaluate();
  await flush();
  assert.equal(tab.reloads.length, 1, "refresh finished → recovery reload");
});

await test("D6 unversioned build is left to the legacy cooldown path", async () => {
  const tab = createTab({ running: "dev", deployed: "v2-build2" });
  assert.equal(await tab.coordinator.recoverFromChunkFailure(), "unversioned");
  assert.equal(tab.fetchCalls, 0);
});

// ---------------------------------------------------------------- E. multi-tab
await test("E1 one tab's confirmed check reaches other tabs without extra requests", async () => {
  const bus = createBus();
  const shared = new MemoryStorage();
  const a = createTab({ deployed: "v2-build2", localStore: shared, channel: bus.channel() });
  const b = createTab({ deployed: "v2-build2", localStore: shared, channel: bus.channel() });
  a.coordinator.start();
  await flush();
  assert.equal(a.fetchCalls, 1);
  await b.coordinator.checkNow("interval");
  assert.equal(b.fetchCalls, 0, "not started: no request");
  b.coordinator.start();
  await flush();
  // B's startup check bypasses the cache by design; its interval checks reuse the shared result.
  const before = b.fetchCalls;
  await b.tick();
  await b.tick();
  assert.equal(b.fetchCalls, before);
  assert.ok(b.logs.some((l) => l.event === "version_check_shared"));
  assert.equal(b.coordinator.getState().pendingVersion, "v2-build2");
});

await test("E2 cross-tab message alone marks the update in a running tab", async () => {
  const bus = createBus();
  const a = createTab({ deployed: "v1-build1", localStore: null, channel: bus.channel() });
  const b = createTab({ deployed: "v1-build1", localStore: null, channel: bus.channel(), visible: false });
  a.coordinator.start();
  b.coordinator.start();
  await flush();
  a.state.deployed = "v2-build2";
  await a.coordinator.checkNow("interval", { bypassShared: true });
  await flush();
  assert.equal(b.coordinator.getState().pendingVersion, "v2-build2");
  assert.equal(b.reloads.length, 1, "hidden tab B reloads itself");
  assert.equal(a.reloads.length, 0, "visible active tab A waits for a safe moment");
});

await test("E3 two tabs detecting simultaneously each reload once; no loop after reload", async () => {
  const bus = createBus();
  const sessions = [new MemoryStorage(), new MemoryStorage()];
  const tabs = sessions.map((s) => createTab({ deployed: "v2-build2", visible: false, sessionStore: s, channel: bus.channel() }));
  tabs.forEach((t) => t.coordinator.start());
  await flush();
  assert.deepEqual(tabs.map((t) => t.reloads.length), [1, 1]);
  const reloaded = sessions.map((s) => createTab({ running: "v2-build2", deployed: "v2-build2", visible: false, sessionStore: s, channel: bus.channel() }));
  reloaded.forEach((t) => t.coordinator.start());
  await flush();
  assert.deepEqual(reloaded.map((t) => t.reloads.length), [0, 0]);
});

await test("E4 a tab that closes unexpectedly or holds blockers cannot block other tabs", async () => {
  const bus = createBus();
  const a = createTab({ deployed: "v1-build1", localStore: null, channel: bus.channel() });
  a.state.blockReason = "blocker:upload:kyc-document";
  a.coordinator.start();
  await flush();
  // Tab A disappears without releasing anything.
  const b = createTab({ deployed: "v2-build2", localStore: null, channel: bus.channel(), visible: false });
  b.coordinator.start();
  await flush();
  assert.equal(b.reloads.length, 1);
  a.coordinator.stop();
  assert.equal(bus.size(), 1, "closed tab unsubscribed");
});

await test("E5 BroadcastChannel unavailable: storage-event fallback, or plain polling when storage is unavailable too", async () => {
  const store = new MemoryStorage();
  const handlers = new Set<(event: StorageEvent) => void>();
  const events = {
    addEventListener: (_t: "storage", h: (event: StorageEvent) => void) => handlers.add(h),
    removeEventListener: (_t: "storage", h: (event: StorageEvent) => void) => handlers.delete(h),
  };
  const channel = createDeployUpdateChannel({ BroadcastChannel: undefined, localStore: store, storageEvents: events });
  assert.ok(channel);
  const received: CrossTabMessage[] = [];
  const unsubscribe = channel!.subscribe((m) => received.push(m));
  channel!.post({ type: "version", version: "v2-build2", at: 1 });
  const raw = store.getItem(DEPLOY_UPDATE_FALLBACK_KEY)!;
  handlers.forEach((h) => h({ key: DEPLOY_UPDATE_FALLBACK_KEY, newValue: raw } as StorageEvent));
  handlers.forEach((h) => h({ key: DEPLOY_UPDATE_FALLBACK_KEY, newValue: '{"type":"version","version":"<bad>","at":1}' } as StorageEvent));
  handlers.forEach((h) => h({ key: "other", newValue: raw } as StorageEvent));
  assert.deepEqual(received.map((m) => m.version), ["v2-build2"]);
  unsubscribe();
  assert.equal(handlers.size, 0);
  assert.equal(createDeployUpdateChannel({ BroadcastChannel: undefined, localStore: null, storageEvents: null }), null);

  const solo = createTab({ deployed: "v2-build2", channel: null, localStore: null, visible: false });
  solo.coordinator.start();
  await flush();
  assert.equal(solo.reloads.length, 1, "coordination is not a single point of failure");
});

await test("E6 malformed cross-tab payloads and stale shared cache entries are ignored", async () => {
  assert.equal(parseCrossTabMessage({ type: "version", version: "v2", at: "x" }), null);
  assert.equal(parseCrossTabMessage({ type: "reload-all", version: "v2", at: 1 }), null);
  assert.equal(parseCrossTabMessage(null), null);
  const clock = { now: 1_700_000_000_000 };
  const shared = new MemoryStorage();
  const tab = createTab({ deployed: "v1-build1", localStore: shared, clock });
  tab.coordinator.start();
  await flush();
  shared.setItem(SHARED_CHECK_KEY, JSON.stringify({ version: "v9-old", at: clock.now - 10 * 60_000 }));
  clock.now += 1_000;
  await tab.tick();
  assert.equal(tab.coordinator.getState().pendingVersion, null);
  assert.equal(tab.fetchCalls, 2, "stale cache entry triggers a real request");
});

// ---------------------------------------------------------------- F. configuration and preservation contracts
await test("F1 Netlify headers: HTML revalidates, version.json no-store, hashed assets immutable, no global Cache-Control", () => {
  const headers = read("public/_headers");
  const block = (selector: string) => {
    const match = headers.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\n((?:  .+\\n?)+)`, "m"));
    return match ? match[1]! : "";
  };
  assert.match(block("/assets/*"), /Cache-Control: public, max-age=31536000, immutable/);
  assert.match(block("/"), /Cache-Control: no-cache, must-revalidate/);
  assert.match(block("/index.html"), /Cache-Control: no-cache, must-revalidate/);
  assert.match(block("/version.json"), /Cache-Control: no-store, no-cache, must-revalidate/);
  assert.doesNotMatch(block("/index.html"), /immutable/);
  assert.doesNotMatch(block("/*"), /Cache-Control/, "catch-all must not add Cache-Control (Netlify would merge it into /assets)");
  for (const header of ["Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) {
    assert.match(block("/*"), new RegExp(header), `${header} preserved`);
  }
});

await test("F2 Netlify redirects: missing assets 404 before the SPA fallback; API proxy and crawler rules kept", () => {
  const lines = read("public/_redirects").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  const idx = (prefix: string) => lines.findIndex((l) => l.replace(/\s+/g, " ").startsWith(prefix));
  assert.ok(idx("/assets/* /404.html 404") >= 0);
  assert.ok(idx("/assets/* /404.html 404") < idx("/* /index.html 200"));
  assert.ok(idx("/api/* https://caretip.onrender.com/api/:splat 200") >= 0);
  assert.ok(idx("/robots.txt /robots.txt 200") >= 0);
  assert.equal(lines.at(-1)!.replace(/\s+/g, " "), "/* /index.html 200");
  assert.doesNotMatch(read("netlify.toml"), /\[\[headers\]\]/, "single authoritative header file");
});

await test("F3 build wiring: version define + version.json emitted + excluded from SW precache", () => {
  const vite = read("vite.config.ts");
  assert.match(vite, /__CARETIP_BUILD_VERSION__: JSON\.stringify\(deployBuild\.version\)/);
  assert.match(vite, /deployVersionPlugin\(deployBuild\)/);
  assert.match(vite, /globIgnores: \[\s*\n\s*\/\*\*[^\n]*\*\/\s*\n\s*'version\.json',\s*\n\s*'404\.html'/);
  assert.match(vite, /registerType: 'autoUpdate'/, "SW update path unchanged");
});

await test("F4 SW reload goes through the coordinator; preload errors no longer reload unconditionally", () => {
  const main = read("src/main.tsx");
  assert.match(main, /addEventListener\("vite:preloadError", handleVitePreloadError\)/);
  assert.doesNotMatch(main, /onNeedRefresh/);
  assert.doesNotMatch(main, /recoverStaleChunkOnce/);
  const sw = read("src/app/lib/deployUpdate/serviceWorkerRegistration.ts");
  assert.match(sw, /onNeedReload: handleServiceWorkerUpdated/);
  assert.doesNotMatch(read("src/app/lib/deferredStartup.ts"), /onNeedRefresh/);
});

await test("F5 update system never touches cookies, storage wipes, tokens, logout or Stripe APIs", () => {
  const files = [
    "buildInfo.ts",
    "versionCheck.ts",
    "updateBlockers.ts",
    "useUpdateBlocker.ts",
    "mutationRequestTracker.ts",
    "routePolicy.ts",
    "updateCoordinator.ts",
    "crossTabChannel.ts",
    "runtime.ts",
    "serviceWorkerRegistration.ts",
    "ageLimitedSignal.ts",
  ].map((f) => read(`src/app/lib/deployUpdate/${f}`));
  const all = files.join("\n");
  for (const forbidden of [
    /document\.cookie/,
    /localStorage\.clear|sessionStorage\.clear/,
    /caches\.delete|caches\.keys/,
    /logoutAPI|\blogout\(|revoke/i,
    /setToken|clearToken|accessToken/,
    /Authorization/,
    /stripe\.com|createTipCheckoutSession/,
    /location\.assign|location\.href\s*=/,
  ]) {
    assert.doesNotMatch(all, forbidden, String(forbidden));
  }
  assert.match(read("src/app/lib/deployUpdate/runtime.ts"), /reload: \(\) => window\.location\.reload\(\)/, "reload keeps URL and history state");
});

await test("F6 api.ts change is a read-only refresh probe", () => {
  const api = read("src/app/lib/api.ts");
  assert.match(api, /export function isSessionRefreshInFlight\(\): boolean \{\n  return refreshSingleton !== null;\n\}/);
});

await test("F7 guest tip checkout holds a payment blocker released in finally", () => {
  const src = read("src/app/lib/startGuestTipCheckout.ts");
  assert.match(src, /acquireUpdateBlocker\("payment:guest-tip-checkout"/);
  assert.match(src, /\} finally \{\n    releaseUpdateBlocker\(\);\n  \}/);
});

await test("F8 notice copy exists in English and German", () => {
  const en = JSON.parse(read("src/i18n/locales/en.json")).shell.deployUpdate;
  const de = JSON.parse(read("src/i18n/locales/de.json")).shell.deployUpdate;
  assert.equal(en.title, "CareTip has been updated.");
  assert.equal(en.description, "We'll refresh automatically when it's safe.");
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  assert.ok(de.title && de.description && de.refreshNow && de.manualDescription);
  assert.doesNotMatch(en.manualDescription, /automatic/i, "manual notice must not promise an automatic refresh");
  assert.doesNotMatch(de.manualDescription, /automatisch/i, "manual notice must not promise an automatic refresh");
});

// ---------------------------------------------------------------- G. independent review fixes
await test("G1 notice says 'automatic' only while an automatic reload is still possible", async () => {
  const deferred = createTab({ deployed: "v2-build2" });
  deferred.coordinator.start();
  await flush();
  assert.deepEqual(deferred.notices, [{ kind: "deferred", version: "v2-build2" }]);

  const noSession = createTab({ deployed: "v2-build2", sessionStore: null });
  noSession.coordinator.start();
  await flush();
  assert.deepEqual(noSession.notices, [{ kind: "manual", version: "v2-build2" }]);

  // Deferred notice upgrades to manual once the loop guard is spent (same toast id → replaced, not stacked).
  const session = new MemoryStorage();
  session.setItem(RELOAD_BUDGET_KEY, JSON.stringify({ version: "v2-build2", count: 1, at: 0 }));
  const tab = createTab({ deployed: "v2-build2", sessionStore: session });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.notices.at(-1)!.kind, "deferred");
  tab.coordinator.onRouteChange();
  await flush();
  assert.equal(tab.reloads.length, 1);
  const afterReload = createTab({ deployed: "v2-build2", sessionStore: session });
  afterReload.coordinator.start();
  await flush();
  assert.deepEqual(afterReload.notices, [{ kind: "manual", version: "v2-build2" }]);
  afterReload.coordinator.onRouteChange();
  await afterReload.tick();
  assert.equal(afterReload.notices.length, 1, "no duplicate notices");

  const runtime = read("src/app/lib/deployUpdate/runtime.ts");
  assert.match(runtime, /notice\.kind === "manual" \? "shell\.deployUpdate\.manualDescription" : "shell\.deployUpdate\.description"/);
});

await test("G2 loop guard does not reset with time: no periodic reloads when the new shell never arrives", async () => {
  const session = new MemoryStorage();
  const clock = { now: 1_700_000_000_000 };
  let reloads = 0;
  for (let page = 0; page < 6; page += 1) {
    const tab = createTab({ deployed: "v2-build2", visible: false, sessionStore: session, clock });
    tab.coordinator.start();
    await flush();
    reloads += tab.reloads.length;
    clock.now += 31 * 60_000;
  }
  assert.equal(reloads, 2);
  // A different deployed version gets a fresh budget.
  const next = createTab({ deployed: "v3-build3", visible: false, sessionStore: session, clock });
  next.coordinator.start();
  await flush();
  assert.equal(next.reloads.length, 1);
});

await test("G3 'Refresh now' bypasses route, idle and loop-guard rules but not blockers", async () => {
  const session = new MemoryStorage();
  session.setItem(RELOAD_BUDGET_KEY, JSON.stringify({ version: "v2-build2", count: 2, at: 0 }));
  const tab = createTab({ deployed: "v2-build2", sessionStore: session });
  tab.state.routeReason = "route:payment-return";
  tab.coordinator.start();
  await flush();
  assert.equal(tab.reloads.length, 0);
  tab.state.blockReason = "blocker:payment:guest-tip-checkout";
  tab.coordinator.reloadNow();
  tab.coordinator.reloadNow();
  await flush();
  assert.equal(tab.reloads.length, 0);
  tab.state.blockReason = null;
  tab.coordinator.reevaluate();
  await flush();
  assert.equal(tab.reloads.length, 1, "exactly one reload after release");
  assert.equal(tab.prepareCalls, 1);

  const prepareBlocked = createTab({
    deployed: "v2-build2",
    onPrepare: () => {
      if (prepareBlocked.prepareCalls === 1) prepareBlocked.state.blockReason = "request:mutation";
    },
  });
  prepareBlocked.coordinator.start();
  await flush();
  prepareBlocked.coordinator.reloadNow();
  await flush();
  assert.equal(prepareBlocked.reloads.length, 0, "manual reload re-checks blockers after SW preparation");
  prepareBlocked.state.blockReason = null;
  prepareBlocked.coordinator.reevaluate();
  await flush();
  assert.equal(prepareBlocked.reloads.length, 1);
});

await test("G4 mutation settle grace: no reload between a checkout response and the Stripe hand-off", async () => {
  const clock = { now: 1_700_000_000_000 };
  const scheduled: Array<{ at: number; fn: () => void }> = [];
  resetMutationRequestTrackerForTests(
    () => clock.now,
    (fn, ms) => scheduled.push({ at: clock.now + ms, fn }),
  );
  let respond!: (r: Response) => void;
  const target = {
    fetch: (() => new Promise<Response>((resolve) => (respond = resolve))) as typeof fetch,
  };
  installMutationRequestTracker(target);
  let stripeHold = false;
  const blockReason = () =>
    stripeHold
      ? "payment:stripe-redirect"
      : inFlightMutationRequestCount() > 0
        ? "request:mutation"
        : isMutationRequestSettling()
          ? "request:mutation-settling"
          : null;
  const tab = createTab({ deployed: "v2-build2", visible: false, clock, blockReason });
  const unsubscribe = subscribeMutationRequests(() => tab.coordinator.reevaluate());
  const checkout = target.fetch("/api/billing/checkout", { method: "POST" });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.reloads.length, 0, "request in flight");

  respond(new Response(JSON.stringify({ url: "https://checkout.stripe.com/x" })));
  await checkout;
  await flush();
  assert.equal(tab.reloads.length, 0, "headers arrived, body not yet handled");
  assert.equal(inFlightMutationRequestCount(), 0);
  assert.ok(isMutationRequestSettling());
  clock.now += 1_000;
  stripeHold = true; // caller begins the Stripe hand-off
  clock.now += MUTATION_SETTLE_GRACE_MS;
  scheduled.filter((s) => s.at <= clock.now).forEach((s) => s.fn());
  await flush();
  assert.equal(tab.reloads.length, 0, "hand-off hold takes over before the grace ends");

  // Without a hand-off the reload proceeds once the grace window has passed.
  stripeHold = false;
  tab.coordinator.reevaluate();
  await flush();
  assert.equal(tab.reloads.length, 1);
  unsubscribe();
  resetMutationRequestTrackerForTests();
});

await test("G5 Stripe hold is honoured, but a never-cleared hold stops blocking after its cap", () => {
  const clock = { now: 0 };
  let active = false;
  const listeners = new Set<() => void>();
  const set = (value: boolean) => {
    active = value;
    listeners.forEach((l) => l());
  };
  const signal = createAgeLimitedSignal({
    isActive: () => active,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    now: () => clock.now,
    maxMs: 5 * 60_000,
  });
  assert.equal(signal.isActive(), false);
  set(true);
  clock.now += 4 * 60_000;
  assert.equal(signal.isActive(), true);
  clock.now += 2 * 60_000;
  assert.equal(signal.isActive(), false, "cancelled hand-off cannot pin the tab");
  assert.equal(active, true, "underlying hold untouched");
  set(false);
  set(true);
  assert.equal(signal.isActive(), true, "a new hand-off is protected again");
  signal.dispose();
  assert.equal(listeners.size, 0);

  const runtime = read("src/app/lib/deployUpdate/runtime.ts");
  assert.match(runtime, /if \(ensureStripeHold\(\)\.isActive\(\)\) return "payment:stripe-redirect";/);
  assert.match(runtime, /if \(isMutationRequestSettling\(\)\) return "request:mutation-settling";/);
});

await test("G6 no service-worker or preload path reloads outside the coordinator", () => {
  const runtime = read("src/app/lib/deployUpdate/runtime.ts");
  assert.equal(runtime.match(/window\.location\.reload\(\)/g)?.length, 1, "only the coordinator's reload dependency");
  const handler = runtime.match(/export function handleServiceWorkerUpdated\(\): void \{[\s\S]*?\n\}/)![0];
  assert.doesNotMatch(handler, /reload/);
  assert.match(handler, /onServiceWorkerUpdated\(\)/);
  const swFiles = ["src/main.tsx", "src/app/lib/deferredStartup.ts", "src/app/lib/deployUpdate/serviceWorkerRegistration.ts"];
  for (const file of swFiles) assert.doesNotMatch(read(file), /registerSW\(\{[^}]*onNeedRefresh/, file);
});

await test("G7 cross-tab: duplicate and echoed messages cannot exceed the per-tab budget", async () => {
  const bus = createBus();
  const session = new MemoryStorage();
  const tab = createTab({ deployed: "v1-build1", visible: false, localStore: null, sessionStore: session, channel: bus.channel() });
  tab.coordinator.start();
  await flush();
  const peer = bus.channel();
  for (let i = 0; i < 20; i += 1) {
    peer.post({ type: i % 2 ? "reloading" : "version", version: "v2-build2", at: i });
  }
  await flush();
  assert.equal(tab.reloads.length, 1, "one reload despite 20 messages");
  // Same page instance cannot be asked again while reloading; next page instance (stale shell) gets one more.
  const next = createTab({ deployed: "v1-build1", visible: false, localStore: null, sessionStore: session, channel: bus.channel() });
  next.coordinator.start();
  await flush();
  for (let i = 0; i < 20; i += 1) peer.post({ type: "version", version: "v2-build2", at: i });
  await flush();
  const third = createTab({ deployed: "v1-build1", visible: false, localStore: null, sessionStore: session, channel: bus.channel() });
  third.coordinator.start();
  await flush();
  for (let i = 0; i < 20; i += 1) peer.post({ type: "version", version: "v2-build2", at: i });
  await flush();
  assert.equal(next.reloads.length + third.reloads.length, 1, "budget of two per version holds across messages");
});

// ---------------------------------------------------------------- H. "Refresh now" notice continuity
await test("H1 'Refresh now' turns the notice into 'updating' and never re-offers it while the refresh is pending", async () => {
  const session = new MemoryStorage();
  const tab = createTab({ deployed: "v2-build2", sessionStore: session });
  tab.coordinator.start();
  await flush();
  assert.deepEqual(tab.notices, [{ kind: "deferred", version: "v2-build2" }]);
  tab.state.blockReason = "request:mutation";
  tab.coordinator.reloadNow();
  await flush();
  assert.deepEqual(tab.notices.at(-1), { kind: "reloading", version: "v2-build2" });
  tab.coordinator.onRouteChange();
  await tab.tick();
  tab.coordinator.reevaluate();
  await flush();
  assert.equal(tab.reloads.length, 0);
  assert.ok(
    tab.notices.slice(1).every((n) => n.kind === "reloading"),
    "no actionable notice reappears while the manual refresh waits",
  );
  tab.state.blockReason = null;
  tab.coordinator.reevaluate();
  await flush();
  assert.equal(tab.reloads.length, 1);
  assert.equal(JSON.parse(session.getItem(MANUAL_RELOAD_KEY)!).version, "v2-build2");
});

await test("H2 a page that still boots the old bundle after 'Refresh now' keeps 'updating' and reloads once on SW activation", async () => {
  const session = new MemoryStorage();
  const clock = { now: 1_700_000_000_000 };
  session.setItem(MANUAL_RELOAD_KEY, JSON.stringify({ version: "v2-build2", at: clock.now - 2_000 }));
  const stale = createTab({ deployed: "v2-build2", sessionStore: session, clock });
  stale.coordinator.start();
  await flush();
  assert.deepEqual(stale.notices, [{ kind: "reloading", version: "v2-build2" }], "no 'new version' notice again");
  assert.equal(stale.reloads.length, 0);
  stale.coordinator.onServiceWorkerUpdated();
  await flush();
  assert.equal(stale.reloads.length, 1, "resumes the user's refresh once the new worker is active");
  stale.coordinator.onServiceWorkerUpdated();
  await flush();
  assert.equal(stale.reloads.length, 1, "bounded: one resumed reload");
});

await test("H3 the 'updating' state expires: an actionable notice returns if the new version never arrives", async () => {
  const session = new MemoryStorage();
  const clock = { now: 1_700_000_000_000 };
  session.setItem(MANUAL_RELOAD_KEY, JSON.stringify({ version: "v2-build2", at: clock.now - 1_000 }));
  const tab = createTab({ deployed: "v2-build2", sessionStore: session, clock });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.notices.at(-1)!.kind, "reloading");
  assert.equal(tab.timeouts.length, 1);
  clock.now += 30_000;
  tab.timeouts[0]!();
  assert.deepEqual(tab.notices.at(-1), { kind: "deferred", version: "v2-build2" });
  assert.equal(session.getItem(MANUAL_RELOAD_KEY), null);

  const old = new MemoryStorage();
  old.setItem(MANUAL_RELOAD_KEY, JSON.stringify({ version: "v2-build2", at: clock.now - 31_000 }));
  const expired = createTab({ deployed: "v2-build2", sessionStore: old, clock });
  expired.coordinator.start();
  await flush();
  assert.deepEqual(expired.notices, [{ kind: "deferred", version: "v2-build2" }]);
});

await test("H4 a refresh that landed on the new version shows nothing and clears the marker", async () => {
  const session = new MemoryStorage();
  session.setItem(MANUAL_RELOAD_KEY, JSON.stringify({ version: "v2-build2", at: 1_700_000_000_000 - 1_000 }));
  const tab = createTab({ running: "v2-build2", deployed: "v2-build2", sessionStore: session });
  tab.coordinator.start();
  await flush();
  assert.equal(tab.notices.length, 0);
  assert.equal(session.getItem(MANUAL_RELOAD_KEY), null);

  const runtime = read("src/app/lib/deployUpdate/runtime.ts");
  assert.match(runtime, /event\.preventDefault\(\);\s*coordinator\?\.reloadNow\(\);/, "toast stays mounted on click");
  assert.match(runtime, /toast\.loading\(i18n\.t\("shell\.deployUpdate\.reloading"\)/);
  const en = JSON.parse(read("src/i18n/locales/en.json")).shell.deployUpdate;
  const de = JSON.parse(read("src/i18n/locales/de.json")).shell.deployUpdate;
  assert.ok(en.reloading && de.reloading);
});

console.log(`deploy-update-reliability-runtime: ${passed} passed`);
