import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { businessUtcRangeForTimeframe, sanitizeIanaTimezone } from "../../utils/businessTime.js";
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

export async function getBusinessQrAnalytics(
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

  const [totalScans, sessionGroups, locationGroups, employeeGroups, tableGroups, slugGroups, deviceGroups, dailyByYmd, recentRows] =
    await Promise.all([
      prisma.qrScanEvent.count({ where }),
      prisma.qrScanEvent.groupBy({
        by: ["sessionId"],
        where,
        _count: { _all: true },
      }),
      prisma.qrScanEvent.groupBy({
        by: ["locationId"],
        where: { ...where, locationId: { not: null } },
        _count: { _all: true },
      }),
      prisma.qrScanEvent.groupBy({
        by: ["employeeId"],
        where: { ...where, employeeId: { not: null } },
        _count: { _all: true },
      }),
      prisma.qrScanEvent.groupBy({
        by: ["tableId"],
        where: { ...where, tableId: { not: null } },
        _count: { _all: true },
      }),
      prisma.qrScanEvent.groupBy({
        by: ["qrSlug"],
        where: { ...where, qrSlug: { not: null } },
        _count: { _all: true },
      }),
      prisma.qrScanEvent.groupBy({
        by: ["deviceType"],
        where,
        _count: { _all: true },
      }),
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

  const uniqueScans = sessionGroups.length;
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
