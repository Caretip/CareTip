/**
 * Phase 2 — QR scan forensics journey simulation.
 * Run: QR_SCAN_FORENSICS=1 npm run test:qr-scan-forensics-phase2
 *
 * Captures structured JSON logs to stdout for QR_SCAN_FORENSIC_PHASE2.md evidence.
 */
import type { Request } from "express";
import bcrypt from "bcrypt";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import {
  QR_SCAN_TYPES,
  persistQrScanEvent,
} from "../src/services/qr/qrScanEvent.service.js";
import { QR_SCAN_DEDUPE_WINDOW_MS } from "../src/services/qr/qrScanRequestContext.js";
import {
  logForensicsJourneyTimeline,
  resetForensicsSessionTrack,
} from "../src/services/qr/qrScanForensics.js";
import { getBusinessQrAnalytics } from "../src/services/qr/qrAnalytics.service.js";
import { ACTIVITY_EVENT_TYPES } from "../src/services/activity/businessActivityEvent.service.js";

process.env.QR_SCAN_FORENSICS = "1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ScenarioResult = {
  id: string;
  name: string;
  journeyId: string;
  scanRows: number;
  activityRows: number;
  totalScansApi: number;
  insertedCount: number;
  dedupedCount: number;
  verdict: string;
};

const scenarioResults: ScenarioResult[] = [];

function mockReq(opts: {
  sessionId?: string;
  journeyId: string;
  path: string;
  requestId?: string;
  omitSessionHeader?: boolean;
}): Request {
  const headers: Record<string, string> = {
    "user-agent": "CareTip-QR-Forensics-Phase2/1.0",
    "x-caretip-journey-id": opts.journeyId,
    "x-request-id": opts.requestId ?? `req-${opts.journeyId}-${Date.now()}`,
  };
  if (!opts.omitSessionHeader && opts.sessionId) {
    headers["x-caretip-scan-session"] = opts.sessionId;
  }
  return {
    headers,
    originalUrl: opts.path,
    url: opts.path,
    path: opts.path,
    ip: "127.0.0.1",
  } as Request;
}

async function seedFixture() {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `qr-forensics-p2-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `QR Forensics P2 ${tag}`,
          slug: `qr-forensics-p2-${tag}`,
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
      email: `qr-forensics-emp-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      employee: {
        create: {
          name: "Forensics Staff",
          slug: `forensics-staff-${tag}`,
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
    data: { name: "Table 1", locationId: location.id, qrSlug: `tbl-p2-${tag}` },
  });

  return {
    tag,
    businessId,
    managerUserId: user.id,
    businessSlug: user.business!.slug!,
    employeeId: empUser.employee!.id,
    locationId: location.id,
    tableId: table.id,
    qrSlug: table.qrSlug,
    cleanup: async () => {
      await prisma.notification.deleteMany({ where: { userId: user.id } });
      await prisma.businessActivityEvent.deleteMany({ where: { businessId } });
      await prisma.qrFunnelEvent.deleteMany({ where: { businessId } });
      await prisma.qrScanEvent.deleteMany({ where: { businessId } });
      await prisma.table.delete({ where: { id: table.id } }).catch(() => undefined);
      await prisma.location.delete({ where: { id: location.id } }).catch(() => undefined);
      await prisma.employee.deleteMany({ where: { businessId } });
      await prisma.business.delete({ where: { id: businessId } }).catch(() => undefined);
      await prisma.user.deleteMany({
        where: {
          email: {
            in: [
              `qr-forensics-p2-${tag}@caretip-test.local`,
              `qr-forensics-emp-${tag}@caretip-test.local`,
            ],
          },
        },
      });
    },
  };
}

async function waitForActivity(businessId: string, minCount: number, attempts = 30): Promise<number> {
  for (let i = 0; i < attempts; i++) {
    const count = await prisma.businessActivityEvent.count({
      where: { businessId, type: ACTIVITY_EVENT_TYPES.QR_SCANNED },
    });
    if (count >= minCount) return count;
    await sleep(100);
  }
  return prisma.businessActivityEvent.count({
    where: { businessId, type: ACTIVITY_EVENT_TYPES.QR_SCANNED },
  });
}

async function countSessionScans(businessId: string, sessionId: string): Promise<number> {
  return prisma.qrScanEvent.count({ where: { businessId, sessionId } });
}

async function runScenario(
  fx: Awaited<ReturnType<typeof seedFixture>>,
  spec: {
    id: string;
    name: string;
    run: (journeyId: string, sessionId: string) => Promise<{ inserted: number; deduped: number }>;
  },
): Promise<void> {
  resetForensicsSessionTrack();
  await prisma.qrScanEvent.deleteMany({ where: { businessId: fx.businessId } });
  await prisma.businessActivityEvent.deleteMany({ where: { businessId: fx.businessId } });

  const journeyId = `journey-${spec.id}-${fx.tag}`;
  const sessionId = `sess-${spec.id}-${fx.tag}`.slice(0, 32);

  logForensicsJourneyTimeline(journeyId, "scenario.start", {
    scenarioId: spec.id,
    scenarioName: spec.name,
    sessionId,
  });

  const { inserted, deduped } = await spec.run(journeyId, sessionId);
  await sleep(500);
  await waitForActivity(fx.businessId, inserted);

  const scanRows = await countSessionScans(fx.businessId, sessionId);
  const allScanRows = await prisma.qrScanEvent.count({ where: { businessId: fx.businessId } });
  const activityRows = await prisma.businessActivityEvent.count({
    where: { businessId: fx.businessId, type: ACTIVITY_EVENT_TYPES.QR_SCANNED },
  });
  const analytics = await getBusinessQrAnalytics(fx.businessId, "month");

  const verdict =
    scanRows === 1 && inserted === 1
      ? "PASS — one physical journey → one scan row"
      : scanRows === 2 && inserted === 2
        ? "CONFIRMED_DUP — two inserts (see logs for bucket/session cause)"
        : scanRows > 1
          ? `ANOMALY — ${scanRows} scan rows, ${inserted} inserts, ${deduped} deduped`
          : `INFO — ${scanRows} rows, ${inserted} inserts`;

  scenarioResults.push({
    id: spec.id,
    name: spec.name,
    journeyId,
    scanRows: allScanRows,
    activityRows,
    totalScansApi: analytics.totalScans,
    insertedCount: inserted,
    dedupedCount: deduped,
    verdict,
  });

  logForensicsJourneyTimeline(journeyId, "scenario.end", {
    scenarioId: spec.id,
    scanRows,
    activityRows,
    totalScansApi: analytics.totalScans,
    inserted,
    deduped,
    verdict,
  });
}

async function main() {
  console.info("[qr-forensics-p2] Phase 2 journey simulation starting…\n");
  const fx = await seedFixture();

  try {
    await runScenario(fx, {
      id: "S1",
      name: "Scan only — table + business + directory (parallel, same session)",
      run: async (journeyId, sessionId) => {
        logForensicsJourneyTimeline(journeyId, "qr.opened", { sessionId });
        const results = await Promise.all([
          persistQrScanEvent({
            businessId: fx.businessId,
            scanType: QR_SCAN_TYPES.TABLE_SLUG,
            locationId: fx.locationId,
            tableId: fx.tableId,
            qrSlug: fx.qrSlug,
            req: mockReq({ sessionId, journeyId, path: `/api/tipping-context/${fx.qrSlug}` }),
            forensicsSource: { controller: "tippingContext.getByQrSlug", route: "GET /api/tipping-context/:qrSlug" },
          }),
          persistQrScanEvent({
            businessId: fx.businessId,
            scanType: QR_SCAN_TYPES.BUSINESS_ID,
            req: mockReq({ sessionId, journeyId, path: `/api/business/${fx.businessId}` }),
            forensicsSource: { controller: "business.getById", route: "GET /api/business/:businessId" },
          }),
          persistQrScanEvent({
            businessId: fx.businessId,
            scanType: QR_SCAN_TYPES.BUSINESS_DIRECTORY,
            req: mockReq({
              sessionId,
              journeyId,
              path: `/api/staff/directory/business/${fx.businessSlug}`,
            }),
            forensicsSource: {
              controller: "staff.listActiveEmployeesByBusinessSlug",
              route: "GET /api/staff/directory/business/:slug",
            },
          }),
        ]);
        return {
          inserted: results.filter((r) => r.inserted).length,
          deduped: results.filter((r) => !r.inserted).length,
        };
      },
    });

    await runScenario(fx, {
      id: "S2",
      name: "Scan + employee API within 10s (simulates quick checkout journey)",
      run: async (journeyId, sessionId) => {
        logForensicsJourneyTimeline(journeyId, "qr.opened", { sessionId });
        const r1 = await persistQrScanEvent({
          businessId: fx.businessId,
          scanType: QR_SCAN_TYPES.TABLE_SLUG,
          locationId: fx.locationId,
          tableId: fx.tableId,
          qrSlug: fx.qrSlug,
          req: mockReq({ sessionId, journeyId, path: `/api/tipping-context/${fx.qrSlug}` }),
          forensicsSource: { controller: "tippingContext.getByQrSlug", route: "GET /api/tipping-context/:qrSlug" },
        });
        logForensicsJourneyTimeline(journeyId, "stripe.checkout.simulated", { delayMs: 8000 });
        await sleep(8_000);
        logForensicsJourneyTimeline(journeyId, "payment.return.simulated", { note: "no scan route on tip-session poll" });
        const r2 = await persistQrScanEvent({
          businessId: fx.businessId,
          scanType: QR_SCAN_TYPES.EMPLOYEE_LEGACY_ID,
          employeeId: fx.employeeId,
          req: mockReq({ sessionId, journeyId, path: `/api/employees/${fx.employeeId}` }),
          forensicsSource: { controller: "employee.getEmployeeById", route: "GET /api/employees/:employeeId" },
        });
        return {
          inserted: [r1, r2].filter((r) => r.inserted).length,
          deduped: [r1, r2].filter((r) => !r.inserted).length,
        };
      },
    });

    await runScenario(fx, {
      id: "S3",
      name: "Scan + employee API after 45s (bucket rollover — payment >30s)",
      run: async (journeyId, sessionId) => {
        const r1 = await persistQrScanEvent({
          businessId: fx.businessId,
          scanType: QR_SCAN_TYPES.TABLE_SLUG,
          locationId: fx.locationId,
          tableId: fx.tableId,
          qrSlug: fx.qrSlug,
          req: mockReq({ sessionId, journeyId, path: `/api/tipping-context/${fx.qrSlug}` }),
          forensicsSource: { controller: "tippingContext.getByQrSlug", route: "GET /api/tipping-context/:qrSlug" },
        });
        logForensicsJourneyTimeline(journeyId, "stripe.checkout.simulated", {
          delayMs: 45_000,
          exceedsBucketMs: QR_SCAN_DEDUPE_WINDOW_MS,
        });
        await sleep(45_000);
        const r2 = await persistQrScanEvent({
          businessId: fx.businessId,
          scanType: QR_SCAN_TYPES.EMPLOYEE_LEGACY_ID,
          employeeId: fx.employeeId,
          req: mockReq({ sessionId, journeyId, path: `/api/employees/${fx.employeeId}` }),
          forensicsSource: { controller: "employee.getEmployeeById", route: "GET /api/employees/:employeeId" },
        });
        return {
          inserted: [r1, r2].filter((r) => r.inserted).length,
          deduped: [r1, r2].filter((r) => !r.inserted).length,
        };
      },
    });

    await runScenario(fx, {
      id: "S4",
      name: "Directory reload after 45s (BusinessStaffDirectoryPage websocket/fallback)",
      run: async (journeyId, sessionId) => {
        const r1 = await persistQrScanEvent({
          businessId: fx.businessId,
          scanType: QR_SCAN_TYPES.BUSINESS_DIRECTORY,
          req: mockReq({
            sessionId,
            journeyId,
            path: `/api/staff/directory/business/${fx.businessSlug}`,
          }),
          forensicsSource: {
            controller: "staff.listActiveEmployeesByBusinessSlug",
            route: "GET /api/staff/directory/business/:slug",
          },
        });
        await sleep(45_000);
        logForensicsJourneyTimeline(journeyId, "directory.reload", { delayMs: 45_000 });
        const r2 = await persistQrScanEvent({
          businessId: fx.businessId,
          scanType: QR_SCAN_TYPES.BUSINESS_DIRECTORY,
          req: mockReq({
            sessionId,
            journeyId,
            path: `/api/staff/directory/business/${fx.businessSlug}`,
            requestId: `req-reload-${journeyId}`,
          }),
          forensicsSource: {
            controller: "staff.listActiveEmployeesByBusinessSlug",
            route: "GET /api/staff/directory/business/:slug",
          },
        });
        return {
          inserted: [r1, r2].filter((r) => r.inserted).length,
          deduped: [r1, r2].filter((r) => !r.inserted).length,
        };
      },
    });

    await runScenario(fx, {
      id: "S5",
      name: "Session split — header on first request, missing on second (same journey)",
      run: async (journeyId, sessionId) => {
        const r1 = await persistQrScanEvent({
          businessId: fx.businessId,
          scanType: QR_SCAN_TYPES.TABLE_SLUG,
          locationId: fx.locationId,
          tableId: fx.tableId,
          qrSlug: fx.qrSlug,
          req: mockReq({ sessionId, journeyId, path: `/api/tipping-context/${fx.qrSlug}` }),
          forensicsSource: { controller: "tippingContext.getByQrSlug", route: "GET /api/tipping-context/:qrSlug" },
        });
        const r2 = await persistQrScanEvent({
          businessId: fx.businessId,
          scanType: QR_SCAN_TYPES.EMPLOYEE_LEGACY_ID,
          employeeId: fx.employeeId,
          req: mockReq({
            sessionId,
            journeyId,
            path: `/api/employees/${fx.employeeId}`,
            omitSessionHeader: true,
          }),
          forensicsSource: { controller: "employee.getEmployeeById", route: "GET /api/employees/:employeeId" },
        });
        return {
          inserted: [r1, r2].filter((r) => r.inserted).length,
          deduped: [r1, r2].filter((r) => !r.inserted).length,
        };
      },
    });

    await runScenario(fx, {
      id: "S6",
      name: "Same API repeated after 31s (explicit bucket boundary)",
      run: async (journeyId, sessionId) => {
        const input = {
          businessId: fx.businessId,
          scanType: QR_SCAN_TYPES.TABLE_SLUG,
          locationId: fx.locationId,
          tableId: fx.tableId,
          qrSlug: fx.qrSlug,
          forensicsSource: { controller: "tippingContext.getByQrSlug", route: "GET /api/tipping-context/:qrSlug" },
        };
        const r1 = await persistQrScanEvent({
          ...input,
          req: mockReq({ sessionId, journeyId, path: `/api/tipping-context/${fx.qrSlug}` }),
        });
        await sleep(QR_SCAN_DEDUPE_WINDOW_MS + 1_000);
        const r2 = await persistQrScanEvent({
          ...input,
          req: mockReq({
            sessionId,
            journeyId,
            path: `/api/tipping-context/${fx.qrSlug}`,
            requestId: `req-second-${journeyId}`,
          }),
        });
        return {
          inserted: [r1, r2].filter((r) => r.inserted).length,
          deduped: [r1, r2].filter((r) => !r.inserted).length,
        };
      },
    });

    await runScenario(fx, {
      id: "S7",
      name: "Payment-only path — no scan-recording routes invoked",
      run: async (journeyId, sessionId) => {
        logForensicsJourneyTimeline(journeyId, "payment.checkout.only", {
          sessionId,
          note: "Simulates create-tip-session + webhook without any recordQrScanEvent",
        });
        return { inserted: 0, deduped: 0 };
      },
    });
  } finally {
    await fx.cleanup();
  }

  console.info("\n[qr-forensics-p2] === SCENARIO SUMMARY ===");
  console.info(JSON.stringify({ event: "qr.forensics.summary", scenarios: scenarioResults }, null, 2));

  const dupScenarios = scenarioResults.filter((s) => s.insertedCount >= 2);
  if (dupScenarios.length > 0) {
    console.info("\n[qr-forensics-p2] Duplicate insert scenarios:", dupScenarios.map((s) => s.id).join(", "));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[qr-forensics-p2] Fatal:", err);
  process.exit(1);
});
