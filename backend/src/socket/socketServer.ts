import { Server } from "socket.io";
import type { Server as HttpServer } from "http";
import { Role } from "@prisma/client";
import { prisma } from "../prisma.js";
import { socketCorsOptions } from "../config/cors.js";
import {
  isAllowedAccessJwtType,
  verifyJwt,
  type DecodedAccessClaims,
} from "../lib/jwtConfig.js";
import { isPendingMfaLoginJwt } from "../services/mfaLogin.service.js";
import {
  assertAccessJwtStillValid,
  normalizeJwtPayload,
} from "../middleware/auth.middleware.js";
import { businessIdFromPublicSocketRoomToken } from "../services/publicSocketToken.service.js";
import { reportRedisState } from "../lib/redisHealth.js";
import { applyRemoteCacheInvalidations, setCacheInvalidationBroadcaster } from "../utils/shortLivedCache.js";

let io: Server | null = null;

/** Maps socket.id → userId for observability (optional). */
const socketUserMap = new Map<string, string>();

interface JwtLike extends DecodedAccessClaims {
  role: Role;
}

const REDIS_ADAPTER_MODULE: string = "@socket.io/redis-adapter";
const SOCKET_SESSION_SWEEP_MS = 5 * 60 * 1000;
let socketSweepTimer: ReturnType<typeof setInterval> | null = null;

/** Sockets outlive their access token, so sessions revoked elsewhere are re-checked here. */
export async function sweepRevokedSockets(): Promise<number> {
  if (!io) return 0;
  let dropped = 0;
  for (const socket of io.sockets.sockets.values()) {
    const claims = socket.data.sessionClaims as Parameters<typeof assertAccessJwtStillValid>[0] | undefined;
    if (!claims) continue;
    const stale = await assertAccessJwtStillValid(claims).catch(() => null);
    if (stale) {
      socket.disconnect(true);
      dropped += 1;
    }
  }
  return dropped;
}

function startSocketSessionSweep(): void {
  if (socketSweepTimer) return;
  socketSweepTimer = setInterval(() => void sweepRevokedSockets().catch(() => undefined), SOCKET_SESSION_SWEEP_MS);
  socketSweepTimer.unref?.();
}

type AdapterRedisClient = {
  status: string;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  quit(): Promise<unknown>;
  disconnect(): void;
  [method: string]: unknown;
};

/** How long startup waits for the adapter before serving anyway (degraded, and reported). */
const ADAPTER_READY_TIMEOUT_MS = 5_000;
const ADAPTER_RETRY_MAX_DELAY_MS = 5_000;

let adapterPub: AdapterRedisClient | null = null;
let adapterSub: AdapterRedisClient | null = null;
let adapterClosing = false;
let adapterReady: Promise<void> = Promise.resolve();

/** Server-to-server event (never sent to browsers) carrying cache invalidations. */
export const CACHE_INVALIDATE_EVENT = "caretip:cache-invalidate";

/** True when SOCKET_REDIS_ADAPTER_ENABLED=true; REDIS_URL must then be set too. */
export function socketRedisAdapterRequested(): boolean {
  return process.env.SOCKET_REDIS_ADAPTER_ENABLED?.trim() === "true";
}

/**
 * The adapter never awaits or catches its publish/subscribe promises. A rejected command (Redis
 * down) would be an unhandled rejection, which ends the Node process. Mark every one handled and
 * report it instead.
 */
function guardCommands(client: AdapterRedisClient, methods: string[]): void {
  for (const name of methods) {
    const original = client[name];
    if (typeof original !== "function") continue;
    client[name] = (...args: unknown[]) => {
      const result = (original as (...a: unknown[]) => unknown).apply(client, args);
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch((err: unknown) => {
          if (!adapterClosing) reportRedisState("socketAdapter", "degraded", err);
        });
      }
      return result;
    };
  }
}

function watchAdapterClients(pub: AdapterRedisClient, sub: AdapterRedisClient): void {
  // Ready only once both are; a lost connection is an outage. One client becoming ready before the
  // other (every startup and reconnect) is neither, so "ready" never reports degraded.
  const onReady = () => {
    if (adapterClosing) return;
    if (pub.status === "ready" && sub.status === "ready") reportRedisState("socketAdapter", "ready");
  };
  const onLost = (err: unknown) => {
    if (adapterClosing) return;
    reportRedisState("socketAdapter", "degraded", err);
  };
  for (const client of [pub, sub]) {
    client.on("ready", onReady);
    client.on("close", () => onLost(new Error("connection closed")));
    client.on("end", () => onLost(new Error("connection ended")));
    // ioredis emits "error" for every failed attempt; state changes are reported, not each error.
    client.on("error", (err: unknown) => onLost(err));
  }
}

function waitForReady(client: AdapterRedisClient, ms: number): Promise<boolean> {
  if (client.status === "ready") return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    timer.unref?.();
    client.once("ready", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * Without this, an event raised on one API instance only reaches sockets on that instance.
 * Opt-in (SOCKET_REDIS_ADAPTER_ENABLED=true + REDIS_URL), so one instance works with no Redis.
 * A Redis outage never takes the API down: delivery falls back to this instance, clients recover
 * through REST, and the outage is logged and sent to Sentry on each state change.
 */
async function attachRedisAdapter(): Promise<void> {
  if (!io) return;
  const url = process.env.REDIS_URL?.trim();
  if (!socketRedisAdapterRequested()) {
    reportRedisState("socketAdapter", "disabled");
    if (url) {
      console.warn(
        "[socket] REDIS_URL is set but SOCKET_REDIS_ADAPTER_ENABLED is not \"true\": live events stay on this instance",
      );
    }
    return;
  }
  if (!url) {
    reportRedisState("socketAdapter", "degraded", new Error("SOCKET_REDIS_ADAPTER_ENABLED=true but REDIS_URL is not set"));
    return;
  }
  reportRedisState("socketAdapter", "connecting");
  try {
    const [{ createAdapter }, RedisModule] = await Promise.all([
      import(/* optional, see package.json */ REDIS_ADAPTER_MODULE) as Promise<{
        createAdapter: (pub: unknown, sub: unknown, opts?: Record<string, unknown>) => Parameters<Server["adapter"]>[0];
      }>,
      import("ioredis"),
    ]);
    const Redis = RedisModule.default as unknown as new (u: string, opts: Record<string, unknown>) => AdapterRedisClient;
    const retryStrategy = (times: number) => Math.min(times * 200, ADAPTER_RETRY_MAX_DELAY_MS);
    // Publisher: fail fast while disconnected. Queued events would arrive late and out of order;
    // clients already re-read state over REST after a reconnect.
    const pub = new Redis(url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy,
      connectionName: "caretip-socket-pub",
    });
    // Subscriber: keep its (few) subscribe commands until connected; ioredis resubscribes itself
    // after every reconnect.
    const sub = new Redis(url, {
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
      retryStrategy,
      connectionName: "caretip-socket-sub",
    });
    guardCommands(pub, ["publish"]);
    guardCommands(sub, ["subscribe", "psubscribe", "unsubscribe", "punsubscribe"]);
    watchAdapterClients(pub, sub);
    adapterPub = pub;
    adapterSub = sub;
    io.adapter(createAdapter(pub, sub, { key: "caretip-socket.io" }));
    const server = io;
    server.on(CACHE_INVALIDATE_EVENT, (ops: unknown) => {
      applyRemoteCacheInvalidations(ops);
    });
    setCacheInvalidationBroadcaster((ops) => {
      server.serverSideEmit(CACHE_INVALIDATE_EVENT, ops);
    });
    const [pubOk, subOk] = await Promise.all([
      waitForReady(pub, ADAPTER_READY_TIMEOUT_MS),
      waitForReady(sub, ADAPTER_READY_TIMEOUT_MS),
    ]);
    if (pubOk && subOk) {
      console.info("[socket] Redis adapter attached: live events are shared across instances");
    } else {
      reportRedisState("socketAdapter", "degraded", new Error("Redis not ready within startup timeout; retrying in background"));
    }
  } catch (err) {
    reportRedisState("socketAdapter", "degraded", err);
  }
}

/** Resolves once the adapter is attached and ready, or after its startup timeout. Never rejects. */
export function socketAdapterReady(): Promise<void> {
  return adapterReady;
}

/** Stop accepting and close open sockets, then release Redis. Used during shutdown. */
export async function closeSocketServer(): Promise<void> {
  if (socketSweepTimer) clearInterval(socketSweepTimer);
  socketSweepTimer = null;
  setCacheInvalidationBroadcaster(null);
  await io?.close();
  adapterClosing = true;
  for (const client of [adapterPub, adapterSub]) {
    if (!client) continue;
    await Promise.race([
      client.quit().catch(() => client.disconnect()),
      new Promise((resolve) => setTimeout(resolve, 1_000).unref?.()),
    ]);
  }
  adapterPub = null;
  adapterSub = null;
}

export function getSocketIO(): Server | null {
  return io;
}

/** Disconnect all authenticated sockets for a user (deactivate / erasure). */
export function disconnectUserSockets(userId: string): void {
  const id = String(userId ?? "").trim();
  if (!id || !io) return;
  for (const [socketId, mappedUserId] of socketUserMap) {
    if (mappedUserId !== id) continue;
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.disconnect(true);
    }
    socketUserMap.delete(socketId);
  }
  // Every instance: a broadcast through the adapter, so sockets held by other instances drop too.
  // (fetchSockets would need a reply from every instance and fails as a whole if one is slow.)
  io.in(`user:${id}`).disconnectSockets(true);
}

export function initSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: socketCorsOptions,
    connectionStateRecovery: {},
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token as string | undefined;
      const publicRoomToken = socket.handshake.auth.publicRoomToken as string | undefined;

      if (!token) {
        const businessIdFromToken = businessIdFromPublicSocketRoomToken(
          typeof publicRoomToken === "string" ? publicRoomToken : "",
        );
        if (!businessIdFromToken) {
          return next(new Error("Unauthorized"));
        }
        const b = await prisma.business.findUnique({
          where: { id: businessIdFromToken },
          select: { id: true },
        });
        if (!b) return next(new Error("Invalid business"));
        socket.data.publicBusinessId = b.id;
        socket.data.isPublic = true;
        return next();
      }

      const decoded = verifyJwt<JwtLike>(token);
      if (isPendingMfaLoginJwt(decoded) || !isAllowedAccessJwtType(decoded.type)) {
        return next(new Error("Unauthorized"));
      }
      const sessionPayload = normalizeJwtPayload(decoded);
      if (!sessionPayload) {
        return next(new Error("Unauthorized"));
      }
      if (await assertAccessJwtStillValid(sessionPayload)) {
        return next(new Error("Unauthorized"));
      }
      const userId = sessionPayload.sub;

      const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, isActive: true },
      });
      if (!userRow || userRow.isActive !== true) {
        return next(new Error("Unauthorized"));
      }

      socket.data.userId = userId;
      socket.data.role = userRow.role;
      socket.data.sessionClaims = sessionPayload;

      if (userRow.role === "EMPLOYEE") {
        const emp = await prisma.employee.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (!emp) {
          return next(new Error("Forbidden"));
        }
        socket.data.employeeId = emp.id;
      } else if (userRow.role === "MANAGER") {
        const biz = await prisma.business.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (!biz) {
          return next(new Error("Forbidden"));
        }
        socket.data.businessId = biz.id;
      } else if (userRow.role === "SUPER_ADMIN") {
        const row = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true, isPlatformAdmin: true, isActive: true },
        });
        if (
          !row ||
          row.role !== Role.SUPER_ADMIN ||
          !row.isPlatformAdmin ||
          !row.isActive
        ) {
          return next(new Error("Forbidden"));
        }
        socket.data.isPlatformAdmin = true;
      } else {
        return next(new Error("Forbidden"));
      }

      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  startSocketSessionSweep();
  adapterReady = attachRedisAdapter().catch((err: unknown) => {
    reportRedisState("socketAdapter", "degraded", err);
  });

  io.on("connection", (socket) => {
    if (socket.data.isPublic) {
      const bid = socket.data.publicBusinessId as string;
      socket.join(`public:business:${bid}`);
      return;
    }

    const userId = socket.data.userId as string;
    socketUserMap.set(socket.id, userId);
    socket.join(`user:${userId}`);

    if (socket.data.employeeId) {
      socket.join(`employee:${socket.data.employeeId}`);
    }
    if (socket.data.businessId) {
      socket.join(`business:${socket.data.businessId}`);
    }
    if (socket.data.isPlatformAdmin) {
      socket.join("platform");
    }

    socket.on("disconnect", () => {
      socketUserMap.delete(socket.id);
    });
  });

  return io;
}
