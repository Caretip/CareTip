import type { Request, Response } from "express";
import { prisma } from "../prisma.js";
import { getRedisHealthSnapshot } from "../lib/redisHealth.js";
import { isProcessDraining } from "../lib/processLifecycle.js";

async function probeDatabase(): Promise<"connected" | "disconnected"> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "connected";
  } catch {
    return "disconnected";
  }
}

/**
 * Public readiness probe for clients, load balancers, and local dev.
 * 503 when the database is unreachable or this instance is shutting down. Redis never fails the
 * check: without it the API still serves (degraded, and alerted on). Its state is not public in
 * production (it would tell an attacker when limits fall back); see the secret-gated /health.
 */
export async function getApiHealth(_req: Request, res: Response): Promise<void> {
  const draining = isProcessDraining();
  const database = draining ? "connected" : await probeDatabase();
  const ok = database === "connected" && !draining;
  const isProd = process.env.NODE_ENV === "production";

  const detail =
    isProd
      ? {}
      : { uptime: process.uptime(), environment: process.env.NODE_ENV ?? "development" };
  res.status(ok ? 200 : 503).json({
    status: draining ? "draining" : ok ? "ok" : "degraded",
    ...detail,
    database,
    ...(isProd ? {} : { redis: getRedisHealthSnapshot() }),
  });
}
