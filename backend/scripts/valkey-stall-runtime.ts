/**
 * A Valkey that stops answering must not hang rate-limited requests. Local fake servers only
 * (no real Valkey, no database). Two failure modes, one per process (the store's cooldown is
 * process-wide):
 *   connect  — accepts TCP, never completes the handshake.
 *   command  — completes the handshake (answers INFO), then never answers a command.
 * Run: node scripts/safe-test.mjs test:valkey-stall   (runs both modes)
 */
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";

if (process.env.CARETIP_TEST_ISOLATION !== "1") throw new Error("isolated runs only");
const mode = process.argv[2] === "command" ? "command" : "connect";

const INFO_REPLY = "# Server\r\nredis_version:5.0.14\r\nloading:0\r\n";
const sockets = new Set<Socket>();
let connections = 0;
const fake = createServer((s) => {
  connections++;
  sockets.add(s);
  s.on("data", (buf) => {
    // "command" mode: answer the ready check so the client becomes usable, then go silent.
    if (mode === "command" && /INFO/i.test(buf.toString())) s.write(`$${Buffer.byteLength(INFO_REPLY)}\r\n${INFO_REPLY}\r\n`);
  });
  s.on("error", () => {});
  s.on("close", () => sockets.delete(s));
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
process.env.REDIS_URL = `redis://127.0.0.1:${(fake.address() as { port: number }).port}`;
process.env.RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS = "1000";
process.env.RATE_LIMIT_REDIS_COMMAND_TIMEOUT_MS = "300";

const store = await import("../src/utils/rateLimitStore.js");
const check = (key: string, failClosed = false) =>
  store.checkAndIncrementLimitDistributed({ key, maxPerWindow: 5, windowMs: 60_000, failClosed });

const started = Date.now();
const results = await Promise.all(Array.from({ length: 20 }, (_, i) => check(`stall-test:${i % 3}`)));
const elapsed = Date.now() - started;
console.log(`[${mode}] 20 concurrent limiter checks against a stalled Valkey finished in ${elapsed} ms`);
assert.ok(elapsed < 8_000, `checks hung for ${elapsed} ms`); // without the fix they never finish
assert.ok(results.every((r) => typeof r.allowed === "boolean"), "every check returned a decision (memory fallback)");

// After the failure the store is in its reconnect cooldown: later checks answer from memory at once
// (no reconnect attempt, no timeout wait), and the failed connection has been closed.
const t2 = Date.now();
await Promise.all(Array.from({ length: 50 }, (_, i) => check(`stall-test:b${i}`)));
const elapsed2 = Date.now() - t2;
await new Promise((r) => setTimeout(r, 300));
console.log(`[${mode}] 50 further checks during the cooldown: ${elapsed2} ms; connections opened ${connections}, still open ${sockets.size}`);
assert.ok(elapsed2 < 250, `checks during cooldown waited ${elapsed2} ms`);
assert.equal(connections, 1, "no reconnect attempt during the cooldown");
assert.equal(sockets.size, 0, "the failed connection was closed (no leaked sockets)");

// Fail-closed limits (financial writes) refuse instead of falling back.
assert.equal((await check("stall-test:financial", true)).allowed, false, "fail-closed check refuses while Valkey is unusable");

await store.closeRateLimitStore().catch(() => {});
for (const s of sockets) s.destroy();
fake.close();
console.log(`valkey-stall (${mode}): ok`);
process.exit(0);
