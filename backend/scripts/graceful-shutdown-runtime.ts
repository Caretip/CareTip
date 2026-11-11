/**
 * SIGTERM handling of the real API process (src/index.ts):
 *  - a request already in flight completes, then the process exits 0 ("all requests finished")
 *  - a health check answered during the drain reports 503 "draining"
 *    (the listener itself closes on SIGTERM, so only requests already in flight see this)
 *  - a request that never completes cannot hang the deploy: exit after SHUTDOWN_DRAIN_MS
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://postgres@127.0.0.1:PORT/db \
 *   node scripts/safe-test.mjs test:graceful-shutdown
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const childScript = join(__dirname, "graceful-shutdown-child.ts");
const DRAIN_MS = 5_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });
}

type Api = { child: ChildProcess; port: number; output: string[]; exit: Promise<{ code: number | null; at: number }> };

async function startApi(): Promise<Api> {
  const port = await freePort();
  const child = spawn("npx", ["tsx", childScript], {
    cwd: join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      SHUTDOWN_DRAIN_MS: String(DRAIN_MS),
      REDIS_URL: "",
      SOCKET_REDIS_ADAPTER_ENABLED: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });
  const output: string[] = [];
  const onData = (chunk: Buffer) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) output.push(line);
  };
  child.stdout!.on("data", onData);
  child.stderr!.on("data", onData);
  const exit = new Promise<{ code: number | null; at: number }>((resolve) =>
    child.on("exit", (code) => resolve({ code, at: Date.now() })),
  );
  const deadline = Date.now() + 90_000;
  while (!output.some((l) => l.includes("Caretip API running"))) {
    if (child.exitCode !== null) throw new Error(`API exited during startup:\n${output.join("\n")}`);
    if (Date.now() > deadline) throw new Error(`API did not start:\n${output.join("\n")}`);
    await sleep(200);
  }
  return { child, port, output, exit };
}

/**
 * Opens GET /api/health with a JSON body that is only partly sent: the JSON parser waits for the
 * rest, so the request is in flight (headers received, handler not yet run).
 */
function openPartialRequest(port: number): Promise<{ finish: () => void; response: Promise<string> }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      const body = JSON.stringify({ hold: "open" });
      sock.write(
        "GET /api/health HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Content-Type: application/json\r\n" +
          `Content-Length: ${body.length}\r\n` +
          "Connection: close\r\n\r\n" +
          body.slice(0, 4),
      );
      let data = "";
      const response = new Promise<string>((res) => {
        sock.on("data", (c) => {
          data += String(c);
        });
        sock.on("close", () => res(data));
        sock.on("error", () => res(data));
      });
      resolve({ finish: () => sock.end(body.slice(4)), response });
    });
    sock.on("error", reject);
  });
}

// Scenario 1: in-flight request completes (and sees "draining"), then a clean exit.
{
  const api = await startApi();
  assert.equal((await fetch(`http://127.0.0.1:${api.port}/api/health`)).status, 200, "healthy before shutdown");
  const req = await openPartialRequest(api.port);
  await sleep(300);
  const termAt = Date.now();
  api.child.stdin!.write("TERM\n");
  await sleep(1_000);
  assert.equal(api.child.exitCode, null, "still running while a request is in flight");
  req.finish();
  const response = await req.response;
  assert.match(response, /^HTTP\/1\.1 503/, `in-flight request answered, not cut off: ${response.slice(0, 80)}`);
  assert.match(response, /"status":"draining"/, "health reports draining");
  const { code, at } = await api.exit;
  assert.equal(code, 0);
  assert.ok(at - termAt < DRAIN_MS, `exited once requests finished (${at - termAt}ms), before the drain timeout`);
  assert.ok(api.output.some((l) => l.includes("[server] SIGTERM: draining")));
  assert.ok(api.output.some((l) => l.includes("shutdown: all requests finished")), api.output.join("\n"));
  pass("drain-completes", `in-flight request answered 503 draining, then exit 0 after ${at - termAt}ms`);
}

// Scenario 2: a request that never finishes cannot hang the deploy.
{
  const api = await startApi();
  await openPartialRequest(api.port);
  await sleep(300);
  const termAt = Date.now();
  api.child.stdin!.write("TERM\n");
  const { code, at } = await api.exit;
  const took = at - termAt;
  assert.equal(code, 0);
  assert.ok(took >= DRAIN_MS - 250 && took < DRAIN_MS + 5_000, `forced exit near SHUTDOWN_DRAIN_MS (${took}ms)`);
  assert.ok(api.output.some((l) => l.includes("drain timeout reached")), api.output.join("\n"));
  pass("drain-timeout", `stuck request: process exited after ${took}ms (SHUTDOWN_DRAIN_MS=${DRAIN_MS})`);
}

console.log("\ngraceful-shutdown-runtime: OK");
