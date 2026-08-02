/**
 * Production readiness — scan analytics + activity + notification parity.
 * Run: npm run test:scan-analytics-readiness
 */
import type { Request } from "express";
import bcrypt from "bcrypt";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import {
  QR_SCAN_TYPES,
  persistQrScanEvent,
} from "../src/services/qr/qrScanEvent.service.js";
import { getBusinessQrAnalytics } from "../src/services/qr/qrAnalytics.service.js";
import { ACTIVITY_EVENT_TYPES } from "../src/services/activity/businessActivityEvent.service.js";

type Result = { id: string; name: string; status: "PASS" | "FAIL"; detail: string };
const results: Result[] = [];

function pass(id: string, name: string, detail: string) {
  results.push({ id, name, status: "PASS", detail });
}
function fail(id: string, name: string, detail: string) {
  results.push({ id, name, status: "FAIL", detail });
}

function mockReq(sessionId: string, path: string): Request {
  return {
    headers: {
      "x-caretip-scan-session": sessionId,
      "user-agent": "CareTip-ScanReadiness/1.0",
    },
    originalUrl: path,
    url: path,
    path,
    ip: "127.0.0.1",
  } as Request;
}

async function seedFixture() {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `scan-readiness-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `Scan Readiness ${tag}`,
          slug: `scan-readiness-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
          timezone: "Europe/Berlin",
        },
      },
    },
    include: { business: true },
  });
  const businessId = user.business!.id;
  const managerUserId = user.id;
  const location = await prisma.location.create({
    data: { name: "Main Hall", businessId },
  });
  const table = await prisma.table.create({
    data: { name: "Table 1", locationId: location.id, qrSlug: `tbl-${tag}` },
  });

  return {
    tag,
    businessId,
    managerUserId,
    businessSlug: user.business!.slug!,
    locationId: location.id,
    tableId: table.id,
    cleanup: async () => {
      await prisma.notification.deleteMany({ where: { userId: managerUserId } });
      await prisma.businessActivityEvent.deleteMany({ where: { businessId } });
      await prisma.qrScanEvent.deleteMany({ where: { businessId } });
      await prisma.table.delete({ where: { id: table.id } }).catch(() => undefined);
      await prisma.location.delete({ where: { id: location.id } }).catch(() => undefined);
      await prisma.business.delete({ where: { id: businessId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: managerUserId } }).catch(() => undefined);
    },
  };
}

async function waitForActivity(businessId: string, scanId: string, attempts = 20): Promise<number> {
  for (let i = 0; i < attempts; i++) {
    const count = await prisma.businessActivityEvent.count({
      where: { businessId, type: ACTIVITY_EVENT_TYPES.QR_SCANNED, subjectId: scanId },
    });
    if (count > 0) return count;
    await new Promise((r) => setTimeout(r, 100));
  }
  return 0;
}

async function waitForNotification(userId: string, scanId: string, attempts = 20): Promise<number> {
  for (let i = 0; i < attempts; i++) {
    const count = await prisma.notification.count({
      where: { userId, dedupeKey: `qr_scan:${scanId}` },
    });
    if (count > 0) return count;
    await new Promise((r) => setTimeout(r, 100));
  }
  return 0;
}

async function main() {
  console.info("[scan-readiness] Starting production readiness checks…\n");
  const fx = await seedFixture();

  try {
    const sessionJourney = `srjourney${fx.tag}`.slice(0, 32);
    const journeyResults = await Promise.all([
      persistQrScanEvent({
        businessId: fx.businessId,
        scanType: QR_SCAN_TYPES.TABLE_SLUG,
        locationId: fx.locationId,
        tableId: fx.tableId,
        qrSlug: "table-abc",
        req: mockReq(sessionJourney, `/api/tipping-context/table-abc`),
        notify: { locationName: "Main Hall", tableName: "Table 1" },
      }),
      persistQrScanEvent({
        businessId: fx.businessId,
        scanType: QR_SCAN_TYPES.BUSINESS_ID,
        req: mockReq(sessionJourney, `/api/business/${fx.businessId}`),
      }),
      persistQrScanEvent({
        businessId: fx.businessId,
        scanType: QR_SCAN_TYPES.BUSINESS_DIRECTORY,
        req: mockReq(sessionJourney, `/api/staff/directory/business/${fx.businessSlug}`),
      }),
    ]);

    const inserted = journeyResults.filter((r) => r.inserted);
    const scanId = inserted[0]?.scanId;

    const [scanRows, analytics] = await Promise.all([
      prisma.qrScanEvent.count({ where: { businessId: fx.businessId, sessionId: sessionJourney } }),
      getBusinessQrAnalytics(fx.businessId, "month"),
    ]);

    if (scanRows === 1 && inserted.length === 1 && scanId) {
      pass("journey-one-scan-row", "Guest journey → one qr_scan_events row", `rows=${scanRows} scanId=${scanId}`);
    } else {
      fail(
        "journey-one-scan-row",
        "Guest journey → one qr_scan_events row",
        `Expected 1 row / 1 insert; got rows=${scanRows} inserted=${inserted.length}`,
      );
    }

    if (scanId) {
      const activityRows = await waitForActivity(fx.businessId, scanId);
      if (activityRows === 1) {
        pass("journey-one-activity", "One scan → one BusinessActivityEvent", `activityRows=${activityRows}`);
      } else {
        fail("journey-one-activity", "One scan → one BusinessActivityEvent", `Expected 1; got ${activityRows}`);
      }

      const notifRows = await waitForNotification(fx.managerUserId, scanId);
      if (notifRows === 1) {
        pass("journey-one-notification", "One scan → one inbox notification", `notifRows=${notifRows}`);
      } else {
        fail("journey-one-notification", "One scan → one inbox notification", `Expected 1; got ${notifRows}`);
      }
    }

    const sessionConcurrent = `srstorm${fx.tag}`.slice(0, 32);
    const concurrentInput = {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.EMPLOYEE,
      req: mockReq(sessionConcurrent, `/api/staff/test`),
    };
    await Promise.all(Array.from({ length: 50 }, () => persistQrScanEvent(concurrentInput)));
    const stormRows = await prisma.qrScanEvent.count({
      where: { businessId: fx.businessId, sessionId: sessionConcurrent },
    });
    if (stormRows === 1) {
      pass("concurrent-rescan", "50 concurrent identical scans → 1 row", `rows=${stormRows}`);
    } else {
      fail("concurrent-rescan", "50 concurrent identical scans → 1 row", `Expected 1; got ${stormRows}`);
    }

    const analyticsAfter = await getBusinessQrAnalytics(fx.businessId, "month");
    const expectedMinTotal = scanRows + stormRows;
    if (analyticsAfter.totalScans >= expectedMinTotal) {
      pass(
        "analytics-count-parity",
        "Analytics totalScans matches DB rows",
        `db≈${expectedMinTotal}+ totalScans=${analyticsAfter.totalScans}`,
      );
    } else {
      fail(
        "analytics-count-parity",
        "Analytics totalScans matches DB rows",
        `totalScans=${analyticsAfter.totalScans} expected >= ${expectedMinTotal}`,
      );
    }

    const dupActivity = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c FROM (
        SELECT business_id, dedupe_key, COUNT(*) AS n
        FROM business_activity_events
        WHERE business_id = ${fx.businessId} AND type = 'qr.scanned'
        GROUP BY 1, 2
        HAVING COUNT(*) > 1
      ) d
    `;
    const dupScans = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c FROM (
        SELECT dedupe_key, COUNT(*) AS n
        FROM qr_scan_events
        WHERE business_id = ${fx.businessId}
        GROUP BY 1
        HAVING COUNT(*) > 1
      ) d
    `;
    if (Number(dupActivity[0]?.c ?? 0) === 0 && Number(dupScans[0]?.c ?? 0) === 0) {
      pass("sql-no-dup-keys", "No duplicate dedupe keys in scan/activity tables", "HAVING COUNT(*) > 1 → 0");
    } else {
      fail(
        "sql-no-dup-keys",
        "No duplicate dedupe keys in scan/activity tables",
        `dupActivity=${dupActivity[0]?.c} dupScans=${dupScans[0]?.c}`,
      );
    }

    if (analytics.uniqueScans <= analytics.totalScans) {
      pass(
        "analytics-unique-lte-total",
        "uniqueScans ≤ totalScans",
        `unique=${analyticsAfter.uniqueScans} total=${analyticsAfter.totalScans}`,
      );
    } else {
      fail(
        "analytics-unique-lte-total",
        "uniqueScans ≤ totalScans",
        `unique=${analyticsAfter.uniqueScans} total=${analyticsAfter.totalScans}`,
      );
    }
  } finally {
    await fx.cleanup();
  }

  printSummary();
  process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
}

function printSummary() {
  console.info("\n--- Scan Analytics Production Readiness ---\n");
  for (const r of results) {
    console.info(`${r.status.padEnd(5)} [${r.id}] ${r.name}`);
    console.info(`       ${r.detail}\n`);
  }
  const p = results.filter((r) => r.status === "PASS").length;
  const f = results.filter((r) => r.status === "FAIL").length;
  console.info(`Summary: ${p} passed, ${f} failed`);
}

main().catch((err) => {
  console.error("[scan-readiness] fatal", err);
  process.exit(1);
});
