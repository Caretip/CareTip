import assert from "node:assert/strict";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  COOKIE_CONSENT_VERSION,
  parseCookieConsent,
  writeCookieConsent,
} from "../src/app/lib/cookieConsent";

const memory = new Map<string, string>();

// Minimal localStorage shim for node.
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
};

Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });

const reject = writeCookieConsent({ analytics: false, functional: false, marketing: false });
assert.equal(reject.analytics, false);
assert.equal(reject.marketing, false);
assert.equal(reject.consentVersion, COOKIE_CONSENT_VERSION);
assert.ok(reject.consentDate);

const raw = memory.get(COOKIE_CONSENT_STORAGE_KEY);
assert.ok(raw);
const parsed = parseCookieConsent(JSON.parse(raw!));
assert.ok(parsed);
assert.equal(parsed!.essential, true);

const accept = writeCookieConsent({ analytics: true, functional: true, marketing: true });
assert.equal(accept.analytics, true);
assert.equal(accept.functional, true);

assert.equal(parseCookieConsent({ essential: true, analytics: false, functional: false, marketing: false, consentDate: "x", consentVersion: 999 }), null);

console.log("cookieConsent unit tests: OK");
