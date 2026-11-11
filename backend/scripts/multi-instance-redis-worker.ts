/**
 * One simulated API instance for multi-instance-redis-runtime.ts.
 * Usage: tsx scripts/multi-instance-redis-worker.ts <port>
 *
 * Runs the production Socket.IO server (handshake auth, Redis adapter, user disconnects, cache
 * invalidation fan-out) and the production login limiter, plus a few control routes so the test
 * can trigger server-side actions on this instance. Binds to 127.0.0.1 only.
 * Disposable Postgres (CARETIP_ISOLATED_POSTGRES_URL) and loopback Redis only.
 */
import { createServer } from "node:http";
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

await completeIsolatedPostgresBootstrap();

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error("usage: multi-instance-redis-worker.ts <port>");
  process.exit(2);
}

const express = (await import("express")).default;
const socket = await import("../src/socket/socketServer.js");
const { loginRateLimit } = await import("../src/middleware/authRateLimit.middleware.js");
const store = await import("../src/utils/rateLimitStore.js");
const cache = await import("../src/utils/shortLivedCache.js");
const { getRedisHealthSnapshot } = await import("../src/lib/redisHealth.js");

const app = express();
app.set("trust proxy", false);
app.use(express.json());

app.post("/__test/emit", (req, res) => {
  const { room, event, payload } = req.body as { room: string; event: string; payload: unknown };
  socket.getSocketIO()!.to(room).emit(event, payload);
  res.json({ ok: true });
});
app.post("/__test/disconnect-user", (req, res) => {
  socket.disconnectUserSockets(String((req.body as { userId: string }).userId));
  res.json({ ok: true });
});
app.post("/__test/cache/prime", (req, res) => {
  const { key, value } = req.body as { key: string; value: unknown };
  cache.primeCachedValue(key, 600_000, value);
  res.json({ ok: true });
});
app.post("/__test/cache/invalidate", (req, res) => {
  const { key, prefix } = req.body as { key?: string; prefix?: string };
  if (prefix) cache.invalidateCacheKeyPrefix(prefix);
  else if (key) cache.invalidateCacheKey(key);
  res.json({ ok: true });
});
app.get("/__test/cache", (req, res) => {
  res.json({ value: cache.getCachedIfFresh(String(req.query.key)) ?? null });
});
app.post("/__test/fin-check", async (req, res) => {
  const r = await store.checkAndIncrementLimitDistributed({
    key: `sec:test-fin:${String((req.body as { key: string }).key)}`,
    maxPerWindow: 100,
    windowMs: 60_000,
    failClosed: true,
  });
  res.json(r);
});
app.post("/__test/warm", async (_req, res) => {
  res.json({ shared: await store.warmRateLimitStore() });
});
app.get("/__test/health", (_req, res) => {
  res.json({
    pid: process.pid,
    redis: getRedisHealthSnapshot(),
    localSockets: socket.getSocketIO()?.sockets.sockets.size ?? 0,
  });
});
app.post("/api/auth/login", loginRateLimit, (_req, res) => {
  res.json({ ok: true });
});

const http = createServer(app);
socket.initSocketServer(http);
await socket.socketAdapterReady();
await store.warmRateLimitStore();

process.on("SIGTERM", () => {
  void socket.closeSocketServer().finally(() => process.exit(0));
});

http.listen(port, "127.0.0.1", () => {
  console.log(`READY ${port} ${process.pid}`);
});
