/**
 * Two API processes sharing one Redis behave as one application:
 *  - an event emitted on instance A reaches clients on instance B (business, user and public rooms),
 *    and a user-room event does not reach other users
 *  - disconnecting a user on B drops that user's socket held by A; the client can reconnect
 *  - a cache invalidation on A clears the entry on B
 *  - login limits share one counter across instances, and concurrent increments are atomic
 *  - Redis outage: both processes stay up, local delivery keeps working, the outage is reported,
 *    auth limits fall back to per-instance counts (divided only when RATE_LIMIT_FALLBACK_INSTANCE_COUNT
 *    is set; default 1 means each instance keeps the full limit), financial checks refuse; after
 *    recovery cross-instance delivery and shared counters return
 *
 * Needs a disposable loopback Postgres and a disposable loopback Redis:
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://postgres@127.0.0.1:PORT/db \
 *   CARETIP_ISOLATED_REDIS_URL=redis://127.0.0.1:PORT \
 *   node scripts/safe-test.mjs test:multi-instance-redis
 *
 * The workers reach Redis through a local TCP proxy owned by this test, so an outage is simulated
 * by closing the proxy; the Redis server itself is never touched.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Role } from "@prisma/client";
import { io as ioClient, type Socket } from "socket.io-client";
import { prisma } from "../src/prisma.js";
import { signJwt } from "../src/lib/jwtConfig.js";
import { signPublicSocketRoomToken } from "../src/services/publicSocketToken.service.js";
import { authRateLimits } from "../src/config/authRateLimit.config.js";
import { rateLimitFallbackInstanceCount } from "../src/utils/rateLimitStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerScript = join(__dirname, "multi-instance-redis-worker.ts");
const s = `mir_${Date.now()}`;

/**
 * MIR_FALLBACK_INSTANCE_COUNT unset: workers start WITHOUT RATE_LIMIT_FALLBACK_INSTANCE_COUNT, i.e.
 * the shipped default (1). Set it (e.g. 2) to test an explicitly configured fleet.
 */
const configuredFallback = process.env.MIR_FALLBACK_INSTANCE_COUNT?.trim() || "";
const FALLBACK_INSTANCES = configuredFallback ? Number(configuredFallback) : 1;

// The default must be 1 whenever the variable is absent or unusable.
{
  const saved = process.env.RATE_LIMIT_FALLBACK_INSTANCE_COUNT;
  const cases: Array<[string | undefined, number]> = [
    [undefined, 1],
    ["", 1],
    ["abc", 1],
    ["0", 1],
    ["-3", 1],
    ["1", 1],
    ["2", 2],
    ["99", 20],
  ];
  for (const [raw, expected] of cases) {
    if (raw === undefined) delete process.env.RATE_LIMIT_FALLBACK_INSTANCE_COUNT;
    else process.env.RATE_LIMIT_FALLBACK_INSTANCE_COUNT = raw;
    assert.equal(rateLimitFallbackInstanceCount(), expected, `RATE_LIMIT_FALLBACK_INSTANCE_COUNT=${raw ?? "<absent>"}`);
  }
  if (saved === undefined) delete process.env.RATE_LIMIT_FALLBACK_INSTANCE_COUNT;
  else process.env.RATE_LIMIT_FALLBACK_INSTANCE_COUNT = saved;
  console.log("  ✓ fallback-default: absent/empty/invalid → 1, explicit 2 → 2, capped at 20");
}

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const realRedis = process.env.REDIS_URL?.trim() ?? "";
const redisMatch = /^redis:\/\/(127\.0\.0\.1|localhost):(\d+)\/?$/.exec(realRedis);
if (!redisMatch) {
  console.error("REFUSING: REDIS_URL must be a disposable loopback Redis (set CARETIP_ISOLATED_REDIS_URL via safe-test)");
  process.exit(2);
}
const redisPort = Number(redisMatch[2]);

// Every request here comes from loopback, so the login limiter's per-IP layer is shared with any
// other suite that used this Redis in the last 15 minutes. Start this run with that budget clear.
// (Disposable loopback Redis only, enforced above.)
{
  const Redis = (await import("ioredis")).default;
  const admin = new Redis(realRedis, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await admin.connect();
  const ipKeys = (await admin.keys("auth:login:ip:*")).filter((k) => /:ip:(127\.|::1$|::ffff:127\.)/.test(k));
  if (ipKeys.length) await admin.del(...ipKeys);
  await admin.quit();
}

// --- Loopback TCP proxy in front of Redis: closing it is the outage --------------------------------
const proxyConns = new Set<net.Socket>();
let proxyServer: net.Server | null = null;
function proxyListen(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      const upstream = net.connect(redisPort, "127.0.0.1");
      proxyConns.add(client);
      proxyConns.add(upstream);
      const close = () => {
        client.destroy();
        upstream.destroy();
        proxyConns.delete(client);
        proxyConns.delete(upstream);
      };
      client.on("error", close);
      upstream.on("error", close);
      client.on("close", close);
      upstream.on("close", close);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      proxyServer = server;
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}
async function proxyCut(): Promise<void> {
  const server = proxyServer;
  proxyServer = null;
  const closed = new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  for (const c of proxyConns) c.destroy();
  proxyConns.clear();
  await closed;
}
const proxyPort = await proxyListen(0);

// --- Workers ------------------------------------------------------------------------------------
type Worker = { name: string; port: number; base: string; child: ChildProcess; output: string[]; exited: boolean };

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });
}

async function startWorker(name: string): Promise<Worker> {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    REDIS_URL: `redis://127.0.0.1:${proxyPort}`,
    SOCKET_REDIS_ADAPTER_ENABLED: "true",
    RENDER_INSTANCE_ID: name,
  };
  if (configuredFallback) env.RATE_LIMIT_FALLBACK_INSTANCE_COUNT = configuredFallback;
  else delete env.RATE_LIMIT_FALLBACK_INSTANCE_COUNT;
  const child = spawn("npx", ["tsx", workerScript, String(port)], {
    cwd: join(__dirname, ".."),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  const w: Worker = { name, port, base: `http://127.0.0.1:${port}`, child, output: [], exited: false };
  const onData = (chunk: Buffer) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) w.output.push(line);
  };
  child.stdout!.on("data", onData);
  child.stderr!.on("data", onData);
  child.on("exit", () => {
    w.exited = true;
  });
  const deadline = Date.now() + 90_000;
  while (!w.output.some((l) => l.startsWith(`READY ${port}`))) {
    if (w.exited) throw new Error(`${name} exited during startup:\n${w.output.join("\n")}`);
    if (Date.now() > deadline) throw new Error(`${name} did not start:\n${w.output.join("\n")}`);
    await sleep(200);
  }
  return w;
}

/** shell: true puts a shell in between; on Windows only a tree kill reaches the worker itself. */
function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function post(w: Worker, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${w.base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
async function get(w: Worker, path: string): Promise<Record<string, unknown>> {
  return (await (await fetch(`${w.base}${path}`)).json()) as Record<string, unknown>;
}
type HealthState = { rateLimit: { state: string }; socketAdapter: { state: string } };
async function redisState(w: Worker): Promise<HealthState> {
  return (await get(w, "/__test/health")).redis as HealthState;
}
async function waitFor(what: string, check: () => Promise<boolean>, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function connect(w: Worker, auth: Record<string, unknown>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = ioClient(w.base, { auth, transports: ["websocket"], reconnection: false, timeout: 10_000 });
    sock.once("connect", () => resolve(sock));
    sock.once("connect_error", (err) => {
      sock.close();
      reject(err);
    });
  });
}
function nextEvent(sock: Socket, event: string, ms = 8_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      sock.off(event, on);
      reject(new Error(`no "${event}" within ${ms}ms`));
    }, ms);
    const on = (payload: unknown) => {
      clearTimeout(t);
      resolve(payload);
    };
    sock.once(event, on);
  });
}
async function expectNoEvent(sock: Socket, event: string, ms = 1_500): Promise<void> {
  let got = false;
  const on = () => {
    got = true;
  };
  sock.on(event, on);
  await sleep(ms);
  sock.off(event, on);
  assert.equal(got, false, `unexpected "${event}"`);
}

// --- Fixtures -----------------------------------------------------------------------------------
const managerUser = await prisma.user.create({
  data: { email: `mir-mgr-${s}@example.com`, passwordHash: "x", role: Role.MANAGER, emailVerified: true, isActive: true },
});
const employeeUser = await prisma.user.create({
  data: { email: `mir-emp-${s}@example.com`, passwordHash: "x", role: Role.EMPLOYEE, emailVerified: true, isActive: true },
});
const business = await prisma.business.create({ data: { name: `MIR ${s}`, slug: `mir-${s}`, userId: managerUser.id } });
await prisma.employee.create({
  data: { name: `MIR Emp ${s}`, jobTitle: "Server", businessId: business.id, userId: employeeUser.id, isActive: true, activationStatus: "active" },
});
const accessToken = (u: { id: string; role: Role; authTokenVersion: number }) =>
  signJwt({ sub: u.id, role: u.role, type: "access", tv: u.authTokenVersion }, "10m");
const managerToken = accessToken(managerUser);
const employeeToken = accessToken(employeeUser);

const workers: Worker[] = [];
const sockets: Socket[] = [];
try {
  console.log("[multi-instance-redis] starting 2 API instances behind one Redis");
  const [A, B] = await Promise.all([startWorker("instance-a"), startWorker("instance-b")]);
  workers.push(A, B);
  for (const w of workers) {
    const st = await redisState(w);
    assert.equal(st.socketAdapter.state, "ready", `${w.name} adapter ready`);
    assert.equal(st.rateLimit.state, "ready", `${w.name} rate-limit store ready`);
    assert.ok(w.output.some((l) => l.includes("Redis adapter attached")), `${w.name} logged adapter attach`);
    assert.ok(!w.output.some((l) => l.includes("DEGRADED")), `${w.name}: a normal boot must not report an outage`);
  }
  pass("startup", "both instances report socket adapter + rate-limit store ready, attach logged, no false DEGRADED");

  // 1. Cross-instance rooms.
  const managerOnB = await connect(B, { token: managerToken });
  const employeeOnA = await connect(A, { token: employeeToken });
  const guestOnB = await connect(B, { publicRoomToken: signPublicSocketRoomToken(business.id).token });
  sockets.push(managerOnB, employeeOnA, guestOnB);

  const bizEvent = nextEvent(managerOnB, "business_data_updated");
  await post(A, "/__test/emit", { room: `business:${business.id}`, event: "business_data_updated", payload: { n: 1 } });
  assert.deepEqual(await bizEvent, { n: 1 });
  pass("cross-instance-business-room", "emitted on A, received by manager on B");

  const userEvent = nextEvent(employeeOnA, "tip_received");
  const managerSilent = expectNoEvent(managerOnB, "tip_received");
  await post(B, "/__test/emit", { room: `user:${employeeUser.id}`, event: "tip_received", payload: { cents: 500 } });
  assert.deepEqual(await userEvent, { cents: 500 });
  await managerSilent;
  pass("cross-instance-user-room", "emitted on B, received only by that user on A");

  const publicEvent = nextEvent(guestOnB, "business_data_updated");
  await post(A, "/__test/emit", { room: `public:business:${business.id}`, event: "business_data_updated", payload: { p: 1 } });
  assert.deepEqual(await publicEvent, { p: 1 });
  pass("cross-instance-public-room", "emitted on A, received by guest on B");

  // 2. User disconnect across instances, then reconnect.
  const dropped = new Promise<string>((resolve) => employeeOnA.once("disconnect", (reason) => resolve(reason)));
  await post(B, "/__test/disconnect-user", { userId: employeeUser.id });
  assert.equal(await Promise.race([dropped, sleep(8_000).then(() => "timeout")]), "io server disconnect");
  const employeeAgain = await connect(A, { token: employeeToken });
  sockets.push(employeeAgain);
  const again = nextEvent(employeeAgain, "tip_received");
  await post(B, "/__test/emit", { room: `user:${employeeUser.id}`, event: "tip_received", payload: { cents: 1 } });
  assert.deepEqual(await again, { cents: 1 });
  pass("cross-instance-disconnect", "disconnect on B dropped the socket on A; reconnect receives events again");

  // 3. Cache invalidation fan-out.
  const cacheKey = `biz-dash-context:${business.id}`;
  await post(B, "/__test/cache/prime", { key: cacheKey, value: { kyc: "pending" } });
  assert.deepEqual((await get(B, `/__test/cache?key=${encodeURIComponent(cacheKey)}`)).value, { kyc: "pending" });
  await post(A, "/__test/cache/invalidate", { key: cacheKey });
  await waitFor("cache invalidation on B", async () => (await get(B, `/__test/cache?key=${encodeURIComponent(cacheKey)}`)).value === null, 5_000);
  await post(B, "/__test/cache/prime", { key: `biz-dash-sql:${business.id}:week`, value: 1 });
  await post(A, "/__test/cache/invalidate", { prefix: `biz-dash-sql:${business.id}:` });
  await waitFor("prefix invalidation on B", async () => (await get(B, `/__test/cache?key=${encodeURIComponent(`biz-dash-sql:${business.id}:week`)}`)).value === null, 5_000);
  pass("cross-instance-cache-invalidation", "key and prefix invalidated on A are cleared on B");

  // 4. Shared, atomic login counters.
  const lim = authRateLimits.login;
  const effective = Math.min(lim.ip.max, lim.email.max, lim.ipEmail.max);
  const sharedEmail = `mir-shared-${s}@example.com`;
  const attempts = effective * 2 + 4;
  const statuses = await Promise.all(
    Array.from({ length: attempts }, (_, i) =>
      post(i % 2 === 0 ? A : B, "/api/auth/login", { email: sharedEmail, password: "x" }).then((r) => r.status),
    ),
  );
  assert.equal(statuses.filter((x) => x === 200).length, effective, `exactly ${effective} allowed across both instances`);
  assert.equal(statuses.filter((x) => x === 429).length, attempts - effective);
  assert.equal((await post(A, "/api/auth/login", { email: sharedEmail, password: "x" })).status, 429);
  assert.equal((await post(B, "/api/auth/login", { email: sharedEmail, password: "x" })).status, 429);
  pass("shared-login-limit", `${attempts} concurrent attempts split over A/B → exactly ${effective} allowed; switching instance does not help`);

  // 5. Redis outage.
  console.log("[multi-instance-redis] cutting Redis for both instances");
  await proxyCut();
  await waitFor("adapter degraded on both", async () =>
    (await Promise.all(workers.map(redisState))).every((st) => st.socketAdapter.state === "degraded"),
  );
  for (let i = 0; i < 6; i++) {
    await post(A, "/__test/emit", { room: `business:${business.id}`, event: "business_data_updated", payload: { during: i } });
    await post(B, "/__test/emit", { room: `user:${employeeUser.id}`, event: "tip_received", payload: { during: i } });
    await sleep(500);
  }
  const localOnB = nextEvent(managerOnB, "business_data_updated");
  await post(B, "/__test/emit", { room: `business:${business.id}`, event: "business_data_updated", payload: { local: true } });
  assert.deepEqual(await localOnB, { local: true });
  pass("outage-local-delivery", "Redis down: emits do not crash either instance; same-instance delivery still works");

  const outageEmail = `mir-outage-${s}@example.com`;
  const outageStatuses = { A: 0, B: 0 };
  // More attempts than any one instance may allow, so each instance's local cap is actually hit.
  for (let i = 0; i < effective * 2 + 4; i++) {
    const w = i % 2 === 0 ? A : B;
    if ((await post(w, "/api/auth/login", { email: outageEmail, password: "x" })).status === 200) {
      outageStatuses[w === A ? "A" : "B"] += 1;
    }
  }
  const perInstance = Math.max(1, Math.floor(effective / FALLBACK_INSTANCES));
  const fleetTotal = outageStatuses.A + outageStatuses.B;
  assert.equal(outageStatuses.A, perInstance, `A local cap (${JSON.stringify(outageStatuses)})`);
  assert.equal(outageStatuses.B, perInstance, `B local cap (${JSON.stringify(outageStatuses)})`);
  assert.equal(fleetTotal, perInstance * 2);
  if (FALLBACK_INSTANCES >= 2) {
    assert.ok(fleetTotal <= effective, "divided: fleet total never exceeds the configured limit");
    pass("outage-auth-fallback", `Redis down, count=${FALLBACK_INSTANCES}: each instance allows ${perInstance}; fleet total ${fleetTotal} ≤ limit ${effective}`);
  } else {
    // Shipped default: each instance keeps the full limit, so two instances together allow double.
    assert.equal(fleetTotal, effective * 2, "default 1 with two instances: fleet total is double the limit");
    pass("outage-auth-fallback", `Redis down, default count=1: each instance allows the full ${perInstance}; fleet total ${fleetTotal} = 2 × limit ${effective} (documented)`);
  }

  const fin = await post(A, "/__test/fin-check", { key: s });
  assert.equal(fin.json.allowed, false);
  assert.equal(fin.json.storeUnavailable, true);
  pass("outage-financial-fail-closed", "Redis down: financial limiter refuses instead of counting locally");

  for (const w of workers) {
    const st = await redisState(w);
    assert.equal(st.socketAdapter.state, "degraded");
    assert.equal(st.rateLimit.state, "degraded");
    assert.ok(w.output.some((l) => l.includes("[redis] socket_adapter DEGRADED")), `${w.name} logged adapter outage`);
    assert.ok(w.output.some((l) => l.includes("[redis] rate_limit_store DEGRADED")), `${w.name} logged limiter outage`);
    // The outage log must state the fallback that really applies, never claim division it lacks.
    const expectedImpact = FALLBACK_INSTANCES > 1 ? `divided by ${FALLBACK_INSTANCES} per instance` : "NOT divided";
    assert.ok(
      w.output.some((l) => l.includes("rate_limit_store DEGRADED") && l.includes(expectedImpact)),
      `${w.name} outage log says "${expectedImpact}"`,
    );
    const degradedLines = w.output.filter((l) => l.includes("socket_adapter DEGRADED")).length;
    assert.equal(degradedLines, 1, `${w.name}: outage reported once per transition, not per error (${degradedLines})`);
    assert.equal(w.exited, false, `${w.name} still running`);
  }
  assert.ok(!workers.some((w) => w.output.some((l) => /unhandled|UnhandledPromiseRejection|MaxRetriesPerRequest/i.test(l))));
  pass("outage-observable", "both report degraded on health + one log per transition; no unhandled rejections");

  // 6. Recovery.
  console.log("[multi-instance-redis] restoring Redis (rate-limit store retries after its 30s cooldown)");
  await proxyListen(proxyPort);
  await waitFor("adapter recovered on both", async () =>
    (await Promise.all(workers.map(redisState))).every((st) => st.socketAdapter.state === "ready"),
  );
  await sleep(31_000);
  await Promise.all(workers.map((w) => post(w, "/__test/warm", {})));
  await waitFor("rate-limit store recovered on both", async () =>
    (await Promise.all(workers.map(redisState))).every((st) => st.rateLimit.state === "ready"),
  );
  const afterRecovery = nextEvent(managerOnB, "business_data_updated");
  await post(A, "/__test/emit", { room: `business:${business.id}`, event: "business_data_updated", payload: { back: true } });
  assert.deepEqual(await afterRecovery, { back: true });
  for (const w of workers) {
    assert.ok(w.output.some((l) => l.includes("[redis] socket_adapter RECOVERED")), `${w.name} logged adapter recovery`);
    assert.ok(w.output.some((l) => l.includes("[redis] rate_limit_store RECOVERED")), `${w.name} logged limiter recovery`);
  }
  const recoveredEmail = `mir-recovered-${s}@example.com`;
  const recovered = await Promise.all(
    Array.from({ length: effective + 4 }, (_, i) =>
      post(i % 2 === 0 ? A : B, "/api/auth/login", { email: recoveredEmail, password: "x" }).then((r) => r.status),
    ),
  );
  assert.equal(recovered.filter((x) => x === 200).length, effective, "shared counting is back");
  pass("recovery", "adapter + limiter RECOVERED logged; cross-instance delivery and shared counters return");

  console.log("\nmulti-instance-redis-runtime: OK");
} catch (err) {
  for (const w of workers) {
    console.error(`--- ${w.name} output (last 40 lines) ---\n${w.output.slice(-40).join("\n")}`);
  }
  throw err;
} finally {
  for (const sock of sockets) sock.close();
  for (const w of workers) killTree(w.child);
  await sleep(500);
  await proxyCut().catch(() => undefined);
  await prisma.$disconnect();
}
