/** A store update between render and subscribe must still reach the subscriber. */
import assert from "node:assert/strict";
import { subscribeWithCatchUp } from "../src/app/lib/subscribeWithCatchUp";

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const notify = () => listeners.forEach((listener) => listener());

let store = "initializing";
const rendered = store; // React renders here...
store = "authenticated"; // ...the update lands before the effect subscribes...
notify(); // ...and reaches nobody.

let seen = rendered;
const unsubscribe = subscribeWithCatchUp(subscribe, () => {
  seen = store;
});
assert.equal(seen, "authenticated", "catches the update missed before subscribing");

store = "unauthenticated";
notify();
assert.equal(seen, "unauthenticated", "still receives later updates");

unsubscribe();
store = "initializing";
notify();
assert.equal(seen, "unauthenticated", "stops after unsubscribe");

let syncs = 0;
const release = subscribeWithCatchUp(subscribe, () => { syncs += 1; }, () => false);
assert.equal(syncs, 0, "skips the catch-up when nothing changed");
notify();
assert.equal(syncs, 1, "still subscribed when the catch-up is skipped");
release();

console.log("subscribe-with-catch-up: ok");
