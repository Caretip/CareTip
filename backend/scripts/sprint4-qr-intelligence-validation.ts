/**
 * Sprint 4 — QR intelligence validation (scan accuracy, attribution, funnel).
 * Run: npm run test:sprint4-qr-intelligence
 */
import type { Request } from "express";
import bcrypt from "bcrypt";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { QR_SCAN_TYPES, recordQrScanEvent, persistQrScanEvent } from "../src/services/qr/qrScanEvent.service.js";
import {
  buildScanDedupeKey,
  QR_SCAN_DEDUPE_WINDOW_MS,
} from "../src/services/qr/qrScanRequestContext.js";
import { getBusinessQrAnalytics } from "../src/services/qr/qrAnalytics.service.js";
import {
  QR_FUNNEL_EVENT_TYPES,
  recordQrFunnelEvent,
} from "../src/services/qr/qrFunnelEvent.service.js";

type Result = { id: string; name: string; status: "PASS" | "FAIL" | "SKIP"; detail: string };
const results: Result[] = [];

function pass(id: string, name: string, detail: string) {
  results.push({ id, name, status: "PASS", detail });
}
function fail(id: string, name: string, detail: string) {
  results.push({ id, name, status: "FAIL", detail });
}
function skip(id: string, name: string, detail: string) {
  results.push({ id, name, status: "SKIP", detail });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mockReq(sessionId: string, path: string): Request {
  return {
    headers: {
      "x-caretip-scan-session": sessionId,
      "user-agent": "CareTip-Sprint4-QR-Validation/1.0",
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
      email: `sprint4-qr-val-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `Sprint4 QR Val ${tag}`,
          slug: `sprint4-qr-val-${tag}`,
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
      email: `sprint4-qr-emp-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      employee: {
        create: {
          name: "QR Val Staff",
          slug: `sprint4-qr-staff-${tag}`,
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
    data: {
      name: "QR Val Location",
      businessId,
    },
  });

  const table = await prisma.table.create({
    data: {
      name: "QR Val Table",
      qrSlug: `sprint4-qr-table-${tag}`,
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
    qrSlug: table.qrSlug,
    cleanup: async () => {
      await prisma.qrFunnelEvent.deleteMany({ where: { businessId } });
      await prisma.qrScanEvent.deleteMany({ where: { businessId } });
      await prisma.transaction.deleteMany({ where: { businessId } });
      await prisma.table.delete({ where: { id: table.id } }).catch(() => {});
      await prisma.location.delete({ where: { id: location.id } }).catch(() => {});
      await prisma.employee.deleteMany({ where: { businessId } });
      await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
      await prisma.user.deleteMany({
        where: { email: { in: [`sprint4-qr-val-${tag}@caretip-test.local`, `sprint4-qr-emp-${tag}@caretip-test.local`] } },
      });
    },
  };
}

async function countScans(businessId: string) {
  return prisma.qrScanEvent.count({ where: { businessId } });
}

async function main() {
  console.info("[sprint4-qr-val] Starting QR intelligence validation…\n");

  try {
    await prisma.$queryRaw`SELECT 1 FROM qr_scan_events LIMIT 1`;
    pass("schema", "qr_scan_events table", "Table exists and is queryable");
  } catch (e) {
    fail("schema", "qr_scan_events table", `Missing or inaccessible: ${e instanceof Error ? e.message : String(e)}`);
    printSummary();
    process.exit(1);
  }

  const fx = await seedFixture();
  const sessionRepeat = `s4repeat${fx.tag}`.slice(0, 32);

  try {
    // --- Scan accuracy: 5 persisted events, same session ---
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
          entryPath: `/api/staff/directory/business/${fx.businessSlug}/employee/${fx.employeeSlug}`,
          userAgent: "CareTip-Sprint4-QR-Validation/1.0",
          deviceType: "desktop",
          sessionId: sessionRepeat,
          dedupeKey,
          scannedAt: at,
        },
      });
    }

    const analyticsRepeat = await getBusinessQrAnalytics(fx.businessId, "month");
    const employeeScans = analyticsRepeat.scansByEmployee.find((r) => r.id === fx.employeeId)?.count ?? 0;

    if (
      analyticsRepeat.totalScans === 5 &&
      analyticsRepeat.uniqueScans === 1 &&
      analyticsRepeat.repeatScans === 4
    ) {
      pass(
        "scan-accuracy",
        "Same QR ×5 → total/unique/repeat",
        `totalScans=${analyticsRepeat.totalScans}, uniqueScans=${analyticsRepeat.uniqueScans}, repeatScans=${analyticsRepeat.repeatScans}`,
      );
    } else {
      fail(
        "scan-accuracy",
        "Same QR ×5 → total/unique/repeat",
        `Expected 5/1/4; got ${analyticsRepeat.totalScans}/${analyticsRepeat.uniqueScans}/${analyticsRepeat.repeatScans}`,
      );
    }

    // --- Dedupe window (100 concurrent — Sprint 4.1 atomic) ---
    const sessionDedupe = `s4dedupe${fx.tag}`.slice(0, 32);
    const dedupeInput = {
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.EMPLOYEE_LEGACY_SLUG,
      employeeId: fx.employeeId,
      req: mockReq(sessionDedupe, `/api/staff/${fx.employeeSlug}`),
    };
    const dedupeResults = await Promise.all(
      Array.from({ length: 100 }, () => persistQrScanEvent(dedupeInput)),
    );
    const afterDedupe = await prisma.qrScanEvent.count({
      where: { businessId: fx.businessId, sessionId: sessionDedupe },
    });
    const inserted = dedupeResults.filter((r) => r.inserted).length;
    if (afterDedupe === 1 && inserted === 1) {
      pass("scan-dedupe", "100 concurrent identical scans", `inserted=${inserted}, rows=${afterDedupe}`);
    } else {
      fail(
        "scan-dedupe",
        "100 concurrent identical scans",
        `Expected inserted=1 rows=1; got inserted=${inserted} rows=${afterDedupe}`,
      );
    }

    // --- Attribution ---
    const sessionAttr = `s4attr${fx.tag}`.slice(0, 32);

    recordQrScanEvent({
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.EMPLOYEE,
      employeeId: fx.employeeId,
      req: mockReq(sessionAttr, `/api/staff/directory/business/${fx.businessSlug}/employee/${fx.employeeSlug}`),
    });
    recordQrScanEvent({
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.LOCATION,
      locationId: fx.locationId,
      req: mockReq(`${sessionAttr}loc`, `/api/tipping-context/location/${fx.locationId}`),
    });
    recordQrScanEvent({
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.TABLE_ID,
      locationId: fx.locationId,
      tableId: fx.tableId,
      qrSlug: fx.qrSlug,
      req: mockReq(`${sessionAttr}tbl`, `/api/tipping-context/table/${fx.tableId}`),
    });
    recordQrScanEvent({
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.BUSINESS_DIRECTORY,
      req: mockReq(`${sessionAttr}biz`, `/api/staff/directory/business/${fx.businessSlug}`),
    });
    await sleep(800);

    const empRow = await prisma.qrScanEvent.findFirst({
      where: { businessId: fx.businessId, scanType: QR_SCAN_TYPES.EMPLOYEE, employeeId: fx.employeeId },
      orderBy: { scannedAt: "desc" },
    });
    if (empRow?.employeeId && !empRow.locationId && !empRow.tableId) {
      pass("attr-employee", "Employee QR", `employeeId=${empRow.employeeId}`);
    } else {
      fail("attr-employee", "Employee QR", `Row: ${JSON.stringify(empRow)}`);
    }

    const locRow = await prisma.qrScanEvent.findFirst({
      where: { businessId: fx.businessId, scanType: QR_SCAN_TYPES.LOCATION },
      orderBy: { scannedAt: "desc" },
    });
    if (locRow?.locationId && !locRow.tableId) {
      pass("attr-location", "Location QR", `locationId=${locRow.locationId}`);
    } else {
      fail("attr-location", "Location QR", `Row: ${JSON.stringify(locRow)}`);
    }

    const tblRow = await prisma.qrScanEvent.findFirst({
      where: { businessId: fx.businessId, scanType: QR_SCAN_TYPES.TABLE_ID },
      orderBy: { scannedAt: "desc" },
    });
    if (tblRow?.tableId && tblRow.locationId) {
      pass("attr-table", "Table QR", `tableId=${tblRow.tableId}, locationId=${tblRow.locationId}`);
    } else {
      fail("attr-table", "Table QR", `Row: ${JSON.stringify(tblRow)}`);
    }

    const bizRow = await prisma.qrScanEvent.findFirst({
      where: { businessId: fx.businessId, scanType: QR_SCAN_TYPES.BUSINESS_DIRECTORY },
      orderBy: { scannedAt: "desc" },
    });
    if (bizRow?.businessId && !bizRow.employeeId && !bizRow.locationId && !bizRow.tableId) {
      pass("attr-business", "Business QR", `businessId only (${bizRow.businessId})`);
    } else {
      fail("attr-business", "Business QR", `Row: ${JSON.stringify(bizRow)}`);
    }

    // --- Funnel integrity ---
    const funnelSession = `s4funnel${fx.tag}`.slice(0, 32);
    recordQrScanEvent({
      businessId: fx.businessId,
      scanType: QR_SCAN_TYPES.EMPLOYEE,
      employeeId: fx.employeeId,
      locationId: fx.locationId,
      req: mockReq(funnelSession, `/api/staff/directory/business/${fx.businessSlug}/employee/${fx.employeeSlug}`),
    });
    await sleep(400);

    recordQrFunnelEvent({
      businessId: fx.businessId,
      sessionId: funnelSession,
      eventType: QR_FUNNEL_EVENT_TYPES.TIP_STARTED,
      employeeId: fx.employeeId,
      locationId: fx.locationId,
    });

    const tx = await prisma.transaction.create({
      data: {
        amount: 5,
        status: "success",
        employeeId: fx.employeeId,
        businessId: fx.businessId,
        locationId: fx.locationId,
      },
    });

    recordQrFunnelEvent({
      businessId: fx.businessId,
      sessionId: funnelSession,
      eventType: QR_FUNNEL_EVENT_TYPES.PAYMENT_COMPLETED,
      employeeId: fx.employeeId,
      locationId: fx.locationId,
      transactionId: tx.id,
    });
    await sleep(600);

    const scanEvt = await prisma.qrScanEvent.findFirst({
      where: { businessId: fx.businessId, sessionId: funnelSession },
    });
    const funnel = await prisma.qrFunnelEvent.findMany({
      where: { businessId: fx.businessId, sessionId: funnelSession },
      orderBy: { createdAt: "asc" },
    });

    const hasScan = Boolean(scanEvt);
    const hasTipStarted = funnel.some((f) => f.eventType === QR_FUNNEL_EVENT_TYPES.TIP_STARTED);
    const hasPaid = funnel.some(
      (f) => f.eventType === QR_FUNNEL_EVENT_TYPES.PAYMENT_COMPLETED && f.transactionId === tx.id,
    );

    if (hasScan && hasTipStarted && hasPaid) {
      pass(
        "funnel",
        "Scan → Tip Started → Payment Completed",
        `sessionId=${funnelSession}; scan + ${funnel.length} funnel events`,
      );
    } else {
      fail(
        "funnel",
        "Scan → Tip Started → Payment Completed",
        `scan=${hasScan}, tip_started=${hasTipStarted}, payment_completed=${hasPaid}`,
      );
    }

    // --- Demo account smoke (optional) ---
    const demoBiz = await prisma.business.findFirst({
      where: { user: { email: "demo@caretip.de" } },
      select: { id: true, slug: true },
    });
    if (demoBiz?.id) {
      const demoAnalytics = await getBusinessQrAnalytics(demoBiz.id, "month");
      pass(
        "demo-smoke",
        "demo@caretip.de analytics readable",
        `businessId=${demoBiz.id}; totalScans=${demoAnalytics.totalScans} (live data)`,
      );
    } else {
      skip("demo-smoke", "demo@caretip.de analytics", "Demo business not found in DB");
    }
  } finally {
    await fx.cleanup();
  }

  printSummary();
  const failed = results.filter((r) => r.status === "FAIL").length;
  process.exit(failed > 0 ? 1 : 0);
}

function printSummary() {
  console.info("\n--- Sprint 4 QR Intelligence Validation ---\n");
  for (const r of results) {
    console.info(`${r.status.padEnd(5)} [${r.id}] ${r.name}`);
    console.info(`       ${r.detail}\n`);
  }
  const p = results.filter((r) => r.status === "PASS").length;
  const f = results.filter((r) => r.status === "FAIL").length;
  const s = results.filter((r) => r.status === "SKIP").length;
  console.info(`Summary: ${p} passed, ${f} failed, ${s} skipped`);
}

main().catch((err) => {
  console.error("[sprint4-qr-val] fatal", err);
  process.exit(1);
});
