/**
 * Regression: intentional logout must not set session-expired notice; genuine 401 must.
 * Run: npm run test:auth-logout-session-expired
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const localStorageShim = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => (localStorageShim.has(k) ? localStorageShim.get(k)! : null),
    setItem: (k: string, v: string) => {
      localStorageShim.set(k, v);
    },
    removeItem: (k: string) => {
      localStorageShim.delete(k);
    },
  },
  configurable: true,
});

const sessionStorageShim = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  value: {
    getItem: (k: string) => (sessionStorageShim.has(k) ? sessionStorageShim.get(k)! : null),
    setItem: (k: string, v: string) => {
      sessionStorageShim.set(k, v);
    },
    removeItem: (k: string) => {
      sessionStorageShim.delete(k);
    },
  },
  configurable: true,
});

const {
  markClientSessionRevoked,
  clearClientSessionRevoked,
  markLogoutPending,
  clearLogoutPending,
  shouldMarkSessionExpiredNotice,
} = await import("../src/app/lib/api");
const { markSessionExpiredNotice, consumeSessionExpiredNotice } = await import(
  "../src/app/lib/sessionExpiredNotice"
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiSrc = fs.readFileSync(path.join(root, "src/app/lib/api.ts"), "utf8");

assert(
  apiSrc.includes("shouldMarkSessionExpiredNotice"),
  "api.ts must classify session-expired notice vs intentional logout",
);
assert(
  apiSrc.includes("isClientSessionRevoked()") && apiSrc.includes("isLogoutPending()"),
  "session-expired guard must check revoked + logout pending",
);

// --- A. Intentional logout latch: no session-expired notice ---
clearClientSessionRevoked();
clearLogoutPending();
assert(shouldMarkSessionExpiredNotice(), "baseline: unrevoked session may show expired notice");

markClientSessionRevoked();
assert(!shouldMarkSessionExpiredNotice(), "revoked session must suppress expired notice");
clearClientSessionRevoked();

markLogoutPending();
assert(!shouldMarkSessionExpiredNotice(), "logout pending must suppress expired notice");
clearLogoutPending();

// Simulate trailing 401 after logout cleanup (revoked set, no logout pending)
markClientSessionRevoked();
clearLogoutPending();
assert(!shouldMarkSessionExpiredNotice(), "trailing 401 after logout must not mark expired");

// --- B. Genuine definitive failure still sets notice ---
clearClientSessionRevoked();
clearLogoutPending();
assert(shouldMarkSessionExpiredNotice(), "genuine expiry path may mark notice");

markSessionExpiredNotice();
assert(consumeSessionExpiredNotice(), "genuine notice remains consumable");
assert(!consumeSessionExpiredNotice(), "notice is one-shot");

clearClientSessionRevoked();

console.log("auth-logout-session-expired-runtime: ok");
