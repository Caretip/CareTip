/**
 * Facebook OAuth recovery timing. No Meta calls and no second OAuth start.
 * Run: npm run test:facebook-oauth-recovery
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FACEBOOK_OAUTH_RECOVERY_DELAY_MS,
  FACEBOOK_OAUTH_REDIRECT_GRACE_MS,
  FACEBOOK_OAUTH_STALL_AFTER_GRACE_MS,
  isFacebookOAuthRecoveryClient,
  watchFacebookOAuthRedirectRecovery,
} from "./facebookOAuthRedirectRecovery";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

assert.equal(FACEBOOK_OAUTH_REDIRECT_GRACE_MS, 5_000);
assert.equal(FACEBOOK_OAUTH_STALL_AFTER_GRACE_MS, 18_000);
assert.equal(FACEBOOK_OAUTH_RECOVERY_DELAY_MS, 23_000);
assert.equal(isFacebookOAuthRecoveryClient(ANDROID_CHROME), true);
assert.equal(isFacebookOAuthRecoveryClient(DESKTOP_CHROME), false);

type Listener = (event?: { persisted?: boolean }) => void;

function createEnv() {
  const documentListeners = new Map<string, Listener[]>();
  const windowListeners = new Map<string, Listener[]>();
  const timers = new Map<number, { handler: () => void; ms: number }>();
  let nextId = 1;
  const doc = {
    visibilityState: "visible",
    addEventListener(type: string, listener: Listener) {
      documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: Listener) {
      documentListeners.set(
        type,
        (documentListeners.get(type) ?? []).filter((item) => item !== listener),
      );
    },
  };
  const win = {
    addEventListener(type: string, listener: Listener) {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: Listener) {
      windowListeners.set(
        type,
        (windowListeners.get(type) ?? []).filter((item) => item !== listener),
      );
    },
  };
  return {
    doc,
    env: {
      document: doc,
      window: win,
      setTimeout(handler: () => void, ms: number) {
        const id = nextId;
        nextId += 1;
        timers.set(id, { handler, ms });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout(id: ReturnType<typeof setTimeout>) {
        timers.delete(id as unknown as number);
      },
    },
    fireDueTimers() {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, entry] of pending) entry.handler();
    },
    hide() {
      doc.visibilityState = "hidden";
      for (const listener of [...(documentListeners.get("visibilitychange") ?? [])]) listener();
    },
    pageHide() {
      for (const listener of [...(windowListeners.get("pagehide") ?? [])]) listener();
    },
    timerCount() {
      return timers.size;
    },
  };
}

{
  const harness = createEnv();
  let stalled = 0;
  let navigated = 0;
  const watch = watchFacebookOAuthRedirectRecovery({
    isRecoveryClient: true,
    onStall: () => {
      stalled += 1;
    },
    onNavigateAway: () => {
      navigated += 1;
    },
    env: harness.env,
  });
  assert.equal(harness.timerCount(), 0, "timer not armed until submit");
  watch.armStallTimer();
  assert.equal(harness.timerCount(), 1);
  harness.fireDueTimers();
  assert.equal(stalled, 0, "grace period only");
  harness.fireDueTimers();
  assert.equal(stalled, 1);
  harness.fireDueTimers();
  assert.equal(stalled, 1);
  watch.dispose();
}

{
  const harness = createEnv();
  let stalled = 0;
  const watch = watchFacebookOAuthRedirectRecovery({
    isRecoveryClient: true,
    onStall: () => {
      stalled += 1;
    },
    onNavigateAway: () => {},
    env: harness.env,
  });
  watch.armStallTimer();
  harness.hide();
  assert.equal(stalled, 0);
  harness.fireDueTimers();
  harness.fireDueTimers();
  assert.equal(stalled, 0);
  watch.dispose();
}

{
  const harness = createEnv();
  let stalled = 0;
  watchFacebookOAuthRedirectRecovery({
    isRecoveryClient: false,
    onStall: () => {
      stalled += 1;
    },
    onNavigateAway: () => {},
    env: harness.env,
  }).armStallTimer();
  assert.equal(harness.timerCount(), 0);
  harness.fireDueTimers();
  assert.equal(stalled, 0);
}

const row = read("src/app/components/auth/OAuthProviderRow.tsx");
const recovery = read("src/app/lib/facebookOAuthRedirectRecovery.ts");
assert.equal(recovery.includes("submitFacebookOAuthRedirectStart"), false);
assert.ok(row.includes("onStall:"));
assert.ok(row.includes("facebookProviderShowsLoading"));
assert.equal((row.match(/submitFacebookOAuthRedirectStart\(/g) ?? []).length, 1);

const en = read("src/i18n/locales/en.json");
const de = read("src/i18n/locales/de.json");
for (const key of [
  "facebookConnecting",
  "facebookStallTitle",
  "facebookStallMessage",
  "facebookRetry",
  "facebookRecoveryContinueEmail",
  "facebookRecoveryTroubleshoot",
]) {
  assert.ok(en.includes(`"${key}"`), key);
  assert.ok(de.includes(`"${key}"`), key);
}

console.log("facebookOAuthRedirectRecovery-runtime: all passed");
