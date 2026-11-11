import dns from "node:dns";
import { PrismaClient } from "@prisma/client";
import { getDatabaseUrlForPrisma } from "./databaseUrl.js";

// Prefer IPv4 when resolving hostnames (helps avoid Prisma P1001 to Supabase pooler on Windows).
dns.setDefaultResultOrder("ipv4first");

const isProd = process.env.NODE_ENV === "production";

/**
 * One Prisma client per process; URL is normalized for Supabase pool limits.
 */
export const prisma = new PrismaClient({
  datasources: {
    db: { url: getDatabaseUrlForPrisma() },
  },
  log: isProd ? ["error"] : ["warn", "error"],
});

