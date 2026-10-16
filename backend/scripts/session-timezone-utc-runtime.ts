/**
 * Raw SQL that reads or writes naive `timestamp(3)` columns must not depend on the session
 * TimeZone (the runtime goes through the Supabase transaction pooler, where per-session SET is not
 * reliable). Runs every check with the database default TimeZone set to UTC+14, then restores it.
 *
 *   CARETIP_CERT_ONLY=session-timezone-utc-runtime.ts npm run test:phase2-isolated-cert
 */
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { KycVerificationStatus, Role, TipStatus } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { consumeMfaChallengeJti } from "../src/services/mfaLogin.service.js";
import { listPlatformBusinesses } from "../src/services/platformBusinessList.service.js";
import { queryBusinessDashboardMetaAndSummaryMetrics } from "../src/utils/tipChartBuckets.js";

if (!process.env.CARETIP_ISOLATED_PG_DATA_DIR?.trim()) {
  console.error("[session-tz] Blocked: run only through the isolated cert harness (alters the database default TimeZone)");
  process.exit(2);
}

const SKEWED_TZ = "Pacific/Kiritimati";
const HOUR = 60 * 60 * 1000;
let failures = 0;
async function check(id: string, fn: () => Promise<string>) {
  try {
    console.log(`PASS  ${id}  ${await fn()}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${id}  ${err instanceof Error ? err.message : String(err)}`);
  }
}

const db = (await prisma.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`)[0]!.d;
const setDbTimeZone = async (tz: string | null) => {
  await prisma.$executeRawUnsafe(
    tz ? `ALTER DATABASE "${db}" SET TimeZone TO '${tz}'` : `ALTER DATABASE "${db}" RESET TimeZone`,
  );
  await prisma.$disconnect();
};

try {
  await setDbTimeZone(SKEWED_TZ);
  const tz = (await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`)[0]?.tz;
  assert.equal(tz, SKEWED_TZ, "session did not pick up the skewed database TimeZone");
  console.log(`=== session TimeZone=${tz} (UTC+14) ===`);
  const sfx = `stz_${Date.now()}`;

  await check("static-no-session-dependent-now", async () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(name)) {
          readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => {
            if (/(?<![.\w])(NOW\(\)|CURRENT_TIMESTAMP)/i.test(line) && !/AT TIME ZONE/i.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
              offenders.push(`${p.replace(/\\/g, "/").replace(/^.*\/src\//, "src/")}:${i + 1}`);
            }
          });
        }
      }
    };
    walk(join(process.cwd(), "src"));
    assert.deepEqual(offenders, [], `bare NOW()/CURRENT_TIMESTAMP in raw SQL: ${offenders.join(", ")}`);
    return "no raw SQL in src/ uses NOW()/CURRENT_TIMESTAMP without AT TIME ZONE";
  });

  await check("mfa-challenge-created-at-is-utc", async () => {
    const jti = `jti_${sfx}`;
    assert.equal(await consumeMfaChallengeJti(jti), "consumed");
    const row = (await prisma.$queryRaw<{ created_at: Date }[]>`SELECT created_at FROM consumed_mfa_challenges WHERE jti = ${jti}`)[0]!;
    const skewMs = Math.abs(row.created_at.getTime() - Date.now());
    assert.ok(skewMs < 5 * 60 * 1000, `created_at off by ${Math.round(skewMs / HOUR)}h`);
    return `created_at within ${Math.round(skewMs / 1000)}s of UTC now`;
  });

  await check("kyc-sla-breach-48h-boundary", async () => {
    const mk = async (n: string, hoursAgo: number) =>
      prisma.business.create({
        data: {
          name: `STZ ${sfx} ${n}`,
          slug: `stz-${sfx}-${n}`,
          userId: (
            await prisma.user.create({
              data: { email: `stz-${n}-${sfx}@example.com`, passwordHash: "x", role: Role.MANAGER, emailVerified: true },
            })
          ).id,
          kycVerificationStatus: KycVerificationStatus.pending_review,
          kycSubmittedAt: new Date(Date.now() - hoursAgo * HOUR),
        },
      });
    const fresh = await mk("fresh", 47);
    const late = await mk("late", 49);
    const res = await listPlatformBusinesses({ q: `STZ ${sfx}`, status: "sla_breach", workflow: "kyc", take: 10, skip: 0 });
    const ids = res.items.map((i) => (i as { id: string }).id);
    assert.ok(ids.includes(late.id), "49h-old submission not flagged");
    assert.ok(!ids.includes(fresh.id), "47h-old submission flagged as SLA breach");
    return "49h flagged, 47h not flagged";
  });

  await check("dashboard-day-window-is-utc", async () => {
    const manager = await prisma.user.create({
      data: { email: `stz-dash-${sfx}@example.com`, passwordHash: "x", role: Role.MANAGER, emailVerified: true },
    });
    const business = await prisma.business.create({
      data: { name: `STZ dash ${sfx}`, slug: `stz-dash-${sfx}`, userId: manager.id, timezone: "UTC" },
    });
    const now = Date.now();
    const startOfUtcDay = new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00.000Z").getTime();
    const tipAt = (ms: number) =>
      prisma.transaction.create({ data: { amount: 5, status: TipStatus.success, businessId: business.id, createdAt: new Date(ms) } });
    await tipAt(Math.max(startOfUtcDay + 1000, now - 60_000));
    await tipAt(startOfUtcDay - 2 * HOUR);
    const row = await queryBusinessDashboardMetaAndSummaryMetrics({
      businessId: business.id,
      timeframe: "week",
      sixtyAgo: new Date(now - 60 * 24 * HOUR),
      todayEnd: new Date(startOfUtcDay + 24 * HOUR - 1),
    });
    assert.equal(row.today_count, 1, `today_count=${row.today_count}`);
    assert.equal(row.last60_count, 2, `last60_count=${row.last60_count}`);
    assert.ok(row.period_count >= 1, `period_count=${row.period_count}`);
    return `today's tip counted once, yesterday's excluded from today (period_count=${row.period_count})`;
  });

  await check("prisma-default-now-is-utc", async () => {
    const u = await prisma.user.create({
      data: { email: `stz-def-${sfx}@example.com`, passwordHash: "x", role: Role.MANAGER },
    });
    const skewMs = Math.abs(u.createdAt.getTime() - Date.now());
    assert.ok(skewMs < 5 * 60 * 1000, `@default(now()) created_at off by ${Math.round(skewMs / HOUR)}h`);
    return `@default(now()) within ${Math.round(skewMs / 1000)}s of UTC now`;
  });
} finally {
  await setDbTimeZone(null).catch((err) => console.error("[session-tz] failed to reset database TimeZone", err));
}

await prisma.$disconnect();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (failures) process.exit(1);
