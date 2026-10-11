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
  isFacebookOAuthRecoveryClient,
  watchFacebookOAuthRedirectRecovery,
} from "./facebookOAuthRedirectRecovery";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const DESKTOP_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

assert.equal(FACEBOOK_OAUTH_RECOVERY_DELAY_MS, 7_000);
assert.equal(isFacebookOAuthRecoveryClient(ANDROID_CHROME), true);
assert.equal(isFacebookOAuthRecoveryClient("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
assert.equal(isFacebookOAuthRecoveryClient(DESKTOP_CHROME), false);
assert.equal(isFacebookOAuthRecoveryClient(DESKTOP_MAC), false);
assert.equal(isFacebookOAuthRecoveryClient(""), false);

type Listener = (event?: { persisted?: boolean }) => void;

function createEnv() {
  const documentListeners = new Map<string, Listener[]>();
  const windowListeners = new Map<string, Listener[]>();
  const timers = new Map<number, () => void>();
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
      setTimeout(handler: () => void, _ms: number) {
        const id = nextId;
        nextId += 1;
        timers.set(id, handler);
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout(id: ReturnType<typeof setTimeout>) {
        timers.delete(id as unknown as number);
      },
    },
    fireTimer() {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, handler] of pending) handler();
    },
    hide() {
      doc.visibilityState = "hidden";
      for (const listener of [...(documentListeners.get("visibilitychange") ?? [])]) listener();
    },
    show() {
      doc.visibilityState = "visible";
      for (const listener of [...(documentListeners.get("visibilitychange") ?? [])]) listener();
    },
    pageHide() {
      for (const listener of [...(windowListeners.get("pagehide") ?? [])]) listener();
    },
    pageShow(persisted: boolean) {
      for (const listener of [...(windowListeners.get("pageshow") ?? [])]) listener({ persisted });
    },
    timerCount() {
      return timers.size;
    },
  };
}

{
  const harness = createEnv();
  let recovered = 0;
  let left = 0;
  const watch = watchFacebookOAuthRedirectRecovery({
    isRecoveryClient: true,
    onRecover: () => {
      recovered += 1;
    },
    onLeave: () => {
      left += 1;
    },
    env: harness.env,
  });
  assert.equal(harness.timerCount(), 1);
  harness.fireTimer();
  assert.equal(recovered, 1);
  assert.equal(left, 0);
  harness.fireTimer();
  assert.equal(recovered, 1);
  harness.hide();
  assert.equal(left, 1);
  assert.equal(recovered, 1);
  harness.show();
  harness.fireTimer();
  assert.equal(recovered, 1);
  watch.dispose();
}

{
  const harness = createEnv();
  let recovered = 0;
  let left = 0;
  watchFacebookOAuthRedirectRecovery({
    isRecoveryClient: true,
    onRecover: () => {
      recovered += 1;
    },
    onLeave: () => {
      left += 1;
    },
    env: harness.env,
  });
  harness.hide();
  assert.equal(left, 1);
  assert.equal(harness.timerCount(), 0);
  harness.fireTimer();
  harness.show();
  assert.equal(recovered, 0);
}

{
  const harness = createEnv();
  let recovered = 0;
  watchFacebookOAuthRedirectRecovery({
    isRecoveryClient: true,
    onRecover: () => {
      recovered += 1;
    },
    onLeave: () => {},
    env: harness.env,
  });
  harness.pageHide();
  harness.fireTimer();
  harness.pageShow(true);
  assert.equal(recovered, 0);
}

{
  const harness = createEnv();
  let recovered = 0;
  const watch = watchFacebookOAuthRedirectRecovery({
    isRecoveryClient: true,
    onRecover: () => {
      recovered += 1;
    },
    onLeave: () => {},
    env: harness.env,
  });
  watch.dispose();
  assert.equal(harness.timerCount(), 0);
  harness.fireTimer();
  assert.equal(recovered, 0);
}

{
  const harness = createEnv();
  let recovered = 0;
  let left = 0;
  const watch = watchFacebookOAuthRedirectRecovery({
    isRecoveryClient: false,
    onRecover: () => {
      recovered += 1;
    },
    onLeave: () => {
      left += 1;
    },
    env: harness.env,
  });
  assert.equal(harness.timerCount(), 0);
  harness.fireTimer();
  harness.hide();
  harness.pageHide();
  assert.equal(recovered, 0);
  assert.equal(left, 0);
  watch.dispose();
}

const row = read("src/app/components/auth/OAuthProviderRow.tsx");
const recovery = read("src/app/lib/facebookOAuthRedirectRecovery.ts");
assert.equal(recovery.includes("submitFacebookOAuthRedirectStart"), false);
assert.equal(recovery.includes("location.assign"), false);
assert.ok(row.includes("onRecover: () => setFacebookRecoveryOpen(true)"));
assert.equal((row.match(/submitFacebookOAuthRedirectStart\(/g) ?? []).length, 1);
assert.ok(row.includes("if (providerBusy != null)"));

const en = read("src/i18n/locales/en.json");
const de = read("src/i18n/locales/de.json");
for (const key of [
  "facebookRecoveryTitle",
  "facebookRecoveryMessage",
  "facebookRecoveryContinueEmail",
  "facebookRecoveryTroubleshoot",
  "facebookRecoverySteps",
  "facebookRecoveryIncognito",
  "facebookRecoveryBack",
]) {
  assert.ok(en.includes(`"${key}"`), key);
  assert.ok(de.includes(`"${key}"`), key);
}
assert.ok(en.includes("Facebook sign-up isn't opening?"));
assert.ok(en.includes("Don't tap again."));
assert.ok(en.includes("Continue with email"));
assert.ok(en.includes("Troubleshoot Facebook"));
assert.ok(en.includes("Open supported links"));

console.log("facebookOAuthRedirectRecovery-runtime: all passed");
