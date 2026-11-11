import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { businessUtcRangeForTimeframe, sanitizeIanaTimezone } from "../../utils/businessTime.js";
import { getCachedOrLoad, invalidateCacheKeyPrefix } from "../../utils/shortLivedCache.js";
import { sqlNaiveUtcColumnAsLocal } from "../../utils/sqlNaiveUtcToLocal.js";
import { buildBusinessDailyTipDistribution } from "../../utils/tipChartBuckets.js";

export type QrAnalyticsTimeframe = "week" | "month" | "year";

export type QrAnalyticsBreakdownRow = { label: string; id: string; count: number };
export type QrAnalyticsSlugRow = { qrSlug: string; count: number };
export type QrAnalyticsDeviceRow = { deviceType: string; count: number };
export type QrAnalyticsTrendRow = { label: string; count: number };
export type QrAnalyticsRecentRow = {
  scannedAt: string;
  scanType: string;
  label: string;
};

export type BusinessQrAnalyticsDto = {
  timeframe: QrAnalyticsTimeframe;
  totalScans: number;
  uniqueScans: number;
  repeatScans: number;
  scansByLocation: QrAnalyticsBreakdownRow[];
  scansByEmployee: QrAnalyticsBreakdownRow[];
  scansByTable: QrAnalyticsBreakdownRow[];
  scansByQrSlug: QrAnalyticsSlugRow[];
  scansByDevice: QrAnalyticsDeviceRow[];
  scanTrend: QrAnalyticsTrendRow[];
  recentScans: QrAnalyticsRecentRow[];
};

function scanLabel(
  scanType: string,
  employee: { name: string } | null,
  location: { name: string } | null,
  table: { name: string } | null,
  qrSlug: string | null,
): string {
  if (employee?.name) return employee.name;
  if (table?.name && location?.name) return `${table.name} (${location.name})`;
  if (table?.name) return table.name;
  if (location?.name) return location.name;
  if (qrSlug) return qrSlug;
  if (scanType === "business_directory" || scanType === "business_id") return "Business QR";
  return scanType;
}

async function queryQrScanDailyCounts(opts: {
  businessId: string;
  startUtc: Date;
  endUtc: Date;
  tz: string;
}): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ d: string; total: number }>>(Prisma.sql`
    SELECT
      to_char(date_trunc('day', ${sqlNaiveUtcColumnAsLocal(Prisma.sql`scanned_at`, opts.tz)}), 'YYYY-MM-DD') AS d,
      COUNT(*)::int AS total
    FROM qr_scan_events
    WHERE business_id = ${opts.businessId}
      AND scanned_at >= ${opts.startUtc}
      AND scanned_at <= ${opts.endUtc}
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(String(r.d).slice(0, 10), Number(r.total ?? 0));
  }
  return m;
}

type QrScanGroupRow = {
  location_id: string | null;
  employee_id: string | null;
  table_id: string | null;
  qr_slug: string | null;
  device_type: string | null;
  grouping_id: number;
  total: number;
};

/** GROUPING() bitmasks, in the column order of the query: a set bit means "not grouped by this". */
const QR_GROUP = { location: 15, employee: 23, table: 27, slug: 29, device: 30, total: 31 } as const;

/** Matches the dashboard stats cache: each load scans every scan row in the period. */
const QR_ANALYTICS_CACHE_TTL_MS = 30_000;

/** Drop cached QR analytics so a new scan shows on the next read rather than after the TTL. */
export function invalidateBusinessQrAnalyticsCache(businessId: string): void {
  invalidateCacheKeyPrefix(`qr-analytics:${businessId}:`);
}

export function getBusinessQrAnalytics(
  businessId: string,
  timeframe: QrAnalyticsTimeframe,
): Promise<BusinessQrAnalyticsDto> {
  return getCachedOrLoad(`qr-analytics:${businessId}:${timeframe}`, QR_ANALYTICS_CACHE_TTL_MS, () =>
    loadBusinessQrAnalytics(businessId, timeframe),
  );
}

async function loadBusinessQrAnalytics(
  businessId: string,
  timeframe: QrAnalyticsTimeframe,
): Promise<BusinessQrAnalyticsDto> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  });
  const tz = sanitizeIanaTimezone(business?.timezone);
  const range = businessUtcRangeForTimeframe(timeframe, tz);
  const startUtc = range?.startUtc ?? new Date(0);
  const endUtc = range?.endUtc ?? new Date();

  const where = {
    businessId,
    scannedAt: { gte: startUtc, lte: endUtc },
  };

  const [groupRows, uniqueSessionRows, dailyByYmd, recentRows] =
    await Promise.all([
      // One pass over the period. Separate count and groupBy calls each rescanned the same rows,
      // and with a connection pool of five they queued behind each other.
      prisma.$queryRaw<QrScanGroupRow[]>(Prisma.sql`
        SELECT
          location_id, employee_id, table_id, qr_slug, device_type,
          GROUPING(location_id, employee_id, table_id, qr_slug, device_type)::int AS grouping_id,
          COUNT(*)::int AS total
        FROM qr_scan_events
        WHERE business_id = ${businessId}
          AND scanned_at >= ${startUtc}
          AND scanned_at <= ${endUtc}
        GROUP BY GROUPING SETS ((location_id), (employee_id), (table_id), (qr_slug), (device_type), ())
      `),
      // Counted in Postgres: grouping returned one row per session just to take the length.
      prisma.$queryRaw<Array<{ unique_sessions: number }>>(Prisma.sql`
        SELECT COUNT(DISTINCT session_id)::int AS unique_sessions
        FROM qr_scan_events
        WHERE business_id = ${businessId}
          AND scanned_at >= ${startUtc}
          AND scanned_at <= ${endUtc}
      `),
      queryQrScanDailyCounts({ businessId, startUtc, endUtc, tz }),
      prisma.qrScanEvent.findMany({
        where,
        orderBy: { scannedAt: "desc" },
        take: 12,
        select: {
          scannedAt: true,
          scanType: true,
          qrSlug: true,
          employee: { select: { name: true } },
          location: { select: { name: true } },
          table: { select: { name: true } },
        },
      }),
    ]);

  const rowsFor = (groupingId: number) => groupRows.filter((row) => row.grouping_id === groupingId);
  const countOf = (row: QrScanGroupRow) => ({ _all: Number(row.total) });
  const totalScans = Number(rowsFor(QR_GROUP.total)[0]?.total ?? 0);
  const locationGroups = rowsFor(QR_GROUP.location)
    .filter((row) => row.location_id != null)
    .map((row) => ({ locationId: row.location_id, _count: countOf(row) }));
  const employeeGroups = rowsFor(QR_GROUP.employee)
    .filter((row) => row.employee_id != null)
    .map((row) => ({ employeeId: row.employee_id, _count: countOf(row) }));
  const tableGroups = rowsFor(QR_GROUP.table)
    .filter((row) => row.table_id != null)
    .map((row) => ({ tableId: row.table_id, _count: countOf(row) }));
  const slugGroups = rowsFor(QR_GROUP.slug)
    .filter((row) => row.qr_slug != null)
    .map((row) => ({ qrSlug: row.qr_slug, _count: countOf(row) }));
  const deviceGroups = rowsFor(QR_GROUP.device).map((row) => ({
    deviceType: row.device_type as string,
    _count: countOf(row),
  }));

  const uniqueScans = Number(uniqueSessionRows[0]?.unique_sessions ?? 0);
  const repeatScans = Math.max(0, totalScans - uniqueScans);

  const locationIds = locationGroups.map((g) => g.locationId!).filter(Boolean);
  const employeeIds = employeeGroups.map((g) => g.employeeId!).filter(Boolean);
  const tableIds = tableGroups.map((g) => g.tableId!).filter(Boolean);

  const [locations, employees, tables] = await Promise.all([
    locationIds.length
      ? prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    employeeIds.length
      ? prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    tableIds.length
      ? prisma.table.findMany({ where: { id: { in: tableIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const employeeName = new Map(employees.map((e) => [e.id, e.name]));
  const tableName = new Map(tables.map((t) => [t.id, t.name]));

  const scansByLocation = locationGroups
    .map((g) => ({
      id: g.locationId!,
      label: locationName.get(g.locationId!) ?? "Location",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  const scansByEmployee = employeeGroups
    .map((g) => ({
      id: g.employeeId!,
      label: employeeName.get(g.employeeId!) ?? "Employee",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  const scansByTable = tableGroups
    .map((g) => ({
      id: g.tableId!,
      label: tableName.get(g.tableId!) ?? "Table",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  const scansByQrSlug = slugGroups
    .map((g) => ({
      qrSlug: g.qrSlug!,
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  const scansByDevice = deviceGroups
    .map((g) => ({
      deviceType: g.deviceType,
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  const scanTrend = buildBusinessDailyTipDistribution(timeframe, dailyByYmd, startUtc, tz).map((row) => ({
    label: row.day,
    count: row.amount,
  }));

  const recentScans: QrAnalyticsRecentRow[] = recentRows.map((ev) => ({
    scannedAt: ev.scannedAt.toISOString(),
    scanType: ev.scanType,
    label: scanLabel(ev.scanType, ev.employee, ev.location, ev.table, ev.qrSlug),
  }));

  return {
    timeframe,
    totalScans,
    uniqueScans,
    repeatScans,
    scansByLocation,
    scansByEmployee,
    scansByTable,
    scansByQrSlug,
    scansByDevice,
    scanTrend,
    recentScans,
  };
}
