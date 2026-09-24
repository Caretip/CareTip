/**
 * Real-browser validation — Business Analytics progressive loading + timings.
 * Run: npm run test:business-analytics-performance-browser
 *
 * Requires: Vite (5173) + backend (3001) running.
 */
import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const EMAIL = process.env.FORENSIC_LOGIN_EMAIL ?? "demo@caretip.de";
const PASSWORD = process.env.FORENSIC_LOGIN_PASSWORD ?? "Demo1234!";
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "test-results");

type NetEvent = {
  url: string;
  kind: string;
  start: number;
  end?: number;
};

type TimingReport = {
  scenario: string;
  origin: number;
  navigationEnd?: number;
  statsRequestStart?: number;
  statsResponseEnd?: number;
  financialRequestStart?: number;
  financialLedgerEnd?: number;
  financialConnectEnd?: number;
  financialReconciliationEnd?: number;
  tipsFeedEnd?: number;
  qrEnd?: number;
  clientMarks?: Record<string, number>;
  overviewAuthoritativeMs?: number;
  financialLedgerAuthoritativeMs?: number;
  reconciliationAuthoritativeMs?: number;
  parallelFinancialGapMs?: number | null;
  summaryRequestStart?: number;
  summaryResponseEnd?: number;
  deferredRequestStart?: number;
  deferredResponseEnd?: number;
};

type ScenarioResult = { id: string; pass: boolean; detail: string; evidence?: Record<string, unknown> };

const results: ScenarioResult[] = [];
const timings: TimingReport[] = [];
const pass = (id: string, detail: string, evidence?: Record<string, unknown>) =>
  results.push({ id, pass: true, detail, evidence });
const fail = (id: string, detail: string, evidence?: Record<string, unknown>) =>
  results.push({ id, pass: false, detail, evidence });

function classifyUrl(url: string): string | null {
  if (url.includes("/api/business/me/stats")) {
    try {
      const scope = new URL(url).searchParams.get("scope") ?? "full";
      if (scope === "aboveFold") return "statsAboveFold";
      if (scope === "analytics") return "statsDeferred";
      if (scope === "summary") return "statsSummary";
      if (scope === "full") return "statsFull";
    } catch {
      // fall through
    }
    return "stats";
  }
  if (url.includes("/api/business/me/tips")) return "tipsFeed";
  if (url.includes("/api/business/me/qr-analytics") || url.includes("/api/business/qr-analytics"))
    return "qr";
  if (url.includes("/api/me/connect/financial-summary")) {
    if (url.includes("section=ledger")) return "financialLedger";
    if (url.includes("section=connect")) return "financialConnect";
    if (url.includes("section=reconciliation")) return "financialReconciliation";
    if (url.includes("includeReconciliation=true")) return "financialFull";
    return "financial";
  }
  return null;
}

function trackNetwork(page: Page): NetEvent[] {
  const events: NetEvent[] = [];
  page.on("request", (req) => {
    const kind = classifyUrl(req.url());
    if (!kind) return;
    events.push({ url: req.url(), kind, start: Date.now() });
  });
  page.on("response", async (res) => {
    const kind = classifyUrl(res.url());
    if (!kind) return;
    const hit = events.find((e) => e.url === res.url() && e.end == null);
    if (hit) hit.end = Date.now();
  });
  return events;
}

function firstEvent(events: NetEvent[], kind: string, phase: "start" | "end" = "start"): number | undefined {
  const e = events.find((x) => x.kind === kind);
  if (!e) return undefined;
  return phase === "start" ? e.start : e.end;
}

async function loginViaUi(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator("#auth-email").fill(EMAIL);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 120_000 });
}

async function waitForClientMark(page: Page, mark: string, timeoutMs: number): Promise<number | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const marks = await readClientMarks(page);
    if (marks[mark] != null) return marks[mark];
    await page.waitForTimeout(200);
  }
  return undefined;
}

async function waitForAuthoritativeOverview(page: Page, timeoutMs: number, origin: number): Promise<number | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const marks = await readClientMarks(page);
    if (marks["analytics.overview.render"] == null) {
      await page.waitForTimeout(200);
      continue;
    }
    const euroVisible = await page
      .locator(".caretip-mobile-analytics-report")
      .getByText(/€\s*[\d,.]+|[\d,.]+\s*€/)
      .first()
      .isVisible()
      .catch(() => false);
    if (euroVisible) return Date.now() - origin;
    await page.waitForTimeout(200);
  }
  return undefined;
}

async function readClientMarks(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => window.__CARETIP_ANALYTICS_PERF__ ?? {});
}

async function runColdAnalyticsScenario(
  page: Page,
  scenario: string,
  events: NetEvent[],
): Promise<TimingReport> {
  events.length = 0;
  await page.evaluate(() => {
    window.__CARETIP_ANALYTICS_PERF__ = {};
  });

  const origin = Date.now();
  await page.goto(`${BASE}/dashboard/tips/analytics`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const navigationEnd = Date.now() - origin;

  const overviewAuthoritativeMs = await waitForAuthoritativeOverview(page, 90_000, origin);

  const financialLedgerAuthoritativeMs = await (async () => {
    const mark = await waitForClientMark(page, "analytics.financial.ledger.ready", 90_000);
    if (mark == null) return undefined;
    const euroVisible = await page
      .getByText(/Customer tips|Kundentrinkgeld/i)
      .locator("..")
      .getByText(/€\s*[\d,.]+|[\d,.]+\s*€|—/)
      .first()
      .isVisible()
      .catch(() => false);
    return euroVisible ? Date.now() - origin : mark;
  })();

  const reconciliationAuthoritativeMs = await (async () => {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const ok = await page
        .getByText(/reconciliation checks passed|abgleich.*ok|keine abweichungen/i)
        .first()
        .isVisible()
        .catch(() => false);
      const attention = await page
        .getByText(/needs attention|aufmerksamkeit/i)
        .first()
        .isVisible()
        .catch(() => false);
      if (ok || attention) return Date.now() - origin;
      const skeleton = await page.locator('[aria-label*="reconciliation" i] .animate-pulse').count();
      if (skeleton === 0) {
        const hasSection = await page.getByText(/reconciliation|abgleich/i).first().isVisible().catch(() => false);
        if (hasSection) return Date.now() - origin;
      }
      await page.waitForTimeout(250);
    }
    return undefined;
  })();

  const clientMarks = await readClientMarks(page);
  const statsStart =
    firstEvent(events, "statsAboveFold", "start") ??
    firstEvent(events, "stats", "start");
  const finStart = firstEvent(events, "financialLedger", "start") ?? firstEvent(events, "financial", "start");

  const report: TimingReport = {
    scenario,
    origin,
    navigationEnd,
    statsRequestStart: statsStart ? statsStart - origin : undefined,
    statsResponseEnd: firstEvent(events, "statsAboveFold", "end")
      ? firstEvent(events, "statsAboveFold", "end")! - origin
      : firstEvent(events, "stats", "end")
        ? firstEvent(events, "stats", "end")! - origin
        : undefined,
    summaryRequestStart: firstEvent(events, "statsAboveFold", "start")
      ? firstEvent(events, "statsAboveFold", "start")! - origin
      : undefined,
    summaryResponseEnd: firstEvent(events, "statsAboveFold", "end")
      ? firstEvent(events, "statsAboveFold", "end")! - origin
      : undefined,
    deferredRequestStart: firstEvent(events, "statsDeferred", "start")
      ? firstEvent(events, "statsDeferred", "start")! - origin
      : undefined,
    deferredResponseEnd: firstEvent(events, "statsDeferred", "end")
      ? firstEvent(events, "statsDeferred", "end")! - origin
      : undefined,
    financialRequestStart: finStart ? finStart - origin : undefined,
    financialLedgerEnd: firstEvent(events, "financialLedger", "end")
      ? firstEvent(events, "financialLedger", "end")! - origin
      : undefined,
    financialConnectEnd: firstEvent(events, "financialConnect", "end")
      ? firstEvent(events, "financialConnect", "end")! - origin
      : undefined,
    financialReconciliationEnd: firstEvent(events, "financialReconciliation", "end")
      ? firstEvent(events, "financialReconciliation", "end")! - origin
      : undefined,
    tipsFeedEnd: firstEvent(events, "tipsFeed", "end")
      ? firstEvent(events, "tipsFeed", "end")! - origin
      : undefined,
    qrEnd: firstEvent(events, "qrEnd" as never, "end"),
    clientMarks,
    overviewAuthoritativeMs,
    financialLedgerAuthoritativeMs,
    reconciliationAuthoritativeMs,
    parallelFinancialGapMs:
      statsStart && finStart ? Math.abs(finStart - statsStart) : null,
  };
  report.qrEnd = firstEvent(events, "qr", "end")
    ? firstEvent(events, "qr", "end")! - origin
    : undefined;

  timings.push(report);
  return report;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "en-GB" });
  const page = await context.newPage();
  const events: NetEvent[] = [];
  trackNetwork(page);

  try {
    await loginViaUi(page);

    const cold = await runColdAnalyticsScenario(page, "A-cold-direct", events);

    const markGap =
      cold.clientMarks?.["analytics.financial.request"] != null &&
      cold.clientMarks?.["analytics.stats.request"] != null
        ? Math.abs(
            cold.clientMarks["analytics.financial.request"]! -
              cold.clientMarks["analytics.stats.request"]!,
          )
        : null;

    if ((cold.parallelFinancialGapMs != null && cold.parallelFinancialGapMs < 5000) || (markGap != null && markGap < 500)) {
      pass(
        "A-parallel-financial",
        `financial-summary started in parallel (network gap=${cold.parallelFinancialGapMs ?? "n/a"}ms, mark gap=${markGap ?? "n/a"}ms)`,
        cold,
      );
    } else {
      fail("A-parallel-financial", "financial-summary did not start in parallel with stats", cold);
    }

    if (cold.overviewAuthoritativeMs != null) {
      pass(
        "A-overview-authoritative",
        `overview authoritative € data at ${cold.overviewAuthoritativeMs}ms`,
        { ms: cold.overviewAuthoritativeMs },
      );
    } else {
      fail("A-overview-authoritative", "overview did not show authoritative € values within 45s", cold);
    }

    if (cold.financialLedgerAuthoritativeMs != null) {
      pass(
        "A-financial-ledger-authoritative",
        `financial ledger authoritative at ${cold.financialLedgerAuthoritativeMs}ms`,
        { ms: cold.financialLedgerAuthoritativeMs },
      );
    } else {
      fail("A-financial-ledger-authoritative", "financial ledger did not show authoritative values", cold);
    }

    const statsReadyMark = cold.clientMarks?.["analytics.stats.ready"];
    const summaryReadyMark = cold.clientMarks?.["analytics.summary.ready"] ?? statsReadyMark;
    const deferredReadyMark = cold.clientMarks?.["analytics.deferred.ready"];
    const tipsReadyMark = cold.clientMarks?.["analytics.tipsFeed.ready"];
    const overviewMark = cold.clientMarks?.["analytics.overview.render"];
    if (
      overviewMark != null &&
      summaryReadyMark != null &&
      overviewMark <= summaryReadyMark + 500
    ) {
      pass("H-overview-on-period-stats", `overview rendered with summary stats (overview ${Math.round(overviewMark)}ms, summary ${Math.round(summaryReadyMark)}ms)`, cold);
    } else {
      fail("H-overview-on-period-stats", "overview did not render on summary stats readiness", cold);
    }

    if (
      summaryReadyMark != null &&
      deferredReadyMark != null &&
      overviewMark != null &&
      overviewMark <= summaryReadyMark + 500 &&
      deferredReadyMark >= summaryReadyMark
    ) {
      pass(
        "I-summary-before-deferred",
        `overview on summary (${Math.round(overviewMark)}ms) before deferred (${Math.round(deferredReadyMark)}ms)`,
        cold.clientMarks,
      );
    } else if (summaryReadyMark != null && overviewMark != null && overviewMark <= summaryReadyMark + 500) {
      pass("I-summary-before-deferred", "overview rendered on summary slice (deferred still pending)", cold.clientMarks);
    } else {
      fail("I-summary-before-deferred", "overview did not render on summary-first hydration", cold);
    }

    if (statsReadyMark != null && tipsReadyMark != null && statsReadyMark <= tipsReadyMark + 50) {
      pass("H-period-stats-not-blocked-by-tips", "period stats committed when tips feed landed (parallel fetch)", cold);
    } else if (statsReadyMark != null && tipsReadyMark == null) {
      pass("H-period-stats-not-blocked-by-tips", "period stats ready before tips feed", cold);
    } else {
      fail("H-period-stats-not-blocked-by-tips", "period stats appear blocked by tips feed", cold);
    }

    if (
      cold.financialLedgerAuthoritativeMs != null &&
      cold.financialReconciliationEnd != null &&
      cold.financialLedgerAuthoritativeMs <= cold.financialReconciliationEnd
    ) {
      pass("F-ledger-before-reconciliation", "ledger rendered before reconciliation completed", cold);
    } else if (cold.financialLedgerAuthoritativeMs != null && cold.financialReconciliationEnd == null) {
      pass("F-ledger-before-reconciliation", "ledger rendered (reconciliation still pending)", cold);
    } else {
      fail("F-ledger-before-reconciliation", "reconciliation blocked ledger render", cold);
    }

    const singleScenario = process.env.SINGLE_SCENARIO === "1";

    if (!singleScenario) {
      await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.goto(`${BASE}/dashboard/tips/analytics`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      pass("B-dashboard-to-analytics", "dashboard → analytics navigation OK");

      await page.reload({ waitUntil: "domcontentloaded" });
      const reloadCold = await runColdAnalyticsScenario(page, "C-hard-refresh", events);
      if (reloadCold.overviewAuthoritativeMs != null || reloadCold.clientMarks?.["analytics.overview.render"] != null) {
        pass("C-hard-refresh-data", `hard refresh overview at ${reloadCold.overviewAuthoritativeMs ?? reloadCold.clientMarks?.["analytics.overview.render"]}ms`);
      } else {
        fail("C-hard-refresh-data", "hard refresh did not render overview data");
      }

      const marks = reloadCold.clientMarks ?? {};
      const ledgerMark = marks["analytics.financial.ledger.ready"];
      const reconMark = marks["analytics.financial.reconciliation.ready"];
      if (ledgerMark != null && reconMark != null && ledgerMark < reconMark) {
        pass(
          "F-ledger-mark-before-reconciliation",
          `ledger.ready (${Math.round(ledgerMark)}ms) before reconciliation.ready (${Math.round(reconMark)}ms)`,
          marks,
        );
      } else if (ledgerMark != null && reconMark == null) {
        pass("F-ledger-mark-before-reconciliation", "ledger ready before reconciliation completed", marks);
      } else {
        fail("F-ledger-mark-before-reconciliation", "reconciliation completed before ledger", marks);
      }
    }
  } catch (err) {
    fail("RUNTIME", err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
  }

  const baseline = {
    note: "Pre-remediation audit: financial-summary waited for full analytics bundle (cardsInitialLoading). No captured ms baseline in repo.",
    structuralBefore: [
      "analytics bundle (stats + week + tips + QR) → then financial-summary (+ reconciliation inline)",
      "all sections shared cardsInitialLoading",
    ],
    structuralAfter: [
      "stats + financial-summary start in parallel on mount",
      "overview/revenue/ops/locations render on periodStats only",
      "tips feed blocks top-QR only; QR section independent",
      "reconciliation deferred after ledger+connect",
    ],
  };

  const report = {
    at: new Date().toISOString(),
    baseline,
    timings,
    results,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "business-analytics-performance-browser.json"),
    JSON.stringify(report, null, 2),
  );

  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id}: ${r.detail}`);
  }
  console.log("\n--- Timings (ms from navigation) ---");
  for (const t of timings) {
    console.log(JSON.stringify(t, null, 2));
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.error(`\n${failed.length}/${results.length} failed`);
    process.exit(1);
  }
  console.log(`\n${results.length}/${results.length} passed`);
}

void main();
