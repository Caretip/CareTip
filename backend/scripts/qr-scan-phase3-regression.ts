/**
 * Phase 3 — visit-scoped QR scan regression suite.
 * Run: npm run test:qr-scan-phase3
 */
import type { Request } from "express";
import bcrypt from "bcrypt";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { QR_SCAN_TYPES } from "../src/services/qr/qrScanEvent.service.js";
import { startGuestVisitAndRecordScan, completeGuestVisit } from "../src/services/qr/qrGuestVisit.service.js";
import { emitQrScanSideEffects } from "../src/services/qr/qrScanEvent.service.js";
import { getBusinessQrAnalytics } from "../src/services/qr/qrAnalytics.service.js";
import { ACTIVITY_EVENT_TYPES } from "../src/services/activity/businessActivityEvent.service.js";
import { QR_GUEST_VISIT_TTL_MS } from "../src/services/qr/qrScanRequestContext.js";

type Result = { id: string; name: string; status: "PASS" | "FAIL"; detail: string };
const results: Result[] = [];

function pass(id: string, name: string, detail: string) {
  results.push({ id, name, status: "PASS", detail });
}
function fail(id: string, name: string, detail: string) {
  results.push({ id, name, status: "FAIL", detail });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mockReq(sessionId: string, path: string): Request {
  return {
    headers: {
      "x-caretip-scan-session": sessionId,
      "user-agent": "CareTip-QR-Phase3/1.0",
    },
    originalUrl: path,
    url: path,
    path,
    ip: "127.0.0.1",
  } as Request;
}

async function recordScan(
  sessionId: string,
  path: string,
  extra: Omit<Parameters<typeof startGuestVisitAndRecordScan>[0], "req">,
) {
  const req = mockReq(sessionId, path);
  const result = await startGuestVisitAndRecordScan({ ...extra, req });
  if (result.inserted && result.scanId) {
    await emitQrScanSideEffects({ ...extra, req }, result.scanId);
  }
  return result;
}

async function seedFixture() {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `qr-phase3-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `QR Phase3 ${tag}`,
          slug: `qr-phase3-${tag}`,
          verificationStatus: "verified",
          onboardingVerificationStatus: "approved",
          subscriptionTier: "premium",
          timezone: "Europe/Berlin",
        },
      },
    },
    include: { business: true },
  });
  const businessId = user.business!.id;
  const managerUserId = user.id;
  const empUser = await prisma.user.create({
    data: {
      email: `qr-phase3-emp-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      employee: {
        create: {
          name: "Phase3 Staff",
          slug: `phase3-staff-${tag}`,
          jobTitle: "Server",
          businessId,
          isActive: true,
          activationStatus: "active",
        },
      },
    },
    include: { employee: true },
  });
  const location = await prisma.location.create({
    data: { name: "Main Hall", businessId },
  });
  const table = await prisma.table.create({
    data: { name: "Table 1", locationId: location.id, qrSlug: `tbl-p3-${tag}` },
  });

  return {
    tag,
    businessId,
    managerUserId,
    businessSlug: user.business!.slug!,
    employeeId: empUser.employee!.id,
    locationId: location.id,
    tableId: table.id,
    cleanup: async () => {
      await prisma.notification.deleteMany({ where: { userId: managerUserId } });
      await prisma.businessActivityEvent.deleteMany({ where: { businessId } });
      await prisma.qrGuestVisit.deleteMany({ where: { businessId } });
      await prisma.qrScanEvent.deleteMany({ where: { businessId } });
      await prisma.table.delete({ where: { id: table.id } }).catch(() => undefined);
      await prisma.location.delete({ where: { id: location.id } }).catch(() => undefined);
      await prisma.employee.delete({ where: { id: empUser.employee!.id } }).catch(() => undefined);
      await prisma.business.delete({ where: { id: businessId } }).catch(() => undefined);
      await prisma.user.deleteMany({
        where: { id: { in: [managerUserId, empUser.id] } },
      }).catch(() => undefined);
    },
  };
}

async function assertOneScanPipeline(
  fx: Awaited<ReturnType<typeof seedFixture>>,
  scanId: string | undefined,
  label: string,
) {
  if (!scanId) {
    fail(`${label}-scan`, label, "No scanId");
    return;
  }
  for (let i = 0; i < 20; i++) {
    const notifRows = await prisma.notification.count({
      where: { userId: fx.managerUserId, dedupeKey: `qr_scan:${scanId}` },
    });
    if (notifRows > 0) break;
    await sleep(100);
  }
  const [scanRows, activityRows, notifRows] = await Promise.all([
    prisma.qrScanEvent.count({ where: { businessId: fx.businessId, sessionId: label } }),
    prisma.businessActivityEvent.count({
      where: { businessId: fx.businessId, type: ACTIVITY_EVENT_TYPES.QR_SCANNED, subjectId: scanId },
    }),
    prisma.notification.count({ where: { userId: fx.managerUserId, dedupeKey: `qr_scan:${scanId}` } }),
  ]);
  const visitRows = await prisma.qrGuestVisit.count({
    where: { businessId: fx.businessId, sessionId: label, scanEventId: scanId },
  });
  if (scanRows === 1 && activityRows === 1 && notifRows === 1 && visitRows === 1) {
    pass(`${label}-pipeline`, `${label} → 1 scan/activity/notification/visit`, `scan=${scanRows}`);
  } else {
    fail(
      `${label}-pipeline`,
      `${label} → 1 scan/activity/notification/visit`,
      `scan=${scanRows} activity=${activityRows} notif=${notifRows} visit=${visitRows}`,
    );
  }
}

async function main() {
  console.info("[qr-phase3] Starting visit-scoped scan regression…\n");
  const fx = await seedFixture();

  try {
    // S1 — QR only (table slug landing)
    const s1 = `p3s1${fx.tag}`.slice(0, 32);
    const r1 = await recordScan(s1, "/api/qr/scan", {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.TABLE_SLUG,
      locationId: fx.locationId,
      tableId: fx.tableId,
      qrSlug: "table-abc",
      notify: { locationName: "Main Hall", tableName: "Table 1" },
    });
    if (r1.inserted && r1.scanId) {
      pass("s1-qr-only", "QR only → one scan", `scanId=${r1.scanId}`);
      await assertOneScanPipeline(fx, r1.scanId, s1);
    } else {
      fail("s1-qr-only", "QR only → one scan", "Expected inserted scan");
    }

    // S2 — employee hydration after scan (same session, different read paths)
    const s2 = `p3s2${fx.tag}`.slice(0, 32);
    const r2a = await recordScan(s2, "/api/qr/scan", {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.TABLE_SLUG,
      locationId: fx.locationId,
      tableId: fx.tableId,
    });
    const r2b = await recordScan(s2, "/api/employees/hydrate", {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.EMPLOYEE_LEGACY_ID,
      employeeId: fx.employeeId,
    });
    const rows2 = await prisma.qrScanEvent.count({ where: { businessId: fx.businessId, sessionId: s2 } });
    if (rows2 === 1 && r2a.inserted && !r2b.inserted) {
      pass("s2-hydration", "Employee hydration → no duplicate scan", `rows=${rows2}`);
    } else {
      fail("s2-hydration", "Employee hydration → no duplicate scan", `rows=${rows2} r2a=${r2a.inserted} r2b=${r2b.inserted}`);
    }

    // S3 — business + directory reload simulation
    const s3 = `p3s3${fx.tag}`.slice(0, 32);
    await recordScan(s3, "/api/qr/scan", {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.BUSINESS_DIRECTORY,
    });
    await recordScan(s3, "/api/staff/directory/reload", {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.BUSINESS_ID,
    });
    await recordScan(s3, "/api/staff/directory/reload2", {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.EMPLOYEE,
      employeeId: fx.employeeId,
    });
    const rows3 = await prisma.qrScanEvent.count({ where: { businessId: fx.businessId, sessionId: s3 } });
    if (rows3 === 1) {
      pass("s3-directory-reload", "Directory reload + hydration → one scan", `rows=${rows3}`);
    } else {
      fail("s3-directory-reload", "Directory reload + hydration → one scan", `rows=${rows3}`);
    }

    // S4 — long payment / bucket boundary (35s wait irrelevant)
    const s4 = `p3s4${fx.tag}`.slice(0, 32);
    const r4a = await recordScan(s4, "/api/qr/scan", {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.EMPLOYEE,
      employeeId: fx.employeeId,
    });
    await sleep(35_000);
    const r4b = await recordScan(s4, "/api/qr/scan/retry", {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.EMPLOYEE_LEGACY_ID,
      employeeId: fx.employeeId,
    });
    const rows4 = await prisma.qrScanEvent.count({ where: { businessId: fx.businessId, sessionId: s4 } });
    if (rows4 === 1 && r4a.inserted && !r4b.inserted) {
      pass("s4-long-payment", "35s later → still one scan (no bucket rollover)", `rows=${rows4}`);
    } else {
      fail("s4-long-payment", "35s later → still one scan", `rows=${rows4}`);
    }

    // S5 — session bifurcation: missing header rejected
    try {
      await startGuestVisitAndRecordScan({
        businessId: fx.businessId,
        scanType: QR_SCAN_TYPES.BUSINESS_ID,
        req: { headers: {}, originalUrl: "/", url: "/", path: "/", ip: "127.0.0.1" } as Request,
      });
      fail("s5-no-header", "Missing session header → rejected", "Expected throw");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("x-caretip-scan-session")) {
        pass("s5-no-header", "Missing session header → rejected", msg);
      } else {
        fail("s5-no-header", "Missing session header → rejected", msg);
      }
    }

    // S6 — concurrent storm
    const s6 = `p3s6${fx.tag}`.slice(0, 32);
    const stormInput = {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.EMPLOYEE,
      employeeId: fx.employeeId,
    };
    await Promise.all(
      Array.from({ length: 25 }, () =>
        recordScan(s6, "/api/qr/scan", stormInput),
      ),
    );
    const rows6 = await prisma.qrScanEvent.count({ where: { businessId: fx.businessId, sessionId: s6 } });
    if (rows6 === 1) {
      pass("s6-concurrent", "25 concurrent POST /api/qr/scan → 1 row", `rows=${rows6}`);
    } else {
      fail("s6-concurrent", "25 concurrent POST /api/qr/scan → 1 row", `rows=${rows6}`);
    }

    // S7 — payment completes visit; retry does not create new scan
    const s7 = `p3s7${fx.tag}`.slice(0, 32);
    const r7a = await recordScan(s7, "/api/qr/scan", {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.TABLE_ID,
      tableId: fx.tableId,
      locationId: fx.locationId,
    });
    await completeGuestVisit(fx.businessId, s7);
    const r7b = await recordScan(s7, "/api/qr/scan/after-payment", {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.BUSINESS_ID,
    });
    const rows7 = await prisma.qrScanEvent.count({ where: { businessId: fx.businessId, sessionId: s7 } });
    if (rows7 === 1 && r7a.inserted && !r7b.inserted) {
      pass("s7-payment-complete", "After payment complete → no second scan", `rows=${rows7}`);
    } else {
      fail("s7-payment-complete", "After payment complete → no second scan", `rows=${rows7}`);
    }

    // S8 — distinct sessions → distinct scans
    const s8a = `p3s8a${fx.tag}`.slice(0, 32);
    const s8b = `p3s8b${fx.tag}`.slice(0, 32);
    await recordScan(s8a, "/api/qr/scan", { businessId: fx.businessId, scanType: QR_SCAN_TYPES.BUSINESS_ID });
    await recordScan(s8b, "/api/qr/scan", { businessId: fx.businessId, scanType: QR_SCAN_TYPES.BUSINESS_ID });
    const rows8 = await prisma.qrScanEvent.count({
      where: { businessId: fx.businessId, sessionId: { in: [s8a, s8b] } },
    });
    if (rows8 === 2) {
      pass("s8-multi-device", "Two sessions → two scans", `rows=${rows8}`);
    } else {
      fail("s8-multi-device", "Two sessions → two scans", `rows=${rows8}`);
    }

    // Analytics parity
    const analytics = await getBusinessQrAnalytics(fx.businessId, "month");
    const totalDb = await prisma.qrScanEvent.count({ where: { businessId: fx.businessId } });
    if (analytics.totalScans >= totalDb) {
      pass("analytics-parity", "Analytics totalScans ≥ DB rows", `total=${analytics.totalScans} db=${totalDb}`);
    } else {
      fail("analytics-parity", "Analytics totalScans ≥ DB rows", `total=${analytics.totalScans} db=${totalDb}`);
    }

    // SQL dedupe integrity
    const dupScans = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c FROM (
        SELECT dedupe_key, COUNT(*) AS n FROM qr_scan_events
        WHERE business_id = ${fx.businessId}
        GROUP BY dedupe_key HAVING COUNT(*) > 1
      ) d
    `;
    if (Number(dupScans[0]?.c ?? 0) === 0) {
      pass("sql-dedupe", "No duplicate dedupe_key in qr_scan_events", "0 duplicates");
    } else {
      fail("sql-dedupe", "No duplicate dedupe_key", `dup=${dupScans[0]?.c}`);
    }

    void QR_GUEST_VISIT_TTL_MS;
  } finally {
    await fx.cleanup();
  }

  const failed = results.filter((r) => r.status === "FAIL");
  console.info("\n--- QR Phase 3 Regression ---");
  for (const r of results) {
    console.info(`${r.status === "PASS" ? "✓" : "✗"} [${r.id}] ${r.name}: ${r.detail}`);
  }
  console.info(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
