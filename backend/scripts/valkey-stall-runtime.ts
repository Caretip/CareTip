/**
 * A Valkey that accepts connections but never answers must not hang rate-limited requests.
 * Uses a local fake server only (no real Valkey, no database).
 * Run: node scripts/safe-test.mjs test:valkey-stall
 */
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";

if (process.env.CARETIP_TEST_ISOLATION !== "1") throw new Error("isolated runs only");

// Accepts TCP, reads everything, never replies: the "connected but stalled" failure mode.
const sockets = new Set<Socket>();
const stalled = createServer((s) => {
  sockets.add(s);
  s.on("data", () => {});
  s.on("close", () => sockets.delete(s));
});
await new Promise<void>((r) => stalled.listen(0, "127.0.0.1", r));
const port = (stalled.address() as { port: number }).port;
process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
process.env.RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS = "1000";
process.env.RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS = "300";

const store = await import("../src/utils/rateLimitStore.js");

const started = Date.now();
const results = await Promise.all(
  Array.from({ length: 20 }, (_, i) =>
    store.checkAndIncrementLimitDistributed({ key: `stall-test:${i % 3}`, maxPerWindow: 5, windowMs: 60_000 }),
  ),
);
const elapsed = Date.now() - started;
console.log(`20 concurrent limiter checks against a stalled Valkey finished in ${elapsed} ms`);
assert.ok(elapsed < 6_000, `checks hung for ${elapsed} ms`);
assert.ok(results.every((r) => typeof r.allowed === "boolean"), "every check returned a decision (memory fallback)");

// Fail-closed limits (financial writes) refuse instead of falling back.
const closed = await store.checkAndIncrementLimitDistributed({ key: "stall-test:financial", maxPerWindow: 5, windowMs: 60_000, failClosed: true });
assert.equal(closed.allowed, false, "fail-closed check refuses while Valkey is unusable");

await store.closeRateLimitStore().catch(() => {});
for (const s of sockets) s.destroy();
stalled.close();
console.log("valkey-stall: ok");
process.exit(0);
