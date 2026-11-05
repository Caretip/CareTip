/**
 * A failed chunk preload must never be cancelled: a cancelled vite:preloadError resolves the
 * import to undefined and crashes the route.
 */
import assert from "node:assert/strict";

const store = new Map<string, string>();
const reloads: number[] = [];
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  },
  window: { location: { reload: () => reloads.push(Date.now()) } },
});

const { handleVitePreloadError, isChunkLoadFailure } = await import("../src/app/lib/chunkLoadRecovery");

assert.equal(handleVitePreloadError.length, 0, "takes no event, so it cannot cancel one");

handleVitePreloadError();
assert.equal(reloads.length, 1, "first failure reloads the page");

handleVitePreloadError();
assert.equal(reloads.length, 1, "no reload loop inside the cooldown");

assert.equal(isChunkLoadFailure(new Error("Unable to preload CSS for /assets/a.css")), true);

console.log("chunk-preload-recovery: ok");
