import { Server } from "socket.io";
import type { Server as HttpServer } from "http";
import { Role } from "@prisma/client";
import { prisma } from "../prisma.js";
import { socketCorsOptions } from "../config/cors.js";
import {
  isAllowedAccessJwtType,
  resolveJwtSubject,
  verifyJwt,
  type DecodedAccessClaims,
} from "../lib/jwtConfig.js";

import { businessIdFromPublicSocketRoomToken } from "../services/publicSocketToken.service.js";

let io: Server | null = null;

/** Maps socket.id → userId for observability (optional). */
const socketUserMap = new Map<string, string>();

interface JwtLike extends DecodedAccessClaims {
  role: Role;
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
  // Also disconnect any socket in user room that was not in the map (recovery edge cases).
  void io.in(`user:${id}`).fetchSockets().then((sockets) => {
    for (const s of sockets) {
      s.disconnect(true);
    }
  }).catch(() => {
    /* best-effort */
  });
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
      if (!isAllowedAccessJwtType(decoded.type)) {
        return next(new Error("Unauthorized"));
      }
      const userId = resolveJwtSubject(decoded);
      if (!userId) {
        return next(new Error("Unauthorized"));
      }

      const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, isActive: true },
      });
      if (!userRow || userRow.isActive !== true) {
        return next(new Error("Unauthorized"));
      }

      socket.data.userId = userId;
      socket.data.role = userRow.role;

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
