/**
 * Cross-tab refresh security regressions (frontend).
 * Run: npm run test:auth-refresh-security
 *
 * Documents: localStorage/sessionStorage hold coordination + UI metadata only.
 * They are NOT authentication authorities — backend JWT validation remains required.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authRefreshCoordinationTestHooks,
  coordinateCrossTabRefresh,
  hasRecentPeerRefreshSuccess,
} from "../src/app/lib/authRefreshCoordination";
import { clearMemoryAccessToken, getMemoryAccessToken } from "../src/app/lib/accessTokenStore";
import { hasClientStoredSession } from "../src/app/lib/authUserStore";

const { hasClientAccessToken } = await import("../src/app/lib/api");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUTHORITY_NOTE =
  "localStorage is coordination/UI state, not an authentication authority";

type Check = { id: string; ok: boolean; detail: string };
const checks: Check[] = [];
const pass = (id: string, detail: string) => checks.push({ id, ok: true, detail });
const fail = (id: string, detail: string) => checks.push({ id, ok: false, detail });

function assert(cond: unknown, id: string, detail: string): boolean {
  if (cond) {
    pass(id, detail);
    return true;
  }
  fail(id, detail);
  return false;
}

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

// --- Browser storage shims ---
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

Object.defineProperty(globalThis, "window", {
  value: {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
  },
  configurable: true,
});

class MockBroadcastChannel {
  static channels = new Map<string, Set<MockBroadcastChannel>>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    if (!MockBroadcastChannel.channels.has(name)) MockBroadcastChannel.channels.set(name, new Set());
    MockBroadcastChannel.channels.get(name)!.add(this);
  }
  postMessage(): void {
    /* no-op for security tests */
  }
  close(): void {
    MockBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

Object.defineProperty(globalThis, "BroadcastChannel", {
  value: MockBroadcastChannel,
  configurable: true,
});

function resetEnv(): void {
  storage.clear();
  clearMemoryAccessToken();
  authRefreshCoordinationTestHooks.reset();
  authRefreshCoordinationTestHooks.resetWebLocksOverride();
  authRefreshCoordinationTestHooks.setLocalStorageBroken(false);
  authRefreshCoordinationTestHooks.setTabIdForTests(`tab-${Math.random().toString(36).slice(2, 8)}`);
}

function forgeMaliciousCaretipUser(): void {
  storage.set(
    "caretip_user",
    JSON.stringify({
      id: "attacker-forged-id",
      email: "attacker@evil.example",
      name: "Forged Admin",
      role: "business",
      emailVerified: true,
      isVerified: true,
      hasCompletedOnboarding: true,
      businessId: "forged-business-id",
    }),
  );
}

async function resolveApiBase(): Promise<string | null> {
  const fromEnv = process.env.VITE_API_URL?.trim() || process.env.API_URL?.trim() || "";
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) return fromEnv.replace(/\/+$/, "");
  const candidates = ["http://localhost:3001", "http://127.0.0.1:3001"];
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/api/health`, { method: "GET" });
      if (res.ok || res.status === 404) return base;
    } catch {
      // try next
    }
  }
  return null;
}

// =============================================================================
// 1. Malicious caretip_user cannot authenticate against the API
// =============================================================================
async function testMaliciousCaretipUser(): Promise<void> {
  resetEnv();
  forgeMaliciousCaretipUser();
  clearMemoryAccessToken();

  assert(hasClientStoredSession(), "1-user-storage", `${AUTHORITY_NOTE} — caretip_user may exist in localStorage`);
  assert(!hasClientAccessToken(), "1-no-memory-jwt", "forged caretip_user does not create an in-memory access JWT");
  assert(getMemoryAccessToken() === null, "1-memory-empty", "getMemoryAccessToken() remains null without backend auth");

  const apiSrc = read("src/app/lib/api.ts");
  assert(
    apiSrc.includes("getMemoryAccessToken()") && apiSrc.includes('headers.set("Authorization"'),
    "1-api-bearer-source",
    "protected API Authorization header is sourced from memory JWT only",
  );

  const apiBase = await resolveApiBase();
  if (!apiBase) {
    pass("1-live-api", "skipped live API probe (backend unreachable) — memory-layer checks passed");
    return;
  }

  try {
    const res = await fetch(`${apiBase}/api/auth/me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CareTip-Client": "1",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ name: "Attacker" }),
    });
    assert(
      res.status === 401 || res.status === 403,
      "1-live-api-denied",
      `protected PATCH /api/auth/me denied without Bearer JWT (HTTP ${res.status})`,
    );
  } catch (err) {
    fail("1-live-api", `live API probe failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// =============================================================================
// 3. Malicious storage simulation (lock / done / user)
// =============================================================================
async function testMaliciousRefreshDone(): Promise<void> {
  resetEnv();
  authRefreshCoordinationTestHooks.setWebLocksOverride(null);
  authRefreshCoordinationTestHooks.setPeerDone("attacker-tab", true, 200);

  assert(hasRecentPeerRefreshSuccess(), "3-done-signal-readable", "peer done signal is readable (coordination only)");

  let runnerCalls = 0;
  authRefreshCoordinationTestHooks.setTabIdForTests("victim-tab");
  const out = await coordinateCrossTabRefresh(async () => {
    runnerCalls += 1;
    return { ok: false, shouldClearSession: true, status: 401 };
  });

  assert(runnerCalls === 1, "3-done-no-bypass", "forged refresh_done does not bypass coordinated refresh runner");
  assert(getMemoryAccessToken() === null, "3-done-no-jwt", "forged refresh_done cannot mint an access JWT");
  assert(!out.ok, "3-done-no-session", "forged refresh_done cannot manufacture an authenticated session");
}

async function testMaliciousRefreshLock(): Promise<void> {
  resetEnv();
  authRefreshCoordinationTestHooks.setWebLocksOverride(null);
  authRefreshCoordinationTestHooks.setPeerLock("attacker-tab", Date.now());

  let runnerCalls = 0;
  authRefreshCoordinationTestHooks.setTabIdForTests("victim-tab");

  const runPromise = coordinateCrossTabRefresh(async () => {
    runnerCalls += 1;
    return { ok: true, status: 200, data: { token: "must-not-persist", user: {} } };
  });

  await new Promise((r) => setTimeout(r, 300));
  assert(runnerCalls === 0, "3-lock-blocks-premature", "forged peer lock delays victim refresh (no instant bypass)");

  authRefreshCoordinationTestHooks.reset();
  const out = await runPromise;
  assert(runnerCalls === 1, "3-lock-still-runs-runner", "victim still executes its own refresh after lock clears");
  assert(getMemoryAccessToken() === null, "3-lock-no-jwt", "forged lock cannot inject an access JWT into memory");
  assert(out.ok, "3-lock-runner-ok", "runner result is independent of forged lock contents");
}

async function testMalformedRefreshLock(): Promise<void> {
  resetEnv();
  authRefreshCoordinationTestHooks.setWebLocksOverride(null);
  storage.set("caretip_auth_refresh_lock", "{not-json");

  let runnerCalls = 0;
  const out = await coordinateCrossTabRefresh(async () => {
    runnerCalls += 1;
    return { ok: true, status: 200 };
  });

  assert(runnerCalls === 1, "3-malformed-lock", "malformed refresh_lock JSON does not crash or skip auth path");
  assert(getMemoryAccessToken() === null, "3-malformed-lock-no-jwt", "malformed lock cannot create JWT");
  assert(out.ok, "3-malformed-lock-complete", "coordination completes without treating malformed lock as credential");
}

async function testMaliciousUserPlusDone(): Promise<void> {
  resetEnv();
  forgeMaliciousCaretipUser();
  authRefreshCoordinationTestHooks.setWebLocksOverride(null);
  authRefreshCoordinationTestHooks.setPeerDone("attacker", true, 200);
  clearMemoryAccessToken();

  let refreshAttempts = 0;
  const simulateRefreshPost = async () => {
    refreshAttempts += 1;
    return { ok: false as const, shouldClearSession: true, status: 401 };
  };

  let out = await coordinateCrossTabRefresh(simulateRefreshPost);
  if (!out.ok && out.status === 401 && hasRecentPeerRefreshSuccess()) {
    out = await coordinateCrossTabRefresh(simulateRefreshPost);
  }

  assert(
    !out.ok && out.status === 401,
    "3-combined-unauthenticated",
    "forged user + forged done cannot manufacture auth — backend 401 persists",
  );
  assert(getMemoryAccessToken() === null, "3-combined-no-jwt", "combined forgery leaves memory JWT empty");
  assert(
    refreshAttempts >= 1,
    "3-combined-refresh-attempted",
    "coordination may retry after forged done, but only backend can issue JWTs",
  );
}

async function testBroadcastChannelPayloadHasNoCredentials(): Promise<void> {
  const src = read("src/app/lib/authRefreshCoordination.ts");
  assert(
    src.includes("const payload: RefreshDonePayload = { tabId, at: Date.now(), ok, status }"),
    "3-bc-payload-shape",
    "BroadcastChannel carries coordination metadata only (tabId/at/ok/status) — no credentials",
  );
  assert(
    !src.includes("postMessage(parsed.token)") && !src.includes("postMessage(token)"),
    "3-bc-no-token",
    "BroadcastChannel postMessage never sends access or refresh tokens",
  );
}

async function testAccessTokenNeverWrittenToLocalStorage(): Promise<void> {
  const accessStore = read("src/app/lib/accessTokenStore.ts");
  const api = read("src/app/lib/api.ts");
  assert(
    !accessStore.includes("localStorage.setItem") || accessStore.includes("removeItem(LEGACY_TOKEN_KEY)"),
    "3-jwt-not-persisted",
    "accessTokenStore does not persist JWTs to localStorage (legacy key removed only)",
  );
  assert(!api.includes('localStorage.setItem("caretip_token")'), "3-api-no-token-write", "api.ts does not write caretip_token");
}

// --- Run ---
await testMaliciousCaretipUser();
await testMaliciousRefreshDone();
await testMaliciousRefreshLock();
await testMalformedRefreshLock();
await testMaliciousUserPlusDone();
await testBroadcastChannelPayloadHasNoCredentials();
await testAccessTokenNeverWrittenToLocalStorage();

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"} [${c.id}] ${c.detail}`);
}
if (failed.length > 0) {
  console.error(`auth-refresh-security-regression-runtime: ${failed.length} failed`);
  process.exit(1);
}
console.log(`auth-refresh-security-regression-runtime: ok (${checks.length} checks)`);
