/**
 * Background/foreground recovery regressions (no backend). Drives the real modules.
 * Run: npm run test:lifecycle-recovery
 *
 * Root causes covered:
 *  1  A route's code request on a connection that died during sleep / app switch never settled, so
 *     React Router never rendered the page or its error screen: CareTip loader, then a blank page,
 *     recoverable only via the landing page → route code has a deadline and a "Connection
 *     interrupted · Try again" screen on the same URL.
 *  2  SocketProvider.connect() awaited the socket.io import before storing the socket, so overlapping
 *     calls (token-sync bursts at login and on return) each opened a socket that was never closed
 *     → only the newest connect() may create a socket.
 *  3  Each reconnect dispatched the catch-up events three times → one event per connection.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const {
  loadRouteModuleWithRetry,
  isRouteModuleTimeout,
  isChunkLoadFailure,
  RouteModuleTimeoutError,
  ROUTE_MODULE_LOAD_DEADLINE_MS,
} = await import("../src/app/lib/chunkLoadRecovery");

type Check = { id: string; ok: boolean; detail: string };
const results: Check[] = [];
const check = (cond: unknown, id: string, detail: string) => results.push({ id, ok: Boolean(cond), detail });

// Shorten only the route-module deadline so the test runs in milliseconds.
const realSetTimeout = globalThis.setTimeout;
(globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) =>
  realSetTimeout(fn, ms === ROUTE_MODULE_LOAD_DEADLINE_MS ? 40 : ms, ...rest)) as typeof setTimeout;

// ── 1: route code deadline ───────────────────────────────────────────────────────────────────────
check(ROUTE_MODULE_LOAD_DEADLINE_MS > 0 && ROUTE_MODULE_LOAD_DEADLINE_MS < 17_000, "D1",
  `deadline (${ROUTE_MODULE_LOAD_DEADLINE_MS}ms) stays below the boot-overlay failsafe (~17s), so no blank page`);

let calls = 0;
let outcome = "";
try {
  await loadRouteModuleWithRetry(() => {
    calls += 1;
    return new Promise<never>(() => undefined); // never settles: dead connection
  });
  outcome = "resolved";
} catch (e) {
  outcome = isRouteModuleTimeout(e) ? "timeout" : `other: ${String(e)}`;
}
check(outcome === "timeout", "D2", `a never-settling route import rejects with RouteModuleTimeoutError (${outcome})`);
check(calls === 1, "D3", `a timed-out import is not retried in-page (factory calls: ${calls})`);

calls = 0;
const chunkErr = new TypeError("Failed to fetch dynamically imported module: /assets/Page-abc.js");
const recovered = await loadRouteModuleWithRetry(async () => {
  calls += 1;
  if (calls === 1) throw chunkErr;
  return { ok: true };
});
check(recovered.ok && calls === 2, "D4", "a failed chunk fetch is still retried once and recovers");

calls = 0;
let nonChunk = "";
try {
  await loadRouteModuleWithRetry(async () => {
    calls += 1;
    throw new Error("render bug");
  });
} catch (e) {
  nonChunk = (e as Error).message;
}
check(nonChunk === "render bug" && calls === 1, "D5", "other errors pass through untouched, no retry");

const quick = await loadRouteModuleWithRetry(async () => ({ value: 42 }));
check(quick.value === 42, "D6", "a normal import resolves unchanged");

const timeoutErr = new RouteModuleTimeoutError();
check(isRouteModuleTimeout(timeoutErr) && !isChunkLoadFailure(timeoutErr), "D7",
  "a timeout is not treated as a stale deploy (no version-check reload path)");

// Error screen wiring
const routes = read("src/app/routes.tsx");
check(/const moduleTimedOut =/.test(routes) && /isRouteModuleTimeout\(error\)/.test(routes), "D8", "route error screen recognises a route-code timeout");
check(/moduleTimedOut \? \(\s*<button[\s\S]*?window\.location\.reload\(\)[\s\S]*?connectionAction/.test(routes), "D9",
  "the timeout screen offers Try again on the same URL (reload), not a detour via the home page");
check(/!moduleTimedOut &&\s*\(isChunkLoadFailure/.test(routes), "D10", "a timeout never triggers the stale-chunk recovery");
for (const lang of ["en", "de"]) {
  const j = JSON.parse(read(`src/i18n/locales/${lang}.json`)) as { common: { errorScreen: Record<string, string> } };
  const es = j.common.errorScreen;
  check(Boolean(es.connectionTitle && es.connectionBody && es.connectionAction), "D11", `${lang}: connection error copy present`);
}

// ── 2/3: socket provider ─────────────────────────────────────────────────────────────────────────
const socket = read("src/app/context/SocketProvider.tsx");
const connectBody = socket.slice(socket.indexOf("const connect = useCallback"), socket.indexOf("const registerInterest"));
check(/const gen = \+\+connectGenRef\.current;/.test(connectBody), "S1", "each connect() takes a generation number");
const importIdx = connectBody.indexOf('await import("socket.io-client")');
const guardIdx = connectBody.indexOf("if (gen !== connectGenRef.current || interestRef.current <= 0) return;");
const ioIdx = connectBody.indexOf("const s = io(url");
check(importIdx > 0 && guardIdx > importIdx && ioIdx > guardIdx, "S2", "a superseded connect() returns after the import, before creating a socket");
const disconnectBody = socket.slice(socket.indexOf("const disconnect = useCallback"), socket.indexOf("const connect = useCallback"));
check(/connectGenRef\.current \+= 1;/.test(disconnectBody), "S3", "disconnect() cancels a connect() still waiting on the import");
const onReconnectBody = connectBody.slice(connectBody.indexOf("const onReconnect"), connectBody.indexOf("s.on(\"connect\""));
check(!/dispatchEvent/.test(onReconnectBody), "S4", "the reconnect handler no longer re-dispatches catch-up events");
const onConnectBody = connectBody.slice(connectBody.indexOf("const onConnect"), connectBody.indexOf("const scheduleAuthRecovery"));
check(/if \(!everConnected\)/.test(onConnectBody) && /SOCKET_RECONNECTED_EVENT/.test(onConnectBody), "S5",
  "connect announces CONNECTED once, RECONNECTED for later connections (one event each)");

globalThis.setTimeout = realSetTimeout;
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} [${r.id}] ${r.detail}`);
if (failed.length) {
  console.log(`\nlifecycle-recovery-runtime: ${failed.length} failure(s)`);
  process.exit(1);
}
console.log(`\nlifecycle-recovery-runtime: ok (${results.length} checks)`);
process.exit(0);
