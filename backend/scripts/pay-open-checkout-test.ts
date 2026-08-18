/**
 * Pay the open THIS-AUDIT Checkout session with Stripe TEST card 4242.
 * TEST/Sandbox only. Does not create accounts or refund historical PIs.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { chromium } from "@playwright/test";
import { getStripeClient } from "../src/services/stripe.service.js";

const SESSION_ID = process.env.CARETIP_E2E_CHECKOUT_SESSION_ID?.trim() ?? "";

async function diagnose(page: import("@playwright/test").Page): Promise<void> {
  const frames = page.frames().map((f) => ({
    name: f.name(),
    url: f.url().slice(0, 120),
  }));
  console.log(`frames=${JSON.stringify(frames)}`);
  const titles = await page.locator("iframe").evaluateAll((els) =>
    els.map((el) => ({
      title: el.getAttribute("title"),
      name: el.getAttribute("name"),
    })),
  );
  console.log(`iframes=${JSON.stringify(titles)}`);
}

async function fillStripeCheckout(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForTimeout(2000);
  const email = page.locator('input[type="email"], input[name="email"]').first();
  if (await email.count()) {
    await email.fill("marie-e2e@caretip-test.local");
    await email.press("Tab");
  }

  const cardAccordion = page.getByRole("button", { name: /card/i }).first();
  if (await cardAccordion.count()) {
    await cardAccordion.click().catch(() => undefined);
  }

  await page.waitForTimeout(2000);
  await diagnose(page);

  const numberFrame = page.frameLocator(
    'iframe[title*="card number" i], iframe[title*="Secure payment input" i]',
  );
  const numberInput = numberFrame.locator(
    'input[name="number"], input[autocomplete="cc-number"], input[name="cardnumber"]',
  );

  try {
    await numberInput.first().waitFor({ state: "visible", timeout: 8000 });
    await numberInput.first().fill("4242424242424242");
  } catch {
    let filled = false;
    for (const frame of page.frames()) {
      const number = frame.locator(
        'input[name="cardnumber"], input[name="number"], input[autocomplete="cc-number"]',
      );
      if ((await number.count()) > 0) {
        await number.first().fill("4242424242424242");
        filled = true;
        const exp = frame.locator(
          'input[name="exp-date"], input[name="expiry"], input[autocomplete="cc-exp"]',
        );
        if (await exp.count()) await exp.first().fill("1230");
        const cvc = frame.locator('input[name="cvc"], input[autocomplete="cc-csc"]');
        if (await cvc.count()) await cvc.first().fill("123");
        break;
      }
    }
    if (!filled) {
      throw new Error("Could not locate Stripe card fields");
    }
  }

  const expFrame = page.frameLocator('iframe[title*="expir" i]');
  const expInput = expFrame.locator(
    'input[name="exp-date"], input[name="expiry"], input[autocomplete="cc-exp"]',
  );
  if (await expInput.count()) {
    await expInput.first().fill("1230");
  }
  const cvcFrame = page.frameLocator('iframe[title*="cvc" i], iframe[title*="security" i]');
  const cvcInput = cvcFrame.locator('input[name="cvc"], input[autocomplete="cc-csc"]');
  if (await cvcInput.count()) {
    await cvcInput.first().fill("123");
  }

  const pay = page.getByRole("button", { name: /pay|zahlen|submit|complete/i }).first();
  if (await pay.count()) {
    await pay.click();
  }
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key.startsWith("sk_test_")) {
    console.log("ABORT not TEST key");
    process.exit(1);
  }
  if (!SESSION_ID.startsWith("cs_test_")) {
    console.log("ABORT missing CARETIP_E2E_CHECKOUT_SESSION_ID");
    process.exit(1);
  }
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(SESSION_ID);
  if (!session.url) {
    console.log("ABORT no checkout url");
    process.exit(1);
  }
  console.log(`session=${SESSION_ID.slice(-8)} status=${session.status} payment_status=${session.payment_status}`);
  console.log(`checkout_host=${new URL(session.url).hostname}`);

  const browser = await chromium.launch({
    headless: true,
    channel: "msedge",
  });
  const page = await browser.newPage();
  try {
    await page.goto(session.url, { waitUntil: "networkidle", timeout: 60000 });
    await fillStripeCheckout(page);
    await page.waitForTimeout(10000);
    console.log(`after_pay_host=${new URL(page.url()).hostname}`);
  } finally {
    await browser.close();
  }

  const after = await stripe.checkout.sessions.retrieve(SESSION_ID, { expand: ["payment_intent"] });
  const pi =
    typeof after.payment_intent === "string"
      ? after.payment_intent
      : after.payment_intent && typeof after.payment_intent === "object"
        ? after.payment_intent.id
        : null;
  console.log(`after.status=${after.status} payment_status=${after.payment_status} pi=${pi ? `…${pi.slice(-8)}` : "(none)"}`);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
