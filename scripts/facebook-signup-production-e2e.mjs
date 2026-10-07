/**
 * Production Facebook signup forensic probe (no secrets logged).
 * Run: node scripts/facebook-signup-production-e2e.mjs
 * Optional: FB_E2E_MATRIX=clean|existing  (default runs clean only)
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = "https://caretip.de/signup";
const OUT = "test-results/facebook-signup-production-e2e.json";

function stageFromConsoleArg(arg) {
  if (arg && typeof arg === "object" && !Array.isArray(arg)) {
    return arg;
  }
  if (typeof arg === "string") {
    const jsonStart = arg.indexOf("{");
    if (jsonStart >= 0) {
      try {
        return JSON.parse(arg.slice(jsonStart));
      } catch {
        return { raw: arg.slice(0, 200) };
      }
    }
  }
  return null;
}

async function runScenario(name, contextOptions) {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--disable-popup-blocking"],
  });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const consoleLines = [];
  const facebookDiagEvents = [];
  const network = [];

  page.on("console", (msg) => {
    const t = msg.text();
    consoleLines.push({ type: msg.type(), text: t });
    if (!t.includes("CareTip:oauth:facebook") && !msg.text().includes("oauth:facebook")) {
      for (const arg of msg.args()) {
        void arg.jsonValue().then((v) => {
          if (v && typeof v === "object" && (v.stage || v.correlationId)) {
            facebookDiagEvents.push(v);
          }
        });
      }
    }
    const parts = msg.text();
    if (parts.includes("[CareTip:oauth:facebook]")) {
      for (const arg of msg.args()) {
        void arg.jsonValue().then((v) => {
          const ev = stageFromConsoleArg(v);
          if (ev) facebookDiagEvents.push(ev);
        });
      }
    }
  });
  page.on("request", (req) => {
    const url = req.url();
    if (
      url.includes("connect.facebook.net") ||
      url.includes("facebook.com") ||
      url.includes("/api/auth/oauth")
    ) {
      network.push({ phase: "request", method: req.method(), url: url.split("?")[0] });
    }
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/auth/oauth")) {
      let bodySnippet = "";
      try {
        const txt = await res.text();
        bodySnippet = txt.slice(0, 300);
      } catch {
        bodySnippet = "";
      }
      network.push({
        phase: "response",
        status: res.status(),
        url: url.split("?")[0],
        bodySnippet,
      });
    }
  });

  const popupPromise = page.waitForEvent("popup", { timeout: 25_000 }).catch(() => null);

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(3000);

  const legal = page.locator("#merchant-legal-acceptance");
  if (await legal.isVisible().catch(() => false)) {
    await legal.check({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const fbBtn = page
    .locator('button.caretip-oauth-circle--facebook, [aria-label*="Facebook"]')
    .first();
  const fbVisible = await fbBtn.isVisible().catch(() => false);
  let clicked = false;
  if (fbVisible) {
    await fbBtn.click({ timeout: 10_000 }).catch(() => {});
    clicked = true;
  }

  const popup = await popupPromise;
  let popupUrl = null;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    popupUrl = popup.url();
  }

  await page.waitForTimeout(75_000);

  const fbEvents = facebookDiagEvents;
  const correlationIds = [...new Set(fbEvents.map((e) => e.correlationId).filter(Boolean))];

  const result = {
    scenario: name,
    finalUrl: page.url(),
    fbButtonVisible: fbVisible,
    fbClicked: clicked,
    popupOpened: Boolean(popup),
    popupUrlHost: popupUrl ? new URL(popupUrl).hostname : null,
    oauthApiCalls: network.filter((n) => n.url?.includes("/api/auth/oauth")),
    facebookNetworkHosts: [
      ...new Set(
        network
          .filter((n) => n.url?.includes("facebook") || n.url?.includes("connect.facebook"))
          .map((n) => n.url),
      ),
    ],
    correlationIds,
    correlationIdContinuity: (() => {
      const click = fbEvents.find((e) => e.stage === "oauth_facebook_button_click");
      const invoke = fbEvents.find((e) => e.stage === "sdk_login_invoke");
      const id = click?.correlationId;
      if (!id) return { ok: false, reason: "missing_click_correlation" };
      const sameIdStages = fbEvents.filter((e) => e.correlationId === id).map((e) => e.stage);
      return {
        ok: Boolean(click?.correlationId && invoke?.correlationId === id),
        clickCorrelationId: id,
        invokeCorrelationId: invoke?.correlationId ?? null,
        stagesForAttempt: sameIdStages,
      };
    })(),
    facebookDiagStages: fbEvents.map((e) => ({
      stage: e.stage,
      correlationId: e.correlationId,
      status: e.status,
      outcome: e.outcome,
      hasAuthResponse: e.hasAuthResponse,
      hasAccessToken: e.hasAccessToken,
      failureKind: e.failureKind,
      recoverySucceeded: e.recoverySucceeded,
      tokenSource: e.tokenSource,
      msSinceUserClick: e.msSinceUserClick,
      attemptLifecycle: e.attemptLifecycle,
      popupObserved: e.popupObserved,
    })),
    providerAccountsEmpty: consoleLines.some((c) =>
      /Provider's accounts list is empty/i.test(c.text),
    ),
    signupDidNotCompleteUi: consoleLines.some((c) => /Signup did not complete/i.test(c.text)),
    pageErrors: consoleLines.filter((c) => c.type === "error").map((c) => c.text.slice(0, 300)),
  };

  await browser.close();
  return result;
}

const matrix = process.env.FB_E2E_MATRIX?.split(",") ?? ["clean"];
const results = [];

for (const mode of matrix) {
  if (mode === "clean") {
    results.push(
      await runScenario("TEST_A_clean_incognito", {
        viewport: { width: 1400, height: 900 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      }),
    );
  }
  if (mode === "existing") {
    results.push(
      await runScenario("TEST_B_existing_profile", {
        viewport: { width: 1280, height: 900 },
      }),
    );
  }
}

fs.mkdirSync("test-results", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
console.log(`Wrote ${OUT}`);
for (const r of results) {
  console.log(`\n=== ${r.scenario} ===`);
  console.log(JSON.stringify(r, null, 2));
}
