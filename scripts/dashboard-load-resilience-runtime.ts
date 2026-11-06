/**
 * Dashboard loading must always end: in data, or in a failure the user can act on. Runs the real
 * `api.ts` and analytics bundle against a scripted `fetch`. No backend, no credentials.
 * Run: npm run test:dashboard-load-resilience
 */
import assert from "node:assert/strict";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
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
      hostname: "caretip.de",
      host: "caretip.de",
      origin: "https://caretip.de",
      protocol: "https:",
      href: "https://caretip.de/dashboard",
      pathname: "/dashboard",
    },
  },
  configurable: true,
});
class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {}
  postMessage(): void {}
  close(): void {}
}
Object.defineProperty(globalThis, "BroadcastChannel", { value: MockBroadcastChannel, configurable: true });

for (const level of ["log", "info", "debug", "warn", "error"] as const) console[level] = () => undefined;
const report = (line: string) => process.stdout.write(`${line}\n`);

const { setMemoryAccessToken } = await import("../src/app/lib/accessTokenStore");
const { markSessionBootstrapSettled } = await import("../src/app/lib/authSessionBootstrap");
const api = await import("../src/app/lib/api");
const { fetchBusinessAnalyticsBundle, clearBusinessAnalyticsStore, isBusinessAnalyticsBundleComplete } = await import(
  "../src/app/lib/businessAnalytics"
);
const { toUserFriendlyMessage } = await import("../src/app/lib/errorMessages");
const { derivePeriodScopedSectionLoading, deriveAnalyticsLoadingLifecycle } = await import(
  "../src/app/lib/analyticsLoadingLifecycle"
);

setMemoryAccessToken("test-access-token");
markSessionBootstrapSettled();

type Reply = { status: number; body: unknown } | "hang";
let route: (url: string, init?: RequestInit) => Reply = () => ({ status: 200, body: {} });
let calls: Array<{ url: string; init?: RequestInit }> = [];

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, init });
  const reply = route(url, init);
  if (reply === "hang") {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  }
  return Promise.resolve(
    new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}) as typeof fetch;

const STATS = { totalTips: 120, tipCount: 8, employeeCount: 3, employees: [] };
const CHARTS = { dailyTipDistribution: [{ day: "Mon", amount: 120 }], employeeGoals: [] };
const QR = { timeframe: "month", totalScans: 4, uniqueScans: 2, repeatScans: 2, scansByDevice: [], scanTrend: [] };

const healthy = (url: string): Reply => {
  if (url.includes("scope=analytics")) return { status: 200, body: CHARTS };
  if (url.includes("/me/stats")) return { status: 200, body: STATS };
  if (url.includes("qr-analytics")) return { status: 200, body: QR };
  if (url.includes("/api/tips/business")) return { status: 200, body: { items: [], total: 0 } };
  return { status: 200, body: {} };
};
const failing = (match: string) => (url: string) =>
  url.includes(match) ? { status: 500, body: { message: "boom" } } : healthy(url);
const reset = (next: (url: string, init?: RequestInit) => Reply) => {
  api.clearBusinessStatsClientCache();
  clearBusinessAnalyticsStore();
  calls = [];
  route = next;
};
const count = (match: string) => calls.filter((c) => c.url.includes(match)).length;
const OPTS = { includeTipsFeed: true, includeWeekStats: true, includeQrAnalytics: true };

// A slice that failed is finished, not loading. This is what releases the skeleton.
assert.equal(derivePeriodScopedSectionLoading({ valuesMatchPeriod: false, sliceReady: false, fetchInFlight: false, failed: true }), false);
assert.equal(derivePeriodScopedSectionLoading({ valuesMatchPeriod: true, sliceReady: false, fetchInFlight: true, failed: true }), false);
// The period guard still holds without a failure: values from another period are never painted.
assert.equal(derivePeriodScopedSectionLoading({ valuesMatchPeriod: false, sliceReady: true, fetchInFlight: false }), true);
assert.equal(derivePeriodScopedSectionLoading({ valuesMatchPeriod: true, sliceReady: false, fetchInFlight: true }), true);
assert.equal(derivePeriodScopedSectionLoading({ valuesMatchPeriod: true, sliceReady: true, fetchInFlight: true }), false);
assert.equal(
  deriveAnalyticsLoadingLifecycle({
    hasVisibleAnalyticsData: true,
    isColdLoading: false,
    isTimeframeLoading: false,
    valuesMatchPeriod: false,
    periodStatsReady: false,
    periodStatsFailed: true,
  }).isAnalyticsRefreshing,
  false,
);
report("PASS  a failed slice is not a loading slice");

// Everything healthy: no failure reported, and the charts did not wait for the KPIs to start.
reset(healthy);
{
  const bundle = await fetchBusinessAnalyticsBundle("month", OPTS);
  assert.equal(bundle.failedSlices, undefined);
  assert.equal(bundle.periodStats.dailyTipDistribution?.length, 1);
  assert.equal(bundle.periodStats.totalTips, 120);
}
report("PASS  healthy bundle reports no failures");

// One slice failing keeps the others, and names what failed.
for (const [match, slice] of [
  ["scope=analytics", "deferred"],
  ["/api/tips/business", "tipsFeed"],
  ["qr-analytics", "qr"],
] as const) {
  reset(failing(match));
  const bundle = await fetchBusinessAnalyticsBundle("month", OPTS);
  assert.deepEqual(bundle.failedSlices, [slice], match);
  assert.equal(bundle.periodStats.totalTips, 120, `KPIs survive ${slice} failing`);
  assert.ok(bundle.firstFailure, `${slice} keeps its reason`);
  assert.equal(isBusinessAnalyticsBundleComplete(bundle, OPTS), false, `${slice} stays incomplete so it retries`);
}
report("PASS  one failed slice keeps the rest and is reported");

// A failed QR read must not be cached as "no scans": that is what made the section silently empty.
reset(failing("qr-analytics"));
{
  const failed = await fetchBusinessAnalyticsBundle("month", OPTS);
  assert.equal(failed.qrFetched, false);
  route = healthy;
  const retried = await fetchBusinessAnalyticsBundle("month", OPTS);
  assert.equal(retried.failedSlices, undefined);
  assert.equal(retried.qrAnalytics?.totalScans, 4);
}
report("PASS  a failed slice is fetched again on retry");

// Without KPIs there is nothing to show, so the load rejects with the real reason.
reset(failing("scope=aboveFold"));
await assert.rejects(fetchBusinessAnalyticsBundle("month", OPTS), (err: unknown) => {
  assert.equal((err as { status?: number }).status, 500, "the real failure, not a generic wrapper");
  assert.match(toUserFriendlyMessage(err), /servers hit a problem/i);
  return true;
});
report("PASS  KPI failure rejects with the real reason");

// Identical concurrent reads share one request, and callers cannot alter each other's copy.
reset(() => ({ status: 200, body: { totalScans: 1, list: [1] } }));
{
  const [a, b, c] = await Promise.all([
    api.getBusinessQrAnalytics("week"),
    api.getBusinessQrAnalytics("week"),
    api.getBusinessQrAnalytics("week"),
  ]);
  assert.equal(count("qr-analytics"), 1, "one request for three callers");
  (a as unknown as { list: number[] }).list.push(2);
  assert.deepEqual((b as unknown as { list: number[] }).list, [1]);
  assert.deepEqual((c as unknown as { list: number[] }).list, [1]);
}
report("PASS  concurrent identical reads share one request");

// A finished read is not reused: sharing covers in-flight requests only.
reset(() => ({ status: 200, body: { totalScans: 1 } }));
await api.getBusinessQrAnalytics("week");
await api.getBusinessQrAnalytics("week");
assert.equal(count("qr-analytics"), 2);
report("PASS  sequential reads are not cached by sharing");

// Two accounts never share a read, even for the same URL at the same moment.
reset(() => ({ status: 200, body: { totalScans: 1 } }));
{
  setMemoryAccessToken("first-account-token");
  const first = api.getBusinessQrAnalytics("week");
  setMemoryAccessToken("second-account-token");
  const second = api.getBusinessQrAnalytics("week");
  await Promise.all([first, second]);
  assert.equal(count("qr-analytics"), 2, "different sessions send their own request");
  setMemoryAccessToken("test-access-token");
}
report("PASS  reads are never shared across sessions");

// Cancelling one caller leaves the other's request alive; the last one out cancels it.
reset(() => "hang");
{
  const one = new AbortController();
  const two = new AbortController();
  const first = api.getBusinessQrAnalytics("week", { signal: one.signal });
  const second = api.getBusinessQrAnalytics("week", { signal: two.signal });
  const firstOutcome = first.catch((err: unknown) => err);
  const secondOutcome = second.catch((err: unknown) => err);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(count("qr-analytics"), 1);
  const networkSignal = calls[0]?.init?.signal as AbortSignal;
  one.abort();
  assert.equal((await firstOutcome as DOMException).name, "AbortError");
  assert.equal(networkSignal.aborted, false, "still wanted by the second caller");
  two.abort();
  assert.equal((await secondOutcome as DOMException).name, "AbortError");
  assert.equal(networkSignal.aborted, true, "nobody is waiting any more");
}
report("PASS  cancellation is per caller, and the network request stops with the last");

// An aborted caller must not fail another waiting on the same stats request.
reset(() => "hang");
{
  const leaving = new AbortController();
  const aborted = api.getBusinessStats("week", { scope: "analytics", signal: leaving.signal }).catch((e: unknown) => e);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const staying = api.getBusinessStats("week", { scope: "analytics" });
  leaving.abort();
  assert.equal((await aborted as DOMException).name, "AbortError");
  const outcome = await Promise.race([
    staying.then(() => "settled", () => "rejected"),
    new Promise((resolve) => setTimeout(() => resolve("still waiting"), 30)),
  ]);
  assert.equal(outcome, "still waiting", "the remaining caller keeps waiting for the shared request");
}
report("PASS  an aborted caller does not fail others sharing the stats request");

// A write clears sharing, so a read started after it can never join one that began before it.
reset(() => "hang");
{
  const before = api.getBusinessQrAnalytics("month").catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));
  route = () => ({ status: 200, body: { results: [] } });
  await api.evaluateSetupPromptsApi([]);
  route = () => ({ status: 200, body: { totalScans: 9 } });
  const after = await api.getBusinessQrAnalytics("month");
  assert.equal(after.totalScans, 9);
  assert.equal(count("qr-analytics"), 2);
  void before;
}
report("PASS  a read after a write does not join an earlier read");

// Prompts mounting together evaluate in one POST, and each still gets its own row.
reset(() => ({ status: 200, body: { results: [{ kind: "a", show: true }, { kind: "b", show: false }] } }));
{
  const { evaluateSetupPrompts } = await import("../src/app/lib/setupNotificationIntelligence");
  const item = (kind: string) => ({ kind, conditionActive: true, conditionVersion: "1" }) as never;
  const [one, two] = await Promise.all([evaluateSetupPrompts([item("a")]), evaluateSetupPrompts([item("b")])]);
  assert.equal(count("setup/evaluate"), 1);
  const sent = JSON.parse(String(calls[0]?.init?.body)) as { items: Array<{ kind: string }> };
  assert.deepEqual(sent.items.map((i) => i.kind), ["a", "b"]);
  assert.equal(one.find((r) => r.kind === "a")?.show, true);
  assert.equal(two.find((r) => r.kind === "b")?.show, false);
}
report("PASS  setup prompts mounted together evaluate in one request");

report("dashboard-load-resilience: all checks passed");
process.exit(0);
