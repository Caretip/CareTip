import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Business dashboard behaviour across refreshes and partial API failure.
 *
 * Regression for a Safari tester's report: after refreshing, the dashboard showed
 * "Something went wrong. Please try again." with blank financial values. The cause was the global
 * API limiter's 429, whose body was not recognised (so it read as an unknown error) while the
 * hero stayed on its loading skeleton and "Try again" never reloaded it.
 *
 * Runs in Chromium and in Playwright WebKit (`dashboard-refresh-webkit`,
 * `dashboard-refresh-iphone-webkit`). Playwright WebKit is not Safari on an iPhone: it shares the
 * engine, not Apple's network stack or ITP behaviour.
 */

const GENERIC = /Something went wrong. Please try again./;
const RATE_LIMITED = "Too many requests. Please wait a moment and try again.";
const STATS_FAILED = "We couldn't load dashboard stats. Please try again in a moment.";
const LIMITER_BODY = { message: "Too many requests. Please slow down." };

const manager = {
  token: "e2e-test-token",
  user: {
    id: "e2e-business-1",
    email: "biz@e2e.local",
    role: "MANAGER",
    name: "Brasserie Lindenstraße",
    emailVerified: true,
    hasCompletedOnboarding: true,
    businessId: "e2e-biz-row",
  },
};

const profile = {
  id: "e2e-biz-row",
  name: "Brasserie Lindenstraße",
  logo: null,
  verificationStatus: "verified",
  subscriptionTier: "premium",
  hasActiveSubscription: true,
  accessSource: "subscription",
  subscriptionStatus: "active",
};

const stats = {
  totalTips: 128.5,
  tipCount: 14,
  employeeCount: 5,
  dailyTipDistribution: [],
  employeeGoals: [],
  employees: [],
};

const ledgerMetrics = {
  totalCustomerTipsEur: 1280.5,
  tipCount: 90,
  employeeDistributionObligationEur: 37.25,
  employeeDistributionObligationRowCount: 3,
  directToEmployeeGrossTipsEur: 1280.5,
  businessDistributionGrossTipsEur: 0,
  caretipFeesEur: null,
  feesExact: false,
};
const zeroLedgerMetrics = {
  ...ledgerMetrics,
  totalCustomerTipsEur: 0,
  tipCount: 0,
  employeeDistributionObligationEur: 0,
  employeeDistributionObligationRowCount: 0,
  directToEmployeeGrossTipsEur: 0,
};
const routing = {
  mode: "direct_to_employee",
  heldPlatformCents: 0,
  heldPlatformRowCount: 0,
  heldBusinessCents: 0,
  heldBusinessRowCount: 0,
};

/** Mirrors the API: a section response zero-fills the slice it was not asked for. */
function financialSection(section: string | null, period: string) {
  const ledger = section !== "connect";
  const connect = section !== "ledger";
  return {
    period,
    periodBasis: "tip_created_at",
    lifetime: ledger ? ledgerMetrics : zeroLedgerMetrics,
    periodMetrics: ledger ? ledgerMetrics : zeroLedgerMetrics,
    routing,
    stripe: connect
      ? { readable: true, connected: true, availableCents: 45_000, pendingCents: 2_500, currency: "eur" }
      : { readable: false, connected: true, availableCents: null, pendingCents: null, currency: null },
    payouts: {
      completedAmountCents: connect ? 90_000 : 0,
      pendingAmountCents: 0,
      currency: "eur",
      mixedCurrency: false,
    },
  };
}

type Failure = { status: number; body: unknown };

type MockApi = {
  /** Key: request key from {@link requestKey}. Absent means the request succeeds. */
  failures: Map<string, Failure | "network">;
  /** When set, every Bearer call fails this way, as the limiter's user bucket does. */
  failAllAuthenticated: Failure | null;
  refreshStatus: number;
  calls: Map<string, number>;
  /** Exceptions the route error boundary caught; any entry means the page crashed. */
  crashes: string[];
  /** Stats scopes requested, in order. */
  statsScopes: string[];
  /** Bodies of POST /setup/evaluate. */
  evaluateItems: Array<{ kind: string; conditionActive: boolean; conditionVersion: string }>;
  /** When set, scope=analytics fails while KPI scopes succeed. */
  statsWithFailedAnalytics: Failure | null;
  /** When set, /connect/status answers this after a delay, as a slow network would. */
  connectStatus: { status: string } | null;
};

function requestKey(url: URL): string {
  if (url.pathname === "/api/business/me/stats") return "stats";
  if (url.pathname === "/api/me/connect/financial-summary") {
    return `financial:${url.searchParams.get("section") ?? "bundle"}`;
  }
  return url.pathname;
}

async function installMockApi(page: Page, opts?: { signedIn?: boolean }): Promise<MockApi> {
  const api: MockApi = {
    failures: new Map(),
    failAllAuthenticated: null,
    refreshStatus: 200,
    calls: new Map(),
    crashes: [],
    statsScopes: [],
    evaluateItems: [],
    connectStatus: null,
    statsWithFailedAnalytics: null,
  };
  // WebKit rejects in-flight dynamic imports when reload() replaces the page. That error belongs to
  // a document that is already going away and no one sees it, so it is not a crash. Anything else
  // reaching the boundary, or that error on a page that stays, fails the test.
  let lastChunkErrorAt = 0;
  let lastChunkError = "";
  page.on("console", (message) => {
    if (message.type() !== "error" || !message.text().includes("RouteErrorBoundary")) return;
    if (message.text().includes("Importing a module script failed")) {
      lastChunkErrorAt = Date.now();
      lastChunkError = message.text();
      return;
    }
    api.crashes.push(message.text());
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) lastChunkErrorAt = 0;
  });
  chunkErrorOnLivePage.set(page, () => (lastChunkErrorAt ? lastChunkError : null));
  mockApis.set(page, api);

  await page.addInitScript((signedIn) => {
    try {
      localStorage.setItem("caretip_i18n_language", "en");
      if (signedIn) {
        sessionStorage.setItem("caretip_session_hint", "1");
        // A returning user has already answered the cookie dialog.
        localStorage.setItem(
          "caretip_cookie_consent",
          JSON.stringify({
            essential: true,
            analytics: false,
            functional: false,
            marketing: false,
            consentDate: "2026-01-01T00:00:00.000Z",
            consentVersion: 1,
          }),
        );
      }
    } catch {
      /* ignore */
    }
  }, opts?.signedIn !== false);

  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const url = new URL(route.request().url());
      const key = requestKey(url);
      api.calls.set(key, (api.calls.get(key) ?? 0) + 1);
      if (key === "stats") api.statsScopes.push(url.searchParams.get("scope") ?? "");
      if (url.pathname === "/api/me/notifications/setup/evaluate") {
        const body = route.request().postDataJSON() as { items: MockApi["evaluateItems"] };
        api.evaluateItems.push(...body.items);
      }

      if (url.pathname === "/api/auth/refresh") {
        if (api.refreshStatus !== 200) {
          return json(route, api.refreshStatus, { message: "Invalid or expired token" });
        }
        return json(route, 200, manager);
      }
      if (url.pathname === "/api/auth/signin") return json(route, 200, manager);

      if (api.failAllAuthenticated) {
        return json(route, api.failAllAuthenticated.status, api.failAllAuthenticated.body);
      }
      const failure = api.failures.get(key);
      if (failure === "network") return route.abort("failed");
      if (failure) return json(route, failure.status, failure.body);

      if (key === "stats") {
        if (api.statsWithFailedAnalytics && url.searchParams.get("scope") === "analytics") {
          return json(route, api.statsWithFailedAnalytics.status, api.statsWithFailedAnalytics.body);
        }
        return json(route, 200, stats);
      }
      if (key.startsWith("financial:")) {
        return json(
          route,
          200,
          financialSection(url.searchParams.get("section"), url.searchParams.get("period") ?? "all"),
        );
      }
      if (url.pathname === "/api/business/profile") return json(route, 200, profile);
      if (url.pathname === "/api/me/connect/status" && api.connectStatus) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return json(route, 200, api.connectStatus);
      }
      if (url.pathname === "/api/me/connect/employee-tip-payout-mode") {
        return json(route, 200, { mode: "direct_to_employee" });
      }
      if (url.pathname === "/api/me/notifications/setup/evaluate") {
        return json(route, 200, { results: [] });
      }
      if (url.pathname === "/api/feedback/business") {
        return json(route, 200, { items: [], summary: { averageRating: null, totalCount: 0 } });
      }
      if (url.pathname === "/api/locations" || url.pathname === "/api/tables") {
        return json(route, 200, []);
      }
      return json(route, 200, {});
    },
  );
  return api;
}

const mockApis = new WeakMap<Page, MockApi>();
const chunkErrorOnLivePage = new WeakMap<Page, () => string | null>();

const hero = (page: Page) => page.locator(".dashboard-hero-financial-panel").first();
const heroMetric = (page: Page, label: string) =>
  hero(page).locator("div, li, dd, p").filter({ hasText: label }).first();

async function openDashboard(page: Page): Promise<void> {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".business-dashboard-overview")).toBeVisible();
}

async function expectHealthyDashboard(page: Page): Promise<void> {
  await expect(page.locator(".business-hero-badge").first()).toContainText("Brasserie Lindenstraße");
  await expect(hero(page)).toContainText("€1.280,50");
  await expect(hero(page)).toContainText("€450,00");
  await expect(page.getByText(GENERIC)).toHaveCount(0);
  await expect(page.getByText(STATS_FAILED)).toHaveCount(0);
}

/** WebKit can report a superseded load as this error; the assertions after it still apply. */
async function reloadTolerantOfWebKitInterrupt(page: Page): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" }).catch((error: Error) => {
    if (!error.message.includes("Frame load interrupted")) throw error;
  });
}

async function signOut(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Sign out" }).first();
  if (!(await button.isVisible().catch(() => false))) {
    await page.locator("header button").first().click();
  }
  await page.getByRole("button", { name: "Sign out" }).locator("visible=true").first().click();
}

function totalCalls(api: MockApi, prefix: string): number {
  let n = 0;
  for (const [key, count] of api.calls) if (key.startsWith(prefix)) n += count;
  return n;
}

test.describe("Business dashboard refresh resilience", () => {
  // The PWA service worker would otherwise carry post-reload requests past page.route in WebKit.
  test.use({ serviceWorkers: "block" });

  test.describe.configure({ timeout: 60_000 });

  test.afterEach(async ({ page }) => {
    expect(mockApis.get(page)?.crashes ?? []).toEqual([]);
    expect(chunkErrorOnLivePage.get(page)?.() ?? null).toBeNull();
    await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
  });

  test("fresh login loads the dashboard", async ({ page }) => {
    const api = await installMockApi(page, { signedIn: false });
    api.refreshStatus = 401;
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Reject non-essential" }).click();
    await page.locator('input[type="email"]:visible').first().fill("biz@e2e.local");
    await page.locator('input[type="password"]:visible').first().fill("Password1!");
    await page.locator('button[type="submit"]:visible').first().click();
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
    api.refreshStatus = 200;
    await expect(page.locator(".business-dashboard-overview")).toBeVisible();
    await expectHealthyDashboard(page);
  });

  test("refresh and repeated refreshes keep a consistent dashboard", async ({ page }) => {
    await installMockApi(page);
    await openDashboard(page);
    await expectHealthyDashboard(page);
    for (let i = 0; i < 3; i++) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(".business-dashboard-overview")).toBeVisible();
      await expectHealthyDashboard(page);
    }
  });

  test("a refresh never waits for the bootstrap watchdog", async ({ page }) => {
    // The refresh response can land between React's render and its store subscription. That update
    // used to be lost, holding the loading screen until the 12s watchdog; the delay between reloads
    // matches the timing that exposed it in WebKit.
    await installMockApi(page);
    await openDashboard(page);
    for (let i = 0; i < 8; i++) {
      await expect(hero(page)).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1_500);
      await reloadTolerantOfWebKitInterrupt(page);
    }
    await expect(hero(page)).toBeVisible({ timeout: 10_000 });
  });

  test("signing out in one tab signs out the others", async ({ page, context }) => {
    await installMockApi(page);
    const other = await context.newPage();
    await installMockApi(other);
    await openDashboard(page);
    await openDashboard(other);
    await expect(hero(other)).toBeVisible();

    await signOut(page);
    await page.waitForURL(/\/login/);
    await other.waitForURL(/\/login/, { timeout: 5_000 });
    await expect(other.locator(".business-dashboard-overview")).toHaveCount(0);
  });

  test("confirmed expiry in one tab reaches the others", async ({ page, context }) => {
    const first = await installMockApi(page);
    const other = await context.newPage();
    const second = await installMockApi(other);
    await openDashboard(page);
    await openDashboard(other);
    await expect(hero(other)).toBeVisible();

    first.refreshStatus = 401;
    second.refreshStatus = 401;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await other.waitForURL(/\/login/, { timeout: 8_000 });
  });

  test("a temporary refresh failure signs nobody out", async ({ page, context }) => {
    const first = await installMockApi(page);
    const other = await context.newPage();
    await installMockApi(other);
    await openDashboard(page);
    await openDashboard(other);
    await expect(hero(other)).toBeVisible();

    first.refreshStatus = 503;
    await page.reload({ waitUntil: "domcontentloaded" });
    await other.waitForTimeout(3_000);
    expect(new URL(page.url()).pathname).toBe("/dashboard");
    await expect(hero(other)).toBeVisible();

    first.refreshStatus = 200;
    await expect(hero(page)).toBeVisible({ timeout: 25_000 });
  });

  test("a tab that cannot confirm another tab's expiry stays signed in", async ({ page, context }) => {
    const first = await installMockApi(page);
    const other = await context.newPage();
    const second = await installMockApi(other);
    await openDashboard(page);
    await openDashboard(other);
    await expect(hero(other)).toBeVisible();

    // Mid-session refusal in the first tab; the second tab's own check fails as a server error.
    first.failAllAuthenticated = { status: 401, body: { message: "Authentication required" } };
    first.refreshStatus = 401;
    second.refreshStatus = 503;
    await page.getByRole("button", { name: "Month" }).first().click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await other.waitForTimeout(3_000);
    await expect(hero(other)).toBeVisible();
    expect(new URL(other.url()).pathname).toBe("/dashboard");
  });

  test("a financial summary with missing sections shows unavailable, never a crash or zeros", async ({ page }) => {
    await installMockApi(page);
    await page.route("**/api/me/connect/financial-summary**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ period: "all" }) }),
    );
    await openDashboard(page);
    await expect(page.locator(".business-hero-badge").first()).toContainText("Brasserie");
    await expect(hero(page)).toContainText("Unavailable");
    await expect(hero(page)).not.toContainText("€0,00");
    await expect(page.getByRole("heading", { name: /couldn.t load/i })).toHaveCount(0);
  });

  test("a feedback reply without items leaves the dashboard working", async ({ page }) => {
    await installMockApi(page);
    await page.route("**/api/feedback/business**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
    );
    await openDashboard(page);
    await expect(hero(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: /couldn.t load/i })).toHaveCount(0);
  });

  test("a failed optional chunk during reload recovery does not crash the page", async ({ page }) => {
    await installMockApi(page);
    await page.addInitScript(() => {
      // Inside the recovery cooldown, where a cancelled preload used to resolve to undefined.
      sessionStorage.setItem("caretip-chunk-recovery-at", String(Date.now()));
    });
    await page.route("**/assets/PwaInstallPrompt*", (route) => route.abort("failed"));
    await openDashboard(page);
    await expectHealthyDashboard(page);
  });

  test("expired session goes to sign-in instead of a dashboard error", async ({ page }) => {
    const api = await installMockApi(page);
    await openDashboard(page);
    await expectHealthyDashboard(page);
    api.refreshStatus = 401;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByText(GENERIC)).toHaveCount(0);
  });

  test("rate limiting is named, not generic, and does not retry on its own", async ({ page }) => {
    const api = await installMockApi(page);
    api.failAllAuthenticated = { status: 429, body: LIMITER_BODY };
    await openDashboard(page);

    await expect(page.getByText(RATE_LIMITED).first()).toBeVisible();
    await expect(page.getByText(GENERIC)).toHaveCount(0);
    await expect(page.locator(".business-hero-badge").first()).toContainText("Brasserie Lindenstraße");

    // A failed load must settle: no perpetual skeleton, no invented amounts.
    await expect(hero(page)).toContainText("Unavailable");
    await expect(hero(page)).not.toHaveAttribute("aria-busy", "true");
    await expect(hero(page)).not.toContainText("€0,00");

    const statsCalls = totalCalls(api, "stats");
    const financialCalls = totalCalls(api, "financial:");
    await page.waitForTimeout(4_000);
    expect(totalCalls(api, "stats")).toBe(statsCalls);
    expect(totalCalls(api, "financial:")).toBe(financialCalls);
  });

  test("Try again recovers stats and financial summary after an outage", async ({ page }) => {
    const api = await installMockApi(page);
    api.failAllAuthenticated = { status: 429, body: LIMITER_BODY };
    await openDashboard(page);
    const retry = page.getByRole("button", { name: "Try again" }).first();
    await expect(retry).toBeVisible();

    api.failAllAuthenticated = null;
    await retry.click();
    await expectHealthyDashboard(page);
    await expect(page.getByText(RATE_LIMITED)).toHaveCount(0);
  });

  test("temporary backend unavailability shows its own message and recovers", async ({ page }) => {
    const api = await installMockApi(page);
    const down = { status: 503, body: { message: "Service temporarily unavailable" } };
    api.failures.set("stats", down);
    api.failures.set("financial:ledger", down);
    api.failures.set("financial:connect", down);
    await openDashboard(page);
    // The 503 wire text stays internal; users see the friendly copy (English, or German in a DE browser).
    await expect(
      page
        .getByText(
          /We're temporarily unable to complete your request|Ihre Anfrage kann gerade vorübergehend nicht bearbeitet werden/,
        )
        .first(),
    ).toBeVisible();

    api.failures.clear();
    await page.getByRole("button", { name: "Try again" }).first().click();
    await expectHealthyDashboard(page);
  });

  test("a stats failure leaves the financial summary intact", async ({ page }) => {
    const api = await installMockApi(page);
    api.failures.set("stats", {
      status: 500,
      body: { success: false, code: "STATS_FETCH_ERROR", message: STATS_FAILED },
    });
    await openDashboard(page);
    await expect(page.getByText(STATS_FAILED).first()).toBeVisible();
    await expect(hero(page)).toContainText("€1.280,50");
    await expect(hero(page)).toContainText("€450,00");
  });

  test("a financial failure leaves stats intact and can be retried from the hero", async ({ page }) => {
    const api = await installMockApi(page);
    const down = { status: 400, body: { message: "We couldn't load that data right now." } };
    api.failures.set("financial:ledger", down);
    api.failures.set("financial:connect", down);
    await openDashboard(page);

    await expect(hero(page)).toContainText("Unavailable");
    await expect(page.getByText(STATS_FAILED)).toHaveCount(0);
    await expect(page.getByText(GENERIC)).toHaveCount(0);
    await expect(page.locator("#business-overview-period")).toContainText("128");

    api.failures.clear();
    await hero(page).locator("xpath=..").getByRole("button", { name: "Try again" }).click();
    await expectHealthyDashboard(page);
  });

  test("failed ledger never shows the zeros from the connect response", async ({ page }) => {
    const api = await installMockApi(page);
    api.failures.set("financial:ledger", { status: 429, body: LIMITER_BODY });
    await openDashboard(page);

    await expect(hero(page)).toContainText("€450,00");
    await expect(heroMetric(page, "Total tips")).toContainText("Unavailable");
    await expect(heroMetric(page, "Total tips")).not.toContainText("€0,00");
  });

  test("failed connect slice is unavailable, not a false Connect Stripe prompt", async ({ page }) => {
    const api = await installMockApi(page);
    api.failures.set("financial:connect", { status: 429, body: LIMITER_BODY });
    await openDashboard(page);

    await expect(hero(page)).toContainText("€1.280,50");
    await expect(hero(page)).toContainText("Unavailable");
    await expect(hero(page)).not.toContainText("Connect Stripe");
    await expect(hero(page)).not.toContainText("€0,00");
  });

  test("failed analytics are unavailable, not empty or loading for ever", async ({ page }) => {
    const api = await installMockApi(page);
    api.statsWithFailedAnalytics = { status: 500, body: { success: false, code: "STATS_FETCH_ERROR", message: STATS_FAILED } };
    await openDashboard(page);

    await expect(page.getByText(STATS_FAILED).first()).toBeVisible();
    await expect(page.locator("#business-overview-period")).toContainText("128");
    await expect(page.getByText("No staff have set a tip goal yet.")).toHaveCount(0);
    await expect(page.locator(".business-dashboard-overview").getByText("Unavailable").first()).toBeVisible();

    api.statsWithFailedAnalytics = null;
    await page.getByRole("button", { name: "Try again" }).first().click();
    await expect(page.getByText(STATS_FAILED)).toHaveCount(0);
  });

  test("network failure reads as a connection problem", async ({ page }) => {
    const api = await installMockApi(page);
    api.failures.set("stats", "network");
    await openDashboard(page);
    await expect(page.getByText(/We couldn't connect right now|Wir konnten gerade keine Verbindung herstellen/).first()).toBeVisible();
    await expect(page.getByText(GENERIC)).toHaveCount(0);
  });

  test("a refresh does not repeat stats or warm unrelated pages", async ({ page }) => {
    const api = await installMockApi(page);
    api.connectStatus = { status: "ready" };
    await openDashboard(page);
    await expectHealthyDashboard(page);
    await page.waitForTimeout(3_500);

    api.calls.clear();
    api.statsScopes.length = 0;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectHealthyDashboard(page);
    await page.waitForTimeout(3_500);

    expect(api.statsScopes).not.toContain("summary");
    expect(api.statsScopes.filter((scope) => scope === "aboveFold")).toHaveLength(1);
    expect(api.calls.get("/api/locations") ?? 0).toBe(0);
    expect(api.calls.get("/api/tables") ?? 0).toBe(0);
    expect(api.calls.get("/api/me/connect/employee-tip-payout-mode") ?? 0).toBe(0);
    expect(api.calls.get("financial:ledger")).toBe(1);
    expect(api.calls.get("financial:connect")).toBe(1);
  });

  test("setup prompts are only evaluated on known inputs", async ({ page }) => {
    const api = await installMockApi(page);
    api.connectStatus = { status: "pending" };
    await openDashboard(page);
    await expect
      .poll(() => api.evaluateItems.filter((item) => item.kind === "stripe_connect").length)
      .toBeGreaterThan(0);
    await page.waitForTimeout(1_500);

    // Reporting "not active" resolves the prompt on the server and so clears a user's dismissal.
    const versions = api.evaluateItems.map((item) => item.conditionVersion);
    expect(versions).not.toContain("not_ready:unknown");
    expect(versions).not.toContain("pending:unknown");
    expect(versions).toContain("pending:direct_to_employee");
    expect(
      api.evaluateItems.filter((item) => item.conditionVersion === "pending:direct_to_employee"),
    ).toEqual([expect.objectContaining({ conditionActive: true })]);
  });

  test("analytics page settles on failed Connect data and recovers on retry", async ({ page }) => {
    const api = await installMockApi(page);
    api.failures.set("financial:connect", { status: 429, body: LIMITER_BODY });
    await page.goto("/dashboard/tips/analytics", { waitUntil: "domcontentloaded" });

    const stripe = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Stripe account" }),
    });
    await expect(stripe).toBeVisible();
    await expect(stripe.getByText("Unavailable")).toHaveCount(3);
    await expect(stripe).not.toContainText("€0,00");
    await expect(stripe.locator("[class*='skeleton' i], [aria-busy='true']")).toHaveCount(0);

    api.failures.clear();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(stripe).toContainText("€450,00");
    await expect(stripe).toContainText("€25,00");
    await expect(stripe.getByText("Unavailable")).toHaveCount(0);
  });

  test("navigating away and back reloads a failed dashboard", async ({ page }) => {
    const api = await installMockApi(page);
    api.failAllAuthenticated = { status: 429, body: LIMITER_BODY };
    await openDashboard(page);
    await expect(page.getByText(RATE_LIMITED).first()).toBeVisible();

    api.failAllAuthenticated = null;
    await page.evaluate(() => {
      window.history.pushState({}, "", "/dashboard/tips");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.locator(".business-dashboard-overview")).toHaveCount(0);
    await page.goBack();
    await expect(page.locator(".business-dashboard-overview")).toBeVisible();
    await expectHealthyDashboard(page);
  });
});
