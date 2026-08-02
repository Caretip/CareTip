/**
 * Sprint 4.1 — QR scan dedupe concurrency stress tests.
 * Run: npm run test:sprint41-qr-dedupe
 */
import type { Request } from "express";
import bcrypt from "bcrypt";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import {
  QR_SCAN_TYPES,
  persistQrScanEvent,
  type RecordQrScanEventInput,
} from "../src/services/qr/qrScanEvent.service.js";
import {
  QR_SCAN_DEDUPE_WINDOW_MS,
  buildScanDedupeKey,
  scanDedupeBucket,
} from "../src/services/qr/qrScanRequestContext.js";
import { getBusinessQrAnalytics } from "../src/services/qr/qrAnalytics.service.js";

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
      "user-agent": "CareTip-Sprint41-Dedupe-Stress/1.0",
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
      email: `sprint41-dedupe-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `Sprint41 Dedupe ${tag}`,
          slug: `sprint41-dedupe-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
          timezone: "Europe/Berlin",
        },
      },
    },
    include: { business: true },
  });
  const businessId = user.business!.id;
  const empUser = await prisma.user.create({
    data: {
      email: `sprint41-emp-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      employee: {
        create: {
          name: "Dedupe Staff",
          slug: `sprint41-staff-${tag}`,
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
    data: { name: "Dedupe Location", businessId },
  });
  const table = await prisma.table.create({
    data: {
      name: "Dedupe Table",
      qrSlug: `sprint41-table-${tag}`,
      locationId: location.id,
    },
  });
  return {
    tag,
    businessId,
    businessSlug: user.business!.slug!,
    employeeId: empUser.employee!.id,
    employeeSlug: empUser.employee!.slug!,
    locationId: location.id,
    tableId: table.id,
    cleanup: async () => {
      await prisma.qrFunnelEvent.deleteMany({ where: { businessId } });
      await prisma.qrScanEvent.deleteMany({ where: { businessId } });
      await prisma.transaction.deleteMany({ where: { businessId } });
      await prisma.table.delete({ where: { id: table.id } }).catch(() => {});
      await prisma.location.delete({ where: { id: location.id } }).catch(() => {});
      await prisma.employee.deleteMany({ where: { businessId } });
      await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
      await prisma.user.deleteMany({
        where: {
          email: {
            in: [`sprint41-dedupe-${tag}@caretip-test.local`, `sprint41-emp-${tag}@caretip-test.local`],
          },
        },
      });
    },
  };
}

function scanInput(
  fx: Awaited<ReturnType<typeof seedFixture>>,
  sessionId: string,
  scanType = QR_SCAN_TYPES.EMPLOYEE,
): RecordQrScanEventInput {
  return {
    businessId: fx.businessId,
    scanType,
    employeeId: fx.employeeId,
    req: mockReq(
      sessionId,
      `/api/staff/directory/business/${fx.businessSlug}/employee/${fx.employeeSlug}`,
    ),
  };
}

async function main() {
  console.info("[sprint41-dedupe] Starting concurrency stress tests…\n");

  const fx = await seedFixture();

  try {
    // --- 100 concurrent identical requests → 1 row ---
    const sessionStorm = `s41storm${fx.tag}`.slice(0, 32);
    const stormInput = scanInput(fx, sessionStorm);
    const stormResults = await Promise.all(
      Array.from({ length: 100 }, () => persistQrScanEvent(stormInput)),
    );
    const stormInserted = stormResults.filter((r) => r.inserted).length;
    const stormRows = await prisma.qrScanEvent.count({
      where: { businessId: fx.businessId, sessionId: sessionStorm },
    });
    if (stormRows === 1 && stormInserted === 1) {
      pass(
        "concurrent-same-session",
        "100 concurrent identical scans",
        `inserted=${stormInserted}, rows=${stormRows}`,
      );
    } else {
      fail(
        "concurrent-same-session",
        "100 concurrent identical scans",
        `Expected inserted=1 rows=1; got inserted=${stormInserted} rows=${stormRows}`,
      );
    }

    // --- 20 guests simultaneously → 20 rows ---
    const guestSessions = Array.from({ length: 20 }, (_, i) => `s41guest${fx.tag}${i}`.slice(0, 32));
    await Promise.all(guestSessions.map((sid) => persistQrScanEvent(scanInput(fx, sid))));
    const guestRows = await prisma.qrScanEvent.count({
      where: { businessId: fx.businessId, sessionId: { in: guestSessions } },
    });
    if (guestRows === 20) {
      pass("concurrent-multi-guest", "20 guests same QR simultaneously", `rows=${guestRows}`);
    } else {
      fail("concurrent-multi-guest", "20 guests same QR simultaneously", `Expected 20; got ${guestRows}`);
    }

    // --- Single guest rapid rescans within window → 1 row ---
    const sessionRapid = `s41rapid${fx.tag}`.slice(0, 32);
    const rapidInput = scanInput(fx, sessionRapid);
    const rapidResults = await Promise.all(
      Array.from({ length: 50 }, () => persistQrScanEvent(rapidInput)),
    );
    const rapidRows = await prisma.qrScanEvent.count({
      where: { businessId: fx.businessId, sessionId: sessionRapid },
    });
    if (rapidRows === 1 && rapidResults.filter((r) => r.inserted).length === 1) {
      pass("rapid-rescan-window", "Rapid rescans within 30s", `rows=${rapidRows}`);
    } else {
      fail(
        "rapid-rescan-window",
        "Rapid rescans within 30s",
        `Expected 1 row; got rows=${rapidRows} inserted=${rapidResults.filter(Boolean).length}`,
      );
    }

    // --- Outside dedupe window → new row ---
    const sessionWindow = `s41window${fx.tag}`.slice(0, 32);
    const windowInput = scanInput(fx, sessionWindow);
    const first = await persistQrScanEvent(windowInput);
    await sleep(QR_SCAN_DEDUPE_WINDOW_MS + 500);
    const second = await persistQrScanEvent(windowInput);
    const windowRows = await prisma.qrScanEvent.count({
      where: { businessId: fx.businessId, sessionId: sessionWindow },
    });
    if (first.inserted && second.inserted && windowRows === 2) {
      pass("bucket-rollover", "Rescan after 30s window", `rows=${windowRows} (new bucket)`);
    } else {
      fail(
        "bucket-rollover",
        "Rescan after 30s window",
        `Expected first+second inserted rows=2; got first=${first.inserted} second=${second.inserted} rows=${windowRows}`,
      );
    }

    // --- Cross scanType within same session → 1 row (guest journey parity) ---
    const sessionJourney = `s41journey${fx.tag}`.slice(0, 32);
    const journeyResults = await Promise.all([
      persistQrScanEvent({
        businessId: fx.businessId,
        scanType: QR_SCAN_TYPES.TABLE_SLUG,
        locationId: fx.locationId,
        tableId: fx.tableId,
        qrSlug: "table-abc",
        req: mockReq(sessionJourney, `/api/tipping-context/table-abc`),
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
    const journeyRows = await prisma.qrScanEvent.count({
      where: { businessId: fx.businessId, sessionId: sessionJourney },
    });
    if (
      journeyRows === 1 &&
      journeyResults.filter((r) => r.inserted).length === 1
    ) {
      pass(
        "cross-scantype-journey",
        "Table + business + directory APIs in one session",
        `rows=${journeyRows} inserted=${journeyResults.filter((r) => r.inserted).length}`,
      );
    } else {
      fail(
        "cross-scantype-journey",
        "Table + business + directory APIs in one session",
        `Expected 1 row / 1 insert; got rows=${journeyRows} inserted=${journeyResults.filter((r) => r.inserted).length}`,
      );
    }

    // --- Analytics remain correct ---
    const sessionRepeat = `s41repeat${fx.tag}`.slice(0, 32);
    const base = new Date();
    for (let i = 0; i < 5; i++) {
      const at = new Date(base.getTime() - (4 - i) * (QR_SCAN_DEDUPE_WINDOW_MS + 1_000));
      const dedupeKey = buildScanDedupeKey({
        businessId: fx.businessId,
        sessionId: sessionRepeat,
        at,
      });
      await prisma.qrScanEvent.create({
        data: {
          businessId: fx.businessId,
          employeeId: fx.employeeId,
          scanType: QR_SCAN_TYPES.EMPLOYEE,
          entryPath: "/test",
          userAgent: "test",
          deviceType: "desktop",
          sessionId: sessionRepeat,
          dedupeKey,
          scannedAt: at,
        },
      });
    }
    const analytics = await getBusinessQrAnalytics(fx.businessId, "month");
    if (
      analytics.totalScans >= 5 &&
      analytics.uniqueScans >= 1 &&
      analytics.repeatScans === analytics.totalScans - analytics.uniqueScans
    ) {
      const repeatForSession = analytics.totalScans - analytics.uniqueScans;
      pass(
        "analytics-integrity",
        "totalScans / uniqueScans / repeatScans",
        `total=${analytics.totalScans} unique=${analytics.uniqueScans} repeat=${repeatForSession}`,
      );
    } else {
      fail(
        "analytics-integrity",
        "totalScans / uniqueScans / repeatScans",
        `total=${analytics.totalScans} unique=${analytics.uniqueScans} repeat=${analytics.repeatScans}`,
      );
    }

    // --- Bucket helper sanity ---
    const b0 = scanDedupeBucket(new Date(0));
    const b1 = scanDedupeBucket(new Date(QR_SCAN_DEDUPE_WINDOW_MS));
    if (b1 === b0 + 1) {
      pass("bucket-math", "30s bucket increments", `bucket(0)=${b0} bucket(30s)=${b1}`);
    } else {
      fail("bucket-math", "30s bucket increments", `b0=${b0} b1=${b1}`);
    }
  } finally {
    await fx.cleanup();
  }

  printSummary();
  process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
}

function printSummary() {
  console.info("\n--- Sprint 4.1 QR Dedupe Concurrency ---\n");
  for (const r of results) {
    console.info(`${r.status.padEnd(5)} [${r.id}] ${r.name}`);
    console.info(`       ${r.detail}\n`);
  }
  const p = results.filter((r) => r.status === "PASS").length;
  const f = results.filter((r) => r.status === "FAIL").length;
  console.info(`Summary: ${p} passed, ${f} failed`);
}

main().catch((err) => {
  console.error("[sprint41-dedupe] fatal", err);
  process.exit(1);
});
