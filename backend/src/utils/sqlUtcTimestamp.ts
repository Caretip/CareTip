import { Prisma } from "@prisma/client";

/**
 * Bind a JS Date for comparison with (or assignment to) a `timestamp without time zone` column.
 *
 * Prisma stores DateTime as UTC wall-clock time in `timestamp` columns, but a Date bound into raw
 * SQL arrives time-zone aware, so PostgreSQL converts it using the *session* TimeZone. That is only
 * correct while the session is UTC. Converting explicitly gives the same result as a UTC session,
 * for every session TimeZone, so the meaning of existing reports does not change.
 *
 * Use for raw SQL only; Prisma query-builder calls (`where: { createdAt: { gte } }`) are unaffected.
 */
export function sqlUtcTimestamp(d: Date): Prisma.Sql {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}
