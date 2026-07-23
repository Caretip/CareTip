import { Prisma } from "@prisma/client";

/**
 * Prisma `DateTime` maps to Postgres `timestamp without time zone` storing UTC wall time.
 *
 * Wrong:  `created_at AT TIME ZONE 'Europe/Berlin'`
 *   → treats the UTC digits as Berlin local (shifts the wrong way; post-midnight Berlin
 *     tips land on the previous calendar day).
 *
 * Right:  `(created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin'`
 *   → interpret stored digits as UTC, then project to venue-local wall time.
 */
export function sqlNaiveUtcColumnAsLocal(columnSql: Prisma.Sql, ianaTimezone: string): Prisma.Sql {
  return Prisma.sql`((${columnSql} AT TIME ZONE 'UTC') AT TIME ZONE ${ianaTimezone})`;
}

/** Convenience for the common `tips.created_at` / `created_at` column. */
export function sqlCreatedAtLocal(ianaTimezone: string): Prisma.Sql {
  return sqlNaiveUtcColumnAsLocal(Prisma.sql`created_at`, ianaTimezone);
}
