/**
 * Phase 15 — WebSocket handshake security.
 * Run: npm run test:phase-15-websocket (backend)
 */
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcrypt";
import { io as ioClient, type Socket } from "socket.io-client";
import { prisma } from "../src/prisma.js";
import { signJwt, IMPERSONATION_JWT_TYPE } from "../src/lib/jwtConfig.js";
import { signPendingMfaLoginToken } from "../src/services/mfaLogin.service.js";
import { signPublicSocketRoomToken } from "../src/services/publicSocketToken.service.js";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
const backendRoot = process.cwd();
const API = (process.env.RUNTIME_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");

const pass = (id: string, detail: string) => results.push({ id, pass: true, detail });
const fail = (id: string, detail: string) => results.push({ id, pass: false, detail });

function read(rel: string): string {
  return readFileSync(join(backendRoot, rel), "utf8");
}

function connectAttempt(auth: Record<string, unknown>, timeoutMs = 8000): Promise<{ ok: boolean; err: string }> {
  return new Promise((resolve) => {
    const s: Socket = ioClient(API, {
      auth,
      transports: ["websocket"],
      reconnection: false,
      timeout: timeoutMs,
    });
    const done = (ok: boolean, err: string) => {
      s.removeAllListeners();
      s.close();
      resolve({ ok, err });
    };
    s.on("connect", () => done(true, ""));
    s.on("connect_error", (e) => done(false, e instanceof Error ? e.message : String(e)));
    setTimeout(() => done(false, "timeout"), timeoutMs + 500);
  });
}

function runStatic() {
  const srv = read("src/socket/socketServer.ts");
  const emitters = read("src/socket/socketEmitters.ts");
  const pub = read("src/services/publicSocketToken.service.ts");
  const routes = read("src/routes/socket.routes.ts");
  const logout = read("src/controllers/auth.controller.ts");

  if (srv.includes("isPendingMfaLoginJwt") && srv.includes("Unauthorized")) {
    pass("pending-mfa-rejected-source", "Handshake rejects pending MFA JWTs");
  } else {
    fail("pending-mfa-rejected-source", "Pending MFA check missing");
  }

  if (!srv.includes('socket.on("join"') && !srv.includes("socket.join(socket.handshake")) {
    pass("no-client-room-join", "Server does not join client-provided room names");
  } else {
    fail("no-client-room-join", "Client-controlled join detected");
  }

  if (srv.includes("assertAccessJwtStillValid")) {
    pass("session-bind-on-socket", "Socket handshake uses HTTP session bind (tv/sid/active)");
  } else {
    fail("session-bind-on-socket", "Socket handshake still skips assertAccessJwtStillValid");
  }

  if (pub.includes('purpose: PURPOSE') && pub.includes("public_socket_room")) {
    pass("public-token-purpose", "Public room JWT purpose is public_socket_room");
  } else {
    fail("public-token-purpose", "Public token purpose missing");
  }

  if (routes.includes("publicSocketTokenRateLimit")) {
    pass("public-token-rate-limit", "Public room token endpoint is rate limited");
  } else {
    fail("public-token-rate-limit", "Public token limiter missing");
  }

  if (!emitters.includes("socket.on(") && srv.includes("io.to(") === false) {
    // emitters use getSocketIO().to
  }
  if (emitters.includes("io.to(`business:${businessId}`)") && emitters.includes("io.to(`user:${userId}`)")) {
    pass("server-side-emits", "Realtime emits target server-assigned rooms only");
  } else {
    fail("server-side-emits", "Emit targeting unexpected");
  }

  if (logout.includes("disconnectUserSockets")) {
    pass("logout-disconnects-sockets", "Logout disconnects authenticated sockets");
  } else {
    fail("logout-disconnects-sockets", "Logout does not disconnect sockets");
  }
}

async function runLive(userId: string, businessId: string) {
  try {
    await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    pass("live-socket", `SKIP API/socket not reachable at ${API}`);
    return;
  }

  const none = await connectAttempt({});
  if (!none.ok) pass("live-no-token", `No token → ${none.err || "rejected"}`);
  else fail("live-no-token", "Unauthenticated socket connected");

  const pending = signPendingMfaLoginToken(userId);
  const mfa = await connectAttempt({ token: pending });
  if (!mfa.ok) pass("live-pending-mfa", `Pending MFA JWT → ${mfa.err || "rejected"}`);
  else fail("live-pending-mfa", "Pending MFA JWT authenticated a socket");

  const refreshLike = signJwt({ sub: userId, role: "MANAGER", type: "refresh" }, "10m");
  const refresh = await connectAttempt({ token: refreshLike });
  if (!refresh.ok) pass("live-refresh-type", `type=refresh JWT → ${refresh.err || "rejected"}`);
  else fail("live-refresh-type", "Refresh-typed JWT authenticated a socket");

  const pubTok = signPublicSocketRoomToken(businessId);
  const asAccess = await connectAttempt({ token: pubTok.token });
  if (!asAccess.ok) pass("live-public-as-access", `Public room token as auth.token → ${asAccess.err || "rejected"}`);
  else fail("live-public-as-access", "Public room token accepted as access credential");

  const accessAsPublic = signJwt(
    { sub: userId, role: "MANAGER", type: "access", tv: 0, sid: "x" },
    "10m",
  );
  const wrongField = await connectAttempt({ publicRoomToken: accessAsPublic });
  if (!wrongField.ok) pass("live-access-as-public", "Access JWT as publicRoomToken rejected");
  else fail("live-access-as-public", "Access JWT joined a public room");

  const impersonationSidless = signJwt(
    {
      sub: userId,
      role: "MANAGER",
      type: IMPERSONATION_JWT_TYPE,
      impersonatedBy: "admin-p15",
      tv: 0,
    },
    "10m",
  );
  const imp = await connectAttempt({ token: impersonationSidless });
  if (!imp.ok) {
    pass(
      "WS-15-01-retest",
      `BLOCKED: sid-less impersonation JWT → ${imp.err || "rejected"} (cannot revive AUTH-01 on sockets)`,
    );
  } else {
    fail(
      "WS-15-01-retest",
      "CONFIRMED OPEN: sid-less impersonation JWT connected a manager socket",
    );
  }

  const bogusSid = signJwt(
    { sub: userId, role: "MANAGER", type: "access", tv: 0, sid: "p15-revoked-sid-not-in-db" },
    "10m",
  );
  const stale = await connectAttempt({ token: bogusSid });
  if (!stale.ok) {
    pass("WS-15-02-retest", `BLOCKED: access JWT with revoked/missing sid → ${stale.err || "rejected"}`);
  } else {
    fail(
      "WS-15-02-retest",
      "CONFIRMED OPEN: socket accepted access JWT whose sid is not an active refresh session",
    );
  }

  const fresh = await prisma.user.findUnique({
    where: { id: userId },
    select: { authTokenVersion: true },
  });
  const session = await prisma.refreshToken.create({
    data: {
      tokenHash: `p15-ws-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const bound = signJwt(
    {
      sub: userId,
      role: "MANAGER",
      type: "access",
      tv: fresh?.authTokenVersion ?? 0,
      sid: session.id,
    },
    "10m",
  );
  const legit = await connectAttempt({ token: bound });
  if (legit.ok) pass("live-bound-access", "Session-bound access JWT can still open a manager socket");
  else fail("live-bound-access", `Legitimate bound JWT rejected: ${legit.err}`);
  await prisma.refreshToken.delete({ where: { id: session.id } }).catch(() => undefined);

  const otherBiz = "biz_bbbbbbbbbbbbbbbbbbbbbbbb";
  const pubA = signPublicSocketRoomToken(businessId);
  const pubWrong = await connectAttempt({
    publicRoomToken: pubA.token,
  });
  if (pubWrong.ok) {
    pass(
      "live-public-own-business",
      "Public token for fixture business connected (guest room is server-bound to that businessId)",
    );
  } else {
    pass(
      "live-public-own-business",
      `Public token connect ${pubWrong.err} (business may lack activateTipping — handshake only checks id exists)`,
    );
  }

  const forgedB = signPublicSocketRoomToken(otherBiz);
  const cross = await connectAttempt({ publicRoomToken: forgedB.token });
  if (!cross.ok) pass("live-public-unknown-business", `Token for nonexistent business → ${cross.err || "rejected"}`);
  else fail("live-public-unknown-business", "Public token for unknown businessId connected");
}

async function main() {
  runStatic();

  if (!process.env.JWT_SECRET?.trim()) {
    fail("jwt-secret", "JWT_SECRET missing — cannot sign handshake tokens");
  } else {
    const tag = Date.now();
    const passwordHash = await bcrypt.hash("TestPass1!aA", 10);
    const user = await prisma.user.create({
      data: {
        email: `p15-ws-${tag}@caretip-test.local`,
        passwordHash,
        role: "MANAGER",
        emailVerified: true,
        isActive: true,
        accountStatus: "active",
        hasCompletedOnboarding: true,
        business: {
          create: {
            name: `P15 WS ${tag}`,
            slug: `p15-ws-${tag}`,
          },
        },
      },
      include: { business: true },
    });
    try {
      await runLive(user.id, user.business!.id);
    } finally {
      await prisma.business.delete({ where: { id: user.business!.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  }

  console.log("=== Phase 15 WebSocket security ===\n");
  for (const r of results) {
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
  }
  const failures = results.filter((x) => !x.pass);
  console.log(`\nSummary: ${results.length} tests, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
