/**
 * Phase 13.7 final — verify one midnight tip civil day across SSOT surfaces.
 * Tip: cmrwn4ll400i5ms48abz1v6kk (2026-07-22T22:14:56.585Z → Berlin 2026-07-23)
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { DateTime } from "luxon";
import {
  queryDailyTipBuckets,
  buildBusinessDailyTipDistribution,
} from "../src/utils/tipChartBuckets.js";
import { businessUtcRangeForTimeframe } from "../src/utils/businessTime.js";
import { sqlCreatedAtLocal } from "../src/utils/sqlNaiveUtcToLocal.js";
import { Prisma } from "@prisma/client";

const TIP_ID = "cmrwn4ll400i5ms48abz1v6kk";
const businessId = "cmpy3xoc90003u7o0eqdf55c6";
const tz = "Europe/Berlin";
const EXPECTED_DAY = "2026-07-23";

async function main() {
  const tip = await prisma.transaction.findUnique({
    where: { id: TIP_ID },
    select: { id: true, amount: true, status: true, createdAt: true, businessId: true },
  });
  if (!tip) {
    console.error("Tip not found", TIP_ID);
    process.exitCode = 1;
    return;
  }

  const iso = tip.createdAt.toISOString();
  const berlinDay = DateTime.fromJSDate(tip.createdAt, { zone: "utc" }).setZone(tz).toFormat("yyyy-MM-dd");
  const londonDay = DateTime.fromJSDate(tip.createdAt, { zone: "utc" }).setZone("Europe/London").toFormat("yyyy-MM-dd");

  const todayRange = businessUtcRangeForTimeframe("today", tz, DateTime.fromISO("2026-07-23T12:00:00", { zone: tz }).toUTC())!;
  const inTodayWindow =
    tip.createdAt.getTime() >= todayRange.startUtc.getTime() &&
    tip.createdAt.getTime() <= todayRange.endUtc.getTime();

  const week = businessUtcRangeForTimeframe("week", tz, DateTime.fromISO("2026-07-23T12:00:00", { zone: tz }).toUTC())!;
  const daily = await queryDailyTipBuckets({
    businessId,
    startUtc: week.startUtc,
    endUtc: week.endUtc,
    timezone: tz,
  });
  const dist = buildBusinessDailyTipDistribution("week", daily, week.startUtc, tz);
  const thu = dist.find((r) => r.day === "Thu");

  const month = businessUtcRangeForTimeframe("month", tz, DateTime.fromISO("2026-07-23T12:00:00", { zone: tz }).toUTC())!;
  const dailyM = await queryDailyTipBuckets({
    businessId,
    startUtc: month.startUtc,
    endUtc: month.endUtc,
    timezone: tz,
  });
  const distM = buildBusinessDailyTipDistribution("month", dailyM, month.startUtc, tz);
  const day23 = distM.find((r) => r.day === "23");

  const tipVol = await prisma.$queryRaw<Array<{ d: string; tips_eur: number }>>(Prisma.sql`
    SELECT date_trunc('day', ${sqlCreatedAtLocal(tz)})::date::text AS d,
      COALESCE(SUM(amount), 0)::float AS tips_eur
    FROM tips
    WHERE status = 'success'
      AND id = ${TIP_ID}
    GROUP BY 1
  `);

  const displayBerlin = DateTime.fromJSDate(tip.createdAt, { zone: "utc" })
    .setZone(tz)
    .toFormat("dd LLL yyyy HH:mm");
  const displayBrowserUtc1 = DateTime.fromJSDate(tip.createdAt, { zone: "utc" })
    .setZone("Europe/London")
    .toFormat("dd LLL yyyy HH:mm");

  const rows = [
    ["tip.amount", String(tip.amount)],
    ["tip.iso", iso],
    ["Berlin civil day", berlinDay],
    ["London civil day (browser UTC+1 class)", londonDay],
    ["KPI today window includes tip (2026-07-23 Berlin)", String(inTodayWindow)],
    ["Week chart Thu bucket", String(thu?.amount ?? "missing")],
    ["Month chart day 23", String(day23?.amount ?? "missing")],
    ["tip_vol SQL day for tip", tipVol[0]?.d ?? "missing"],
    ["Display Berlin", displayBerlin],
    ["Display London (must NOT be used for reporting)", displayBrowserUtc1],
  ];

  console.log("=== MIDNIGHT TIP CIVIL-DAY MATRIX ===");
  for (const [k, v] of rows) console.log(`${k}: ${v}`);

  const pass =
    berlinDay === EXPECTED_DAY &&
    inTodayWindow === true &&
    (thu?.amount ?? 0) >= 35 &&
    (day23?.amount ?? 0) >= 35 &&
    tipVol[0]?.d?.startsWith(EXPECTED_DAY) === true &&
    londonDay !== berlinDay;

  console.log(pass ? "\nPASS: all SSOT surfaces agree on Europe/Berlin 2026-07-23" : "\nFAIL");
  if (!pass) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
