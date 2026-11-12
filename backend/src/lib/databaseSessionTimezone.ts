/**
 * Startup check: is the database session TimeZone UTC?
 *
 * Financial and payment raw SQL binds dates through `sqlUtcTimestamp` and does not depend on it.
 * Some other raw SQL (token expiry, retention, analytics of scans/sign-ups) still compares bound
 * dates with `timestamp` columns and would shift by the session offset if TimeZone were not UTC.
 * This logs an error and alerts Sentry instead of failing startup.
 */
import { prisma } from "../prisma.js";
import { captureServerException } from "../instrument/sentry.js";

export async function warnIfDatabaseSessionNotUtc(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ tz: string }>>`SELECT current_setting('TimeZone') AS tz`;
    const tz = rows[0]?.tz ?? null;
    if (tz && tz !== "UTC" && tz !== "Etc/UTC") {
      console.error(
        `[db] Database session TimeZone is "${tz}", not UTC. Non-financial raw SQL date comparisons ` +
          "assume UTC; set the database/role TimeZone to UTC.",
      );
      captureServerException(new Error("Database session TimeZone is not UTC"), { timezone: tz });
    }
    return tz;
  } catch {
    return null; // diagnostics must never affect startup
  }
}
