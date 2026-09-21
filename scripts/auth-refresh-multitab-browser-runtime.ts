/**
 * Real-browser multi-tab refresh validation against live backend (no refresh mock).
 * Run: npm run test:auth-refresh-multitab-browser
 *
 * Requires: Vite dev server + backend running, system Chrome for Playwright.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const EMAIL = process.env.FORENSIC_LOGIN_EMAIL ?? "demo@caretip.de";
const PASSWORD = process.env.FORENSIC_LOGIN_PASSWORD ?? "Demo1234!";
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "test-results");

type RefreshEvent = {
  ms: number;
  tab: string;
  kind: "refresh-request" | "refresh-response";
  status?: number;
};

type TabOutcome = {
  tab: string;
  finalUrl: string;
  hasCaretipUser: boolean;
  loginRedirect: boolean;
  refreshResponses: number;
};

function attachRefreshTap(page: Page, tabId: string, sink: RefreshEvent[], t0: number): void {
  page.on("request", (req) => {
    if (!req.url().includes("/api/auth/refresh")) return;
    sink.push({ ms: Date.now() - t0, tab: tabId, kind: "refresh-request" });
  });
  page.on("response", (res) => {
    if (!res.url().includes("/api/auth/refresh")) return;
    sink.push({ ms: Date.now() - t0, tab: tabId, kind: "refresh-response", status: res.status() });
  });
}

async function loginViaRealApi(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 90_000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await page.waitForTimeout(2_000 * attempt);
    const outcome = await page.evaluate(
      async ({ email, password }) => {
        const res = await fetch("/api/auth/signin", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CareTip-Client": "1" },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) return { ok: false as const, status: res.status };
        sessionStorage.setItem("caretip_session_hint", "1");
        return { ok: true as const, status: res.status };
      },
      { email: EMAIL, password: PASSWORD },
    );
    if (outcome.ok) return;
    if (outcome.status !== 429) {
      throw new Error(`signin failed: HTTP ${outcome.status}`);
    }
  }
  throw new Error("signin failed: HTTP 429 after retries");
}

async function waitForRefreshResponse(page: Page, tab: string, events: RefreshEvent[], timeoutMs = 45_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (events.some((e) => e.tab === tab && e.kind === "refresh-response")) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`tab ${tab}: timed out waiting for /api/auth/refresh response`);
}

async function waitForTabRefreshSettled(tab: string, events: RefreshEvent[], timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const requests = events.filter((e) => e.tab === tab && e.kind === "refresh-request").length;
    const responses = events.filter((e) => e.tab === tab && e.kind === "refresh-response");
    const last = responses[responses.length - 1];
    if (responses.length >= requests && requests > 0 && last?.status === 200) return;
    if (responses.length >= requests && requests > 0 && last?.status === 401) {
      // Peer rotation retry may enqueue another request — keep waiting.
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`tab ${tab}: refresh sequence did not settle with HTTP 200`);
}

async function waitForTabAuthenticated(page: Page, tab: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem("caretip_user");
        const hasUser = Boolean(raw && JSON.parse(raw)?.email);
        return { hasUser, onLogin: location.pathname.includes("/login") };
      } catch {
        return { hasUser: false, onLogin: location.pathname.includes("/login") };
      }
    });
    if (state.hasUser && !state.onLogin) return;
    await page.waitForTimeout(400);
  }
  throw new Error(`tab ${tab}: timed out waiting for authenticated dashboard settle`);
}

async function readTabOutcome(page: Page, tab: string, events: RefreshEvent[]): Promise<TabOutcome> {
  const finalUrl = page.url();
  const hasCaretipUser = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem("caretip_user");
      return Boolean(raw && JSON.parse(raw)?.email);
    } catch {
      return false;
    }
  });
  const refreshResponses = events.filter((e) => e.tab === tab && e.kind === "refresh-response").length;
  return {
    tab,
    finalUrl,
    hasCaretipUser,
    loginRedirect: /\/login/.test(finalUrl),
    refreshResponses,
  };
}

function analyzeConcurrency(events: RefreshEvent[]): { maxOverlap: number; serialized: boolean } {
  const requests = events.filter((e) => e.kind === "refresh-request");
  let maxOverlap = 0;
  for (let i = 0; i < requests.length; i += 1) {
    const a = requests[i];
    const aEnd = events.find((e) => e.kind === "refresh-response" && e.tab === a.tab && e.ms >= a.ms);
    const aEndMs = aEnd?.ms ?? a.ms + 30_000;
    let overlap = 0;
    for (let j = 0; j < requests.length; j += 1) {
      if (i === j) continue;
      const b = requests[j];
      const bEnd = events.find((e) => e.kind === "refresh-response" && e.tab === b.tab && e.ms >= b.ms);
      const bEndMs = bEnd?.ms ?? b.ms + 30_000;
      if (b.ms < aEndMs && a.ms < bEndMs) overlap += 1;
    }
    maxOverlap = Math.max(maxOverlap, overlap);
  }
  return { maxOverlap, serialized: maxOverlap === 0 };
}

async function createAuthenticatedStorageState(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginViaRealApi(page);
  const storageState = await ctx.storageState();
  await ctx.close();
  return storageState;
}

async function runSimultaneousDashboardBoot(
  browser: Browser,
  tabLabels: string[],
  storageState: Awaited<ReturnType<typeof createAuthenticatedStorageState>>,
): Promise<{ events: RefreshEvent[]; outcomes: TabOutcome[] }> {
  const ctx: BrowserContext = await browser.newContext({ storageState });
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("caretip_session_hint", "1");
    } catch {
      // ignore
    }
  });
  const events: RefreshEvent[] = [];
  const t0 = Date.now();
  const pages: Page[] = [];

  for (const label of tabLabels) {
    const page = await ctx.newPage();
    attachRefreshTap(page, label, events, t0);
    pages.push(page);
  }

  await Promise.all(
    pages.map((page) =>
      page.goto(`${BASE}/dashboard`, { waitUntil: "commit", timeout: 90_000 }),
    ),
  );
  await Promise.all(
    pages.map((page, i) => waitForRefreshResponse(page, tabLabels[i], events).catch(() => undefined)),
  );
  await Promise.all(tabLabels.map((label) => waitForTabRefreshSettled(label, events)));
  await Promise.all(pages.map((page, i) => waitForTabAuthenticated(page, tabLabels[i])));

  const outcomes: TabOutcome[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    outcomes.push(await readTabOutcome(pages[i], tabLabels[i], events));
  }

  await ctx.close();
  return { events, outcomes };
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const launchOpts: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    ...(process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === "true" ? { channel: "chrome" as const } : {}),
  };

  const browser = await chromium.launch(launchOpts);
  const report: Record<string, unknown> = { base: BASE, at: new Date().toISOString() };

  try {
    const storageState = await createAuthenticatedStorageState(browser);
    report.signin = "ok";

    const twoTab = await runSimultaneousDashboardBoot(browser, ["A", "B"], storageState);
    const twoAnalysis = analyzeConcurrency(twoTab.events);
    report.twoTab = { ...twoTab, analysis: twoAnalysis };

    await new Promise((r) => setTimeout(r, 2_000));

    const threeTab = await runSimultaneousDashboardBoot(browser, ["A", "B", "C"], storageState);
    const threeAnalysis = analyzeConcurrency(threeTab.events);
    report.threeTab = { ...threeTab, analysis: threeAnalysis };

    const failures: string[] = [];

    if (!twoAnalysis.serialized) failures.push("two-tab: concurrent refresh detected");
    if (twoTab.outcomes.some((o) => o.loginRedirect)) failures.push("two-tab: unexpected /login redirect");
    if (twoTab.outcomes.some((o) => !o.hasCaretipUser)) failures.push("two-tab: missing caretip_user");
    if (twoTab.outcomes.some((o) => o.refreshResponses === 0)) failures.push("two-tab: no refresh response observed");

    if (!threeAnalysis.serialized) failures.push("three-tab: concurrent refresh detected");
    if (threeTab.outcomes.some((o) => o.loginRedirect)) failures.push("three-tab: unexpected /login redirect");
    if (threeTab.outcomes.some((o) => !o.hasCaretipUser)) failures.push("three-tab: missing caretip_user");
    if (threeTab.outcomes.some((o) => o.refreshResponses === 0)) failures.push("three-tab: no refresh response observed");

    report.pass = failures.length === 0;
    report.failures = failures;

    const outPath = path.join(OUT_DIR, "auth-refresh-multitab-browser.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`Wrote ${outPath}`);
    console.log(JSON.stringify(report, null, 2));

    if (failures.length > 0) {
      console.error("auth-refresh-multitab-browser-runtime: FAILED");
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }
    console.log("auth-refresh-multitab-browser-runtime: ok");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
