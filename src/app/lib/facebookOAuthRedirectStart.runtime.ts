/**
 * Facebook redirect-start timeout regression tests. No Meta calls and no OAuth state.
 * Run: npm run test:facebook-oauth-start-stall
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

type Listener = (event?: { type?: string } & Record<string, unknown>) => void;

const assigns: string[] = [];
const replaces: string[] = [];
let hrefWrites = 0;
const fetchCalls: string[] = [];
const xhrCalls: string[] = [];
const submitSnapshots: Array<{ method: string; action: string; fields: Record<string, string> }> = [];
let submitMode: "pending" | "throw" = "pending";
let failedCallbacks = 0;

const windowListeners = new Map<string, Listener[]>();
const documentListeners = new Map<string, Listener[]>();
const storage = new Map<string, string>();
const scheduledDelays: number[] = [];

function addListener(map: Map<string, Listener[]>, type: string, fn: Listener) {
  const list = map.get(type) ?? [];
  list.push(fn);
  map.set(type, list);
}

function removeListener(map: Map<string, Listener[]>, type: string, fn: Listener) {
  map.set(type, (map.get(type) ?? []).filter((listener) => listener !== fn));
}

function dispatch(map: Map<string, Listener[]>, type: string, event: Record<string, unknown> = {}) {
  for (const listener of [...(map.get(type) ?? [])]) listener({ type, ...event });
}

function installDom() {
  const location = {
    origin: "https://caretip.test",
    pathname: "/signup",
    get href() {
      return "https://caretip.test/signup";
    },
    set href(_value: string) {
      hrefWrites += 1;
    },
    assign(url: string) {
      assigns.push(String(url));
    },
    replace(url: string) {
      replaces.push(String(url));
    },
  };
  const windowObj = {
    location,
    addEventListener(type: string, fn: Listener) {
      addListener(windowListeners, type, fn);
    },
    removeEventListener(type: string, fn: Listener) {
      removeListener(windowListeners, type, fn);
    },
  };
  const documentObj = {
    visibilityState: "visible",
    body: { appendChild() {} },
    createElement(tag: string) {
      if (tag === "input") return { type: "", name: "", value: "" };
      const form = {
        method: "",
        action: "",
        style: {} as { display?: string },
        children: [] as Array<{ name?: string; value?: string }>,
        setAttribute() {},
        appendChild(child: { name?: string; value?: string }) {
          form.children.push(child);
        },
        remove() {},
        submit() {
          const fields: Record<string, string> = {};
          for (const child of form.children) {
            if (child.name) fields[child.name] = child.value ?? "";
          }
          submitSnapshots.push({ method: form.method, action: form.action, fields });
          if (submitMode === "throw") throw new Error("submit failed");
        },
      };
      return form;
    },
    addEventListener(type: string, fn: Listener) {
      addListener(documentListeners, type, fn);
    },
    removeEventListener(type: string, fn: Listener) {
      removeListener(documentListeners, type, fn);
    },
  };
  Object.assign(globalThis, {
    window: windowObj,
    document: documentObj,
    sessionStorage: {
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      removeItem(key: string) {
        storage.delete(key);
      },
    },
    fetch(input: string) {
      fetchCalls.push(String(input));
      return Promise.reject(new Error("unexpected fetch"));
    },
    XMLHttpRequest: class {
      open(method: string, url: string) {
        xhrCalls.push(`${method} ${url}`);
      }
      send() {
        xhrCalls.push("send");
      }
    },
  });
}

installDom();

const { submitFacebookOAuthRedirectStart } = await import("./facebookOAuthRedirectWeb");

const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
const timers = new Map<number, { fn: () => void; ms: number }>();
let timerSeq = 1;

function installFakeTimers() {
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    const id = timerSeq++;
    const delay = ms ?? 0;
    scheduledDelays.push(delay);
    timers.set(id, { fn, ms: delay });
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id?: number) => {
    if (id != null) timers.delete(id);
  }) as typeof clearTimeout;
}

function flushTimers() {
  const due = [...timers.entries()];
  timers.clear();
  for (const [, timer] of due) timer.fn();
}

function restoreTimers() {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
}

function resetObservations() {
  assigns.length = 0;
  replaces.length = 0;
  hrefWrites = 0;
  fetchCalls.length = 0;
  xhrCalls.length = 0;
  submitSnapshots.length = 0;
  failedCallbacks = 0;
  scheduledDelays.length = 0;
  storage.clear();
  submitMode = "pending";
}

function storedFailure(): Record<string, unknown> | null {
  const raw = storage.get("caretip_fb_oauth_start_last_failure");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

function assertNavigationNotCancelled() {
  assert.deepEqual(assigns, []);
  assert.deepEqual(replaces, []);
  assert.equal(hrefWrites, 0);
  assert.equal(submitSnapshots.length, 1);
  assert.equal(submitSnapshots[0]?.method, "POST");
  assert.equal(submitSnapshots[0]?.action, "/api/auth/facebook/start");
  assert.deepEqual(fetchCalls, []);
  assert.deepEqual(xhrCalls, []);
  assert.equal(failedCallbacks, 0);
  assert.equal(storedFailure(), null);
}

const loginContext = {
  isLogin: true,
  returnPath: "/login",
  intendedRole: "MANAGER" as const,
  correlationId: "fb_test_login",
};

installFakeTimers();

resetObservations();
submitFacebookOAuthRedirectStart(loginContext, "/api/auth/facebook/start", () => {
  failedCallbacks += 1;
});
assert.equal(scheduledDelays.includes(20_000), false);
assert.ok(scheduledDelays.includes(5_000));
flushTimers();
assert.equal((windowListeners.get("visibilitychange") ?? []).length, 0);
assert.equal((documentListeners.get("visibilitychange") ?? []).length, 0);
assertNavigationNotCancelled();
console.log("test A stall timer: passed");

resetObservations();
submitFacebookOAuthRedirectStart(
  { ...loginContext, correlationId: "fb_test_pagehide" },
  "/api/auth/facebook/start",
  () => {
    failedCallbacks += 1;
  },
);
dispatch(windowListeners, "pagehide");
flushTimers();
dispatch(documentListeners, "securitypolicyviolation", {
  effectiveDirective: "form-action",
  blockedURI: "https://www.facebook.com/v21.0/dialog/oauth",
  violatedDirective: "form-action",
  disposition: "enforce",
});
assertNavigationNotCancelled();
console.log("test B pagehide: passed");

resetObservations();
submitFacebookOAuthRedirectStart(
  { ...loginContext, correlationId: "fb_test_csp" },
  "/api/auth/facebook/start",
  () => {
    failedCallbacks += 1;
  },
);
dispatch(documentListeners, "securitypolicyviolation", {
  effectiveDirective: "script-src",
  blockedURI: "https://www.facebook.com/v21.0/dialog/oauth",
  violatedDirective: "script-src",
  disposition: "enforce",
});
assert.deepEqual(assigns, []);
dispatch(documentListeners, "securitypolicyviolation", {
  effectiveDirective: "form-action",
  blockedURI: "https://www.facebook.com/v21.0/dialog/oauth",
  violatedDirective: "form-action",
  disposition: "enforce",
});
assert.deepEqual(assigns, ["/auth/facebook/complete?error=start_failed"]);
assert.equal(failedCallbacks, 1);
assert.equal(submitSnapshots.length, 1);
assert.equal(storedFailure()?.failureType, "csp_form_action_blocked");
assert.equal(storedFailure()?.reason, "csp_blocked_facebook_redirect");
flushTimers();
assert.deepEqual(assigns, ["/auth/facebook/complete?error=start_failed"]);
assert.deepEqual(fetchCalls, []);
assert.deepEqual(xhrCalls, []);
console.log("test C CSP: passed");

resetObservations();
submitMode = "throw";
submitFacebookOAuthRedirectStart(
  { ...loginContext, correlationId: "fb_test_throw" },
  "/api/auth/facebook/start",
  () => {
    failedCallbacks += 1;
  },
);
assert.equal(submitSnapshots.length, 1);
assert.deepEqual(assigns, ["/auth/facebook/complete?error=start_failed"]);
assert.equal(failedCallbacks, 1);
assert.equal(storedFailure()?.failureType, "form_submit_exception");
assert.equal(storedFailure()?.reason, "form_submit_threw");
assert.deepEqual(fetchCalls, []);
assert.deepEqual(xhrCalls, []);
flushTimers();
assert.deepEqual(assigns, ["/auth/facebook/complete?error=start_failed"]);
console.log("test D form.submit exception: passed");

resetObservations();
submitMode = "pending";
submitFacebookOAuthRedirectStart(
  {
    isLogin: false,
    returnPath: "/signup",
    intendedRole: "MANAGER",
    merchantLegalAccepted: false,
    correlationId: "fb_test_signup_blocked_fields",
  },
  "/api/auth/facebook/start",
  () => {
    failedCallbacks += 1;
  },
);
assert.equal(submitSnapshots[0]?.fields.isLogin, "false");
assert.equal(submitSnapshots[0]?.fields.intendedRole, "MANAGER");
assert.equal(submitSnapshots[0]?.fields.merchantLegalAccepted, undefined);
assert.equal(failedCallbacks, 0);

resetObservations();
submitFacebookOAuthRedirectStart(
  {
    isLogin: false,
    returnPath: "/signup",
    intendedRole: "MANAGER",
    merchantLegalAccepted: true,
    correlationId: "fb_test_signup_legal",
  },
  "/api/auth/facebook/start",
  () => {
    failedCallbacks += 1;
  },
);
assert.equal(submitSnapshots[0]?.fields.merchantLegalAccepted, "true");
assert.equal(submitSnapshots[0]?.fields.intendedRole, "MANAGER");

resetObservations();
submitFacebookOAuthRedirectStart(
  {
    isLogin: true,
    returnPath: "/login",
    intendedRole: "EMPLOYEE",
    correlationId: "fb_test_employee_login",
  },
  "/api/auth/facebook/start",
  () => {
    failedCallbacks += 1;
  },
);
assert.equal(submitSnapshots[0]?.fields.isLogin, "true");
assert.equal(submitSnapshots[0]?.fields.intendedRole, "EMPLOYEE");
assert.equal(submitSnapshots[0]?.fields.merchantLegalAccepted, undefined);
assert.deepEqual(fetchCalls, []);

const shell = read("src/app/components/auth/mobileWeb/MobileWebAuthShell.tsx");
const social = read("src/app/components/auth/mobileWeb/SocialLoginRow.tsx");
const desktop = read("src/app/components/AuthOAuthButtons.tsx");
const row = read("src/app/components/auth/OAuthProviderRow.tsx");
assert.ok(shell.includes("const legalGateOk = isLogin || isEmployee || merchantLegalAccepted"));
assert.ok(shell.includes("(!isEmployee && merchantLegalAccepted)"));
assert.ok(shell.includes('!isLogin && !isEmployee && !merchantLegalAccepted'));
assert.ok(social.includes('role === "employee" ? ("EMPLOYEE" as const) : ("MANAGER" as const)'));
assert.ok(social.includes("merchantLegalAccepted: role === \"business\" ? merchantLegalAccepted : undefined"));
assert.ok(social.includes("const allowInteraction = isLogin || allowSocialSignUp"));
assert.ok(desktop.includes('role === "employee" ? ("EMPLOYEE" as const) : ("MANAGER" as const)'));
assert.ok(desktop.includes("!isLogin && role === \"business\" && !merchantLegalAccepted"));
assert.ok(row.includes('setProviderBusy("facebook")'));
assert.ok(row.includes("() => setProviderBusy(null)"));
assert.equal((read("src/app/lib/facebookOAuthRedirectWeb.ts").match(/onSubmitFailed\?\.\(\)/g) ?? []).length, 1);
console.log("test E login and signup gates: passed");

restoreTimers();
console.log("facebookOAuthRedirectStart-runtime: all passed");
