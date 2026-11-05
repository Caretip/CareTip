import type { Request, Response } from "express";
import { prisma } from "../prisma.js";

async function probeDatabase(): Promise<"connected" | "disconnected"> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "connected";
  } catch {
    return "disconnected";
  }
}

/** Public liveness probe for clients, load balancers, and local dev. */
export async function getApiHealth(_req: Request, res: Response): Promise<void> {
  const database = await probeDatabase();
  const ok = database === "connected";

  const detail =
    process.env.NODE_ENV === "production"
      ? {}
      : { uptime: process.uptime(), environment: process.env.NODE_ENV ?? "development" };
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    ...detail,
    database,
  });
}
