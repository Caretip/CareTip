/**
 * Runtime capture of the real Sign In → Dashboard handoff path.
 * Mocks /api/auth/signin so we exercise AuthPage handoff without real credentials.
 * Writes POST_LOGIN_RUNTIME_TRACE.json — not a product fix.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const AUTH_USER = {
  id: "trace-business-1",
  email: "trace-biz@e2e.local",
  role: "MANAGER",
  name: "Trace Business",
  emailVerified: true,
  hasCompletedOnboarding: true,
  businessId: "trace-biz-row",
  businessVerificationStatus: "verified",
};

function json(data: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(data) };
}

test.describe("Post-login runtime trace", () => {
  test("Capture Sign In handoff timeline", async ({ page }) => {
    const consoleLines: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[PostLoginTrace]") || text.includes("[AuthHandoff]")) {
        consoleLines.push(text);
      }
    });

    await page.route("**/api/auth/signin", async (route) => {
      await new Promise((r) => setTimeout(r, 120));
      return route.fulfill(
        json({
          token: "trace-e2e-token",
          user: AUTH_USER,
        }),
      );
    });

    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/auth/signin")) return route.fallback();
      if (url.includes("/api/auth/refresh") || url.includes("/api/auth/me")) {
        return route.fulfill(json({ token: "trace-e2e-token", user: AUTH_USER }));
      }
      if (url.includes("myStats") || url.includes("stats") || url.includes("period")) {
        await new Promise((r) => setTimeout(r, 800));
        return route.fulfill(
          json({
            totalTips: 10,
            tipCount: 1,
            employeeCount: 1,
            chartSeries: [],
            employees: [],
          }),
        );
      }
      if (url.includes("profile") || url.includes("business")) {
        return route.fulfill(json({ id: "trace-biz-row", name: "Trace Biz", verificationStatus: "verified" }));
      }
      return route.fulfill(json({ ok: true }));
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[type="email"]', { timeout: 20_000 });

    await page.locator('input[type="email"]').fill("trace-biz@e2e.local");
    await page.locator('input[type="password"]').fill("TracePass1!");

    const submit = page.locator('button[type="submit"]').first();
    await expect(submit).toBeVisible({ timeout: 10_000 });
    await submit.click();

    // Wait until handoff ends or cover gone on dashboard (allow full 20s handoff timeout + buffer).
    await page.waitForFunction(
      () => {
        const trace = (window as unknown as { __POST_LOGIN_TRACE__?: { endCaller: string | null; events?: unknown[] } })
          .__POST_LOGIN_TRACE__;
        if (trace?.endCaller) return true;
        const cover = document.querySelector('[data-testid="sign-in-handoff-cover"]');
        if (!cover && window.location.pathname.includes("dashboard")) return true;
        return false;
      },
      undefined,
      { timeout: 30_000 },
    );

    // Extra settle for late events
    await page.waitForTimeout(800);

    const snapshot = await page.evaluate(() => {
      const trace = (window as unknown as { __POST_LOGIN_TRACE__?: unknown }).__POST_LOGIN_TRACE__;
      const cover = document.querySelector('[data-testid="sign-in-handoff-cover"]');
      const shell = document.querySelector(".caretip-dashboard-shell");
      return {
        pathname: window.location.pathname,
        coverPresent: Boolean(cover),
        shellPresent: Boolean(shell),
        trace,
      };
    });

    const out = {
      capturedAt: new Date().toISOString(),
      consoleLines,
      snapshot,
    };

    const outPath = path.resolve("POST_LOGIN_RUNTIME_TRACE.json");
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
    // Always write even on soft failures below
    console.log("Wrote", outPath);
    console.log("END_CALLER=", (snapshot.trace as { endCaller?: string } | undefined)?.endCaller);
    console.log(
      "events=",
      ((snapshot.trace as { events?: { event: string; elapsedMs: number }[] } | undefined)?.events ?? [])
        .map((e) => `${e.elapsedMs} ${e.event}`)
        .join("\n"),
    );

    // Soft assert: we primarily want the trace artifact
    expect(snapshot.trace).toBeTruthy();
  });
});
