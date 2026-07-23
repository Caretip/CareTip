/**
 * Phase 13.7 — instrument tip chart buckets vs raw tips (no fix, evidence only).
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

const businessId = "cmpy3xoc90003u7o0eqdf55c6";
const tz = "Europe/Berlin";

async function main() {
  const range = businessUtcRangeForTimeframe("week", tz)!;
  const today = businessUtcRangeForTimeframe("today", tz)!;

  const recent = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      amount: number;
      status: string;
      created_at: Date;
      local_day: string;
      local_wall: string;
      business_id: string;
    }>
  >(
    `SELECT id, amount, status::text AS status, created_at, business_id,
      to_char(date_trunc('day', created_at AT TIME ZONE $1), 'YYYY-MM-DD') AS local_day,
      (created_at AT TIME ZONE $1)::text AS local_wall
     FROM tips
     WHERE status = 'success'
     ORDER BY created_at DESC
     LIMIT 20`,
    tz,
  );
  console.log("=== RECENT TIPS (platform) ===");
  console.log(JSON.stringify(recent, null, 2));

  const bizRecent = recent.filter((r) => r.business_id === businessId);
  console.log("=== BUSINESS TIPS IN TOP 20 ===", bizRecent.length);
  console.log(JSON.stringify(bizRecent, null, 2));

  const inTodayWindow = await prisma.$queryRawUnsafe<
    Array<{ id: string; amount: number; created_at: Date; local_day: string }>
  >(
    `SELECT id, amount, created_at,
      to_char(date_trunc('day', created_at AT TIME ZONE $1), 'YYYY-MM-DD') AS local_day
     FROM tips
     WHERE business_id = $2
       AND status = 'success'
       AND created_at >= $3
       AND created_at <= $4
     ORDER BY created_at DESC`,
    tz,
    businessId,
    today.startUtc,
    today.endUtc,
  );
  console.log("=== TIPS IN todayStart/todayEnd ===");
  console.log(
    JSON.stringify(
      {
        todayStart: today.startUtc.toISOString(),
        todayEnd: today.endUtc.toISOString(),
        rows: inTodayWindow,
        sum: inTodayWindow.reduce((s, r) => s + Number(r.amount), 0),
      },
      null,
      2,
    ),
  );

  const daily = await queryDailyTipBuckets({
    businessId,
    startUtc: range.startUtc,
    endUtc: range.endUtc,
    timezone: tz,
  });
  console.log("=== dailyByYmd (week) ===", Object.fromEntries(daily));
  console.log("week range", range.startUtc.toISOString(), range.endUtc.toISOString());

  const dist = buildBusinessDailyTipDistribution("week", daily, range.startUtc, tz);
  console.log("=== week dist ===", JSON.stringify(dist, null, 2));
  const thu = dist.find((r) => r.day === "Thu");
  console.log("=== ASSERT Thu (July 23) ===", thu, "expected amount 45");

  const monthRange = businessUtcRangeForTimeframe("month", tz)!;
  const dailyM = await queryDailyTipBuckets({
    businessId,
    startUtc: monthRange.startUtc,
    endUtc: monthRange.endUtc,
    timezone: tz,
  });
  const distM = buildBusinessDailyTipDistribution("month", dailyM, monthRange.startUtc, tz);
  console.log("=== month day 23 ===", distM.find((r) => r.day === "23"));
  console.log(
    "=== month days with amount>0 ===",
    distM.filter((r) => r.amount > 0),
  );

  const localEnd = DateTime.now().setZone(tz).endOf("day");
  const localStart = localEnd.startOf("day").minus({ days: 29 });
  const tipVol = await prisma.$queryRawUnsafe<
    Array<{ d: string; c: number; tips_eur: number }>
  >(
    `SELECT date_trunc('day', (created_at AT TIME ZONE 'UTC') AT TIME ZONE $1)::date::text AS d,
      COUNT(*)::int AS c,
      COALESCE(SUM(amount), 0)::float AS tips_eur
     FROM tips
     WHERE status = 'success'
       AND created_at >= $2
       AND created_at <= $3
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT 10`,
    tz,
    localStart.toUTC().toJSDate(),
    localEnd.toUTC().toJSDate(),
  );
  console.log("=== platform tip_vol last days (FIXED SQL) ===", JSON.stringify(tipVol, null, 2));
  console.log("platform window", localStart.toUTC().toISO(), localEnd.toUTC().toISO());
  console.log("expected today key", localEnd.toFormat("yyyy-MM-dd"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
