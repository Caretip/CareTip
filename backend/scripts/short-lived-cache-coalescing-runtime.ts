/**
 * shortLivedCache — TTL cache + in-flight coalescing on concurrent miss.
 * Run: npm run test:request-coalescing-cache-lock (includes this file)
 */
import assert from "node:assert/strict";
import { getCachedOrLoad, invalidateCacheKey } from "../src/utils/shortLivedCache.js";

let ok = true;
const pass = (msg: string) => console.log(`PASS: ${msg}`);
const fail = (msg: string) => {
  console.error(`FAIL: ${msg}`);
  ok = false;
};

const key = `test-coalesce:${Date.now()}`;
invalidateCacheKey(key);

let loads = 0;
const loader = async () => {
  loads += 1;
  await new Promise((r) => setTimeout(r, 10));
  return { value: loads };
};

const [a, b, c] = await Promise.all([
  getCachedOrLoad(key, 5_000, loader),
  getCachedOrLoad(key, 5_000, loader),
  getCachedOrLoad(key, 5_000, loader),
]);

if (loads === 1 && a.value === 1 && b.value === 1 && c.value === 1) {
  pass("backend cache miss coalesces to one loader under concurrency");
} else {
  fail(`expected 1 load, got loads=${loads} values=${a.value}/${b.value}/${c.value}`);
}

const hit = await getCachedOrLoad(key, 5_000, async () => {
  loads += 1;
  return { value: 99 };
});
if (loads === 1 && hit.value === 1) {
  pass("warm cache hit skips loader");
} else {
  fail(`cache hit should not reload, loads=${loads} hit=${hit.value}`);
}

invalidateCacheKey(key);
try {
  await getCachedOrLoad(key, 5_000, async () => {
    throw new Error("boom");
  });
} catch {
  // expected
}
loads = 0;
await getCachedOrLoad(key, 5_000, async () => {
  loads += 1;
  return 7;
});
if (loads === 1) {
  pass("failed load clears inflight so a later call can retry");
} else {
  fail(`retry after failure failed, loads=${loads}`);
}

assert.equal(ok, true);
console.log("\nshortLivedCache coalescing checks passed.");
