/**
 * Error responses: safe message, correlation id, no internals. Local Express app on a random port,
 * no database, no network beyond loopback.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import "express-async-errors";
import { requestIdMiddleware } from "../src/middleware/requestId.middleware.js";
import { errorHandler } from "../src/middleware/errorHandler.middleware.js";

const app = express();
app.use(requestIdMiddleware);
app.get("/boom", () => {
  throw new Error("PrismaClientKnownRequestError: relation users violates constraint at /srv/app/db.ts:42");
});
app.get("/async-boom", async () => {
  await Promise.resolve();
  throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { status: 503 });
});
app.get("/bad", () => {
  throw Object.assign(new Error("Location name is required"), { status: 400 });
});
app.get("/ok", (_req, res) => {
  res.json({ ok: true });
});
app.use(errorHandler);

const originalError = console.error;
const logged: string[] = [];
console.error = (...args: unknown[]) => {
  logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
};

const server = app.listen(0);
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;
let checks = 0;
const ok = (cond: unknown, name: string) => {
  assert.ok(cond, name);
  checks++;
};

try {
  const INTERNAL = /prisma|relation|constraint|\/srv\/|db\.ts|ECONNREFUSED|10\.0\.0\.5|5432|stack|at /i;

  const r500 = await fetch(`${base}/boom`);
  const b500 = (await r500.json()) as { message: string; requestId?: string };
  ok(r500.status === 500, "500 status kept");
  ok(typeof b500.message === "string" && b500.message.length > 0, "500 has a message");
  ok(!INTERNAL.test(b500.message), `500 message has no internals: ${b500.message}`);
  ok(typeof b500.requestId === "string" && b500.requestId.length >= 8, "500 body carries requestId");
  ok(r500.headers.get("x-request-id") === b500.requestId, "header and body ids match");
  ok(!JSON.stringify(b500).includes("stack"), "no stack in body");
  ok(logged.some((l) => l.includes(b500.requestId!)), "server log line carries the same requestId");

  const r503 = await fetch(`${base}/async-boom`);
  const b503 = (await r503.json()) as { message: string; requestId?: string };
  ok(r503.status === 503, "async 503 status kept");
  ok(!INTERNAL.test(b503.message), `503 message has no internals: ${b503.message}`);
  ok(Boolean(b503.requestId), "503 carries requestId");

  const r400 = await fetch(`${base}/bad`);
  const b400 = (await r400.json()) as { message: string; requestId?: string };
  ok(r400.status === 400, "400 status kept");
  ok(Boolean(b400.requestId), "400 carries requestId");

  const okRes = await fetch(`${base}/ok`);
  ok(Boolean(okRes.headers.get("x-request-id")), "successful responses carry X-Request-Id");

  const forwarded = await fetch(`${base}/ok`, { headers: { "x-request-id": "rndr-abc123def456" } });
  ok(forwarded.headers.get("x-request-id") === "rndr-abc123def456", "safe upstream id reused");

  const hostile = await fetch(`${base}/ok`, { headers: { "x-request-id": "evil id <script>alert(1)</script>" } });
  const hostileId = hostile.headers.get("x-request-id") ?? "";
  ok(!/[<>\s\u0000]/.test(hostileId) && hostileId !== "evil", "unsafe upstream id replaced");

  const ids = new Set<string>();
  for (let i = 0; i < 20; i++) ids.add((await fetch(`${base}/ok`)).headers.get("x-request-id") ?? "");
  ok(ids.size === 20, "ids are unique per request");
} finally {
  console.error = originalError;
  server.close();
}

console.log(`error-response-request-id-runtime: ok (${checks} checks)`);
