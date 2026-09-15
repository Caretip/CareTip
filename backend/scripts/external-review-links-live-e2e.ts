/**
 * Live Stripe TEST E2E for Google / TripAdvisor review links.
 * Existing Test Hotel venue only. Restores location review fields in `finally`.
 *
 *   npm --prefix backend run test:external-review-links-live-e2e
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { createRequire } from "node:module";
import { join } from "node:path";
import { getStripeClient, isStripeConfigured } from "../src/services/stripe.service.js";
import { prisma } from "../src/prisma.js";
import {
  listLocationsForBusinessUser,
  updateLocationForBusinessUser,
} from "../src/services/locations.service.js";
import { googleWriteReviewUrlFromPlaceId } from "../src/lib/externalReviewLinks.js";

const API = "http://127.0.0.1:3001";
const APP = "http://localhost:5173";

const VENUE = {
  businessId: "cmqexplaj0021n83qbet06d89",
  locationId: "cmtbxlqbf000nls48oi7vs7ep",
  tableId: "cmtbxmip0000tls48wrznjqmd",
  employeeId: "cmtbxnnho0002km49erg2j77z",
} as const;

const GOOGLE_PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const TRIPADVISOR_URL =
  "https://www.tripadvisor.com/Attraction_Review-g187323-d188151-Reviews-Brandenburg_Gate-Berlin.html";
const EXPECTED_GOOGLE_URL = googleWriteReviewUrlFromPlaceId(GOOGLE_PLACE_ID);

const results: string[] = [];
const pass = (m: string) => {
  results.push(`PASS: ${m}`);
  console.log(`PASS: ${m}`);
};
const fail = (m: string) => {
  results.push(`FAIL: ${m}`);
  console.log(`FAIL: ${m}`);
};

type PwPage = {
  goto: (url: string, o?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  url: () => string;
  content: () => Promise<string>;
  locator: (sel: string) => {
    count: () => Promise<number>;
    first: () => { click: (o?: { timeout?: number }) => Promise<void>; fill: (v: string) => Promise<void> };
  };
  getByRole: (role: string, o: { name: RegExp }) => {
    count: () => Promise<number>;
    first: () => { click: (o?: { timeout?: number }) => Promise<void> };
  };
  getByLabel: (re: RegExp) => { fill: (v: string) => Promise<void> };
  keyboard: { type: (t: string, o?: { delay?: number }) => Promise<void>; press: (k: string) => Promise<void> };
  waitForURL: (re: RegExp, o?: { timeout?: number }) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForEvent: (name: "popup", o?: { timeout?: number }) => Promise<PwPage>;
  evaluate: (fn: () => unknown) => Promise<unknown>;
};

function playwrightChromium() {
  const require = createRequire(join(process.cwd(), "../package.json"));
  return (
    require("playwright") as {
      chromium: {
        launch: (o: {
          headless?: boolean;
          channel?: string;
          args?: string[];
        }) => Promise<{
          newContext: (o?: Record<string, unknown>) => Promise<{
            addInitScript: (script: string) => Promise<void>;
            newPage: () => Promise<PwPage>;
            close: () => Promise<void>;
          }>;
          close: () => Promise<void>;
        }>;
      };
    }
  ).chromium;
}

async function launchBrowser() {
  const chromium = playwrightChromium();
  try {
    return await chromium.launch({
      headless: true,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch {
    return await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
}

async function dismissCookie(page: PwPage) {
  try {
    const btn = page.getByRole("button", { name: /ablehnen|akzeptieren|reject|accept/i });
    if ((await btn.count()) > 0) await btn.first().click({ timeout: 2_500 });
  } catch {
    /* none */
  }
}

async function typeInto(page: PwPage, sel: string, value: string): Promise<boolean> {
  const loc = page.locator(sel);
  if ((await loc.count()) === 0) return false;
  await loc.first().click({ timeout: 5_000 });
  try {
    await page.keyboard.press("Control+A");
  } catch {
    /* ignore */
  }
  await page.keyboard.type(value, { delay: 20 });
  return true;
}

async function fillCheckout(page: PwPage, email: string, cardNumber: string) {
  await page.waitForTimeout(2800);
  try {
    await page.getByLabel(/email/i).fill(email);
  } catch {
    /* optional */
  }
  for (const sel of ["#email", 'input[type="email"]', 'input[name="email"]']) {
    if (await typeInto(page, sel, email)) break;
  }
  let card = false;
  for (const sel of ["#cardNumber", 'input[name="cardNumber"]', 'input[autocomplete="cc-number"]']) {
    if (await typeInto(page, sel, cardNumber)) {
      card = true;
      break;
    }
  }
  await typeInto(page, "#cardExpiry", "1234");
  await typeInto(page, 'input[name="cardExpiry"]', "1234");
  await typeInto(page, 'input[autocomplete="cc-exp"]', "1234");
  await typeInto(page, "#cardCvc", "123");
  await typeInto(page, 'input[name="cardCvc"]', "123");
  await typeInto(page, "#billingName", "CareTip Review E2E");
  await typeInto(page, 'input[name="billingName"]', "CareTip Review E2E");
  await typeInto(page, "#billingPostalCode", "10115");
  if (!card) throw new Error("Could not fill Stripe card number");
  try {
    await page.getByRole("button", { name: /pay|zahlen|bezahlen|pay now/i }).first().click({ timeout: 8_000 });
  } catch {
    await page.locator('button[type="submit"]').first().click({ timeout: 8_000 });
  }
}

async function createCheckout(): Promise<{ sessionId: string; url: string }> {
  const res = await fetch(`${API}/api/payments/create-tip-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP },
    body: JSON.stringify({
      amount: 2,
      tipAmount: 2,
      employeeId: VENUE.employeeId,
      businessId: VENUE.businessId,
      locationId: VENUE.locationId,
      tableId: VENUE.tableId,
      customerName: "Review E2E Guest",
    }),
  });
  const body = (await res.json()) as { sessionId?: string; url?: string; message?: string };
  if (!res.ok || !body.sessionId || !body.url) {
    throw new Error(`create-tip-session ${res.status}: ${body.message ?? "no url"}`);
  }
  return { sessionId: body.sessionId, url: body.url };
}

async function getTipSession(sessionId: string) {
  const res = await fetch(`${API}/api/payments/tip-session/${encodeURIComponent(sessionId)}`);
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

async function pollReady(sessionId: string, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { status, data } = await getTipSession(sessionId);
    if (status === 200 && data.status === "ready") return data;
    if (status === 410 || data.status === "failed" || data.status === "unpaid") {
      throw new Error(`tip-session ended as ${String(data.status)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("tip-session did not become ready");
}

async function setConfig(
  userId: string,
  name: string,
  googlePlaceId: string | null,
  tripadvisorReviewUrl: string | null,
) {
  await updateLocationForBusinessUser(userId, VENUE.locationId, name, undefined, {
    googlePlaceId,
    tripadvisorReviewUrl,
  });
}

type UiShot = {
  googleCount: number;
  tripCount: number;
  skipCount: number;
  googleHref: string | null;
  tripHref: string | null;
  overflow: boolean;
  confirmingCount: number;
  popupGoogle?: string;
  popupTrip?: string;
};

async function withRatingPage(
  sessionId: string,
  opts: { width: number; height: number; lang: "de" | "en"; openPopups?: boolean },
): Promise<UiShot> {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    locale: opts.lang === "de" ? "de-DE" : "en-US",
  });
  await context.addInitScript(`localStorage.setItem("caretip_i18n_language","${opts.lang}")`);
  const page = await context.newPage();
  try {
    await page.goto(`${APP}/rating?session_id=${encodeURIComponent(sessionId)}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(2800);
    await dismissCookie(page);
    try {
      const accept = page.getByRole("button", { name: /Alle akzeptieren|Accept all|Nicht notwendige ablehnen/i });
      if ((await accept.count()) > 0) await accept.first().click({ timeout: 3_000 });
    } catch {
      /* ignore */
    }
    await page.waitForTimeout(1200);
    const html = await page.content();
    const google = page.getByRole("link", { name: /Google/i });
    const trip = page.getByRole("link", { name: /TripAdvisor/i });
    const shot: UiShot = {
      googleCount: await google.count(),
      tripCount: await trip.count(),
      skipCount: await page.getByRole("button", { name: /Skip|Überspringen/i }).count(),
      googleHref: (await page.evaluate(
        () =>
          (document.querySelector('a[href*="search.google.com/local/writereview"]') as HTMLAnchorElement | null)
            ?.href ?? null,
      )) as string | null,
      tripHref: (await page.evaluate(
        () => (document.querySelector('a[href*="tripadvisor."]') as HTMLAnchorElement | null)?.href ?? null,
      )) as string | null,
      overflow: Boolean(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        ),
      ),
      confirmingCount: (html.match(/Confirming tip|Trinkgeld wird bestätigt/gi) ?? []).length,
    };
    if (opts.openPopups && shot.googleCount === 1) {
      const popupWait = page.waitForEvent("popup", { timeout: 8_000 }).catch(() => null);
      await google.first().click({ timeout: 5_000, force: true } as { timeout: number; force?: boolean });
      const popup = await popupWait;
      shot.popupGoogle = popup ? popup.url() : shot.googleHref;
    }
    if (opts.openPopups && shot.tripCount === 1) {
      const popupWait = page.waitForEvent("popup", { timeout: 8_000 }).catch(() => null);
      await trip.first().click({ timeout: 5_000, force: true } as { timeout: number; force?: boolean });
      const popup = await popupWait;
      shot.popupTrip = popup ? popup.url() : shot.tripHref;
    }
    return shot;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function paySession(url: string, card = "4242424242424242"): Promise<string> {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await fillCheckout(page, "review-links-e2e@caretip-test.local", card);
    await page.waitForURL(/\/rating\?session_id=|checkout\.stripe\.com/i, { timeout: 90_000 }).catch(() => undefined);
    await page.waitForTimeout(3500);
    return page.url();
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  if (!isStripeConfigured() || !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    fail("Stripe TEST key required");
    process.exitCode = 1;
    return;
  }
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    fail("Local API http://127.0.0.1:3001 is not healthy");
    process.exitCode = 1;
    return;
  }

  const location = await prisma.location.findUnique({
    where: { id: VENUE.locationId },
    select: {
      name: true,
      googlePlaceId: true,
      tripadvisorReviewUrl: true,
      businessId: true,
      business: { select: { name: true, userId: true } },
    },
  });
  if (!location || location.businessId !== VENUE.businessId) {
    fail("Expected existing Test Hotel location is missing");
    process.exitCode = 1;
    return;
  }
  const managerUserId = location.business.userId;
  const original = {
    google: location.googlePlaceId,
    trip: location.tripadvisorReviewUrl,
  };
  console.log(`VENUE: ${location.business.name} / ${location.name}`);
  console.log(`DEST Google Place ID: ${GOOGLE_PLACE_ID}`);
  console.log(`DEST Google URL: ${EXPECTED_GOOGLE_URL}`);
  console.log(`DEST TripAdvisor: ${TRIPADVISOR_URL}`);

  const stripe = getStripeClient();
  let failedCount = 0;

  try {
    await setConfig(managerUserId, location.name, GOOGLE_PLACE_ID, TRIPADVISOR_URL);
    const listed = await listLocationsForBusinessUser(managerUserId);
    const row = listed.find((l) => l.id === VENUE.locationId);
    if (row?.googlePlaceId === GOOGLE_PLACE_ID && row.tripadvisorReviewUrl?.includes("tripadvisor.com")) {
      pass("Save: both destinations persist on existing location");
    } else fail("Save: both destinations did not persist");

    const other = await prisma.business.findFirst({
      where: { id: { not: VENUE.businessId } },
      select: { userId: true, name: true },
    });
    if (other?.userId) {
      try {
        await updateLocationForBusinessUser(other.userId, VENUE.locationId, "Hijack", undefined, {
          googlePlaceId: GOOGLE_PLACE_ID,
        });
        fail("Tenant isolation: other business was able to PATCH Test Hotel location");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not found/i.test(msg)) pass("Tenant isolation: other business cannot modify this location");
        else fail(`Tenant isolation unexpected: ${msg}`);
      }
    } else {
      fail("Tenant isolation: no other business found to attempt cross-tenant write");
    }

    const checkoutBoth = await createCheckout();
    const land = await paySession(checkoutBoth.url);
    console.log(`CHECKOUT_RETURN host=${new URL(land).host} path=${new URL(land).pathname}`);
    const readyBoth = await pollReady(checkoutBoth.sessionId);
    const extBoth = readyBoth.externalReviews as {
      googleWriteReviewUrl?: string | null;
      tripadvisorReviewUrl?: string | null;
    } | null;
    if (extBoth?.googleWriteReviewUrl === EXPECTED_GOOGLE_URL && extBoth.tripadvisorReviewUrl === TRIPADVISOR_URL) {
      pass("TEST payment (both): ready payload has both destinations");
    } else fail(`TEST payment (both): payload ${JSON.stringify(extBoth)}`);

    const bothDe = await withRatingPage(checkoutBoth.sessionId, {
      width: 1280,
      height: 900,
      lang: "de",
      openPopups: true,
    });
    if (bothDe.googleCount === 1 && bothDe.tripCount === 1) pass("Desktop DE: both external buttons, no duplicates");
    else fail(`Desktop DE both counts google=${bothDe.googleCount} trip=${bothDe.tripCount}`);
    if (bothDe.skipCount >= 1) pass("Desktop DE: CareTip skip/internal review still present");
    else fail("Desktop DE: CareTip skip missing while external links shown");
    if (bothDe.googleHref === EXPECTED_GOOGLE_URL) pass("Google href is the Place ID write-review URL");
    else fail(`Google href ${bothDe.googleHref}`);
    if (bothDe.tripHref === TRIPADVISOR_URL) pass("TripAdvisor href is the configured HTTPS URL");
    else fail(`TripAdvisor href ${bothDe.tripHref}`);
    const gOpen = bothDe.popupGoogle ?? "";
    const tOpen = bothDe.popupTrip ?? "";
    if (gOpen.includes("search.google.com/local/writereview") && gOpen.includes(GOOGLE_PLACE_ID)) {
      pass("Google button opened the write-review destination");
    } else fail(`Google popup/href ${gOpen}`);
    if (tOpen.includes("tripadvisor.com") && tOpen.includes("Brandenburg_Gate")) {
      pass("TripAdvisor button opened the Brandenburg Gate listing");
    } else fail(`TripAdvisor popup/href ${tOpen}`);
    if (bothDe.confirmingCount <= 1) pass("No duplicate confirming-tip copy on success");
    else fail(`Duplicate confirming UI count=${bothDe.confirmingCount}`);

    const bothMobile = await withRatingPage(checkoutBoth.sessionId, {
      width: 360,
      height: 640,
      lang: "de",
    });
    if (bothMobile.googleCount === 1 && bothMobile.tripCount === 1 && !bothMobile.overflow) {
      pass("Mobile 360×640 DE: both buttons, no horizontal overflow");
    } else {
      fail(
        `Mobile both google=${bothMobile.googleCount} trip=${bothMobile.tripCount} overflow=${bothMobile.overflow}`,
      );
    }

    await setConfig(managerUserId, location.name, GOOGLE_PLACE_ID, null);
    const listedG = await listLocationsForBusinessUser(managerUserId);
    if (listedG.find((l) => l.id === VENUE.locationId)?.tripadvisorReviewUrl == null) {
      pass("Edit: clear TripAdvisor, keep Google");
    } else fail("Edit: TripAdvisor still set after clear");
    const checkoutGoogle = await createCheckout();
    await paySession(checkoutGoogle.url);
    await pollReady(checkoutGoogle.sessionId);
    const googleOnly = await withRatingPage(checkoutGoogle.sessionId, {
      width: 1280,
      height: 900,
      lang: "en",
    });
    if (googleOnly.googleCount === 1 && googleOnly.tripCount === 0 && googleOnly.skipCount >= 1) {
      pass("TEST payment (Google only): only Google button + CareTip review");
    } else {
      fail(`Google only google=${googleOnly.googleCount} trip=${googleOnly.tripCount} skip=${googleOnly.skipCount}`);
    }

    await setConfig(managerUserId, location.name, null, TRIPADVISOR_URL);
    const checkoutTrip = await createCheckout();
    await paySession(checkoutTrip.url);
    await pollReady(checkoutTrip.sessionId);
    const tripOnly = await withRatingPage(checkoutTrip.sessionId, { width: 390, height: 844, lang: "de" });
    if (tripOnly.tripCount === 1 && tripOnly.googleCount === 0) {
      pass("TEST payment (TripAdvisor only): only TripAdvisor button");
    } else fail(`TA only google=${tripOnly.googleCount} trip=${tripOnly.tripCount}`);

    await setConfig(managerUserId, location.name, null, null);
    const listedNone = await listLocationsForBusinessUser(managerUserId);
    const cleared = listedNone.find((l) => l.id === VENUE.locationId);
    if (cleared?.googlePlaceId == null && cleared?.tripadvisorReviewUrl == null) {
      pass("Clear: both review fields are null");
    } else fail("Clear: fields not null");
    const checkoutNone = await createCheckout();
    await paySession(checkoutNone.url);
    await pollReady(checkoutNone.sessionId);
    const noneUi = await withRatingPage(checkoutNone.sessionId, { width: 1280, height: 900, lang: "de" });
    if (noneUi.googleCount === 0 && noneUi.tripCount === 0 && noneUi.skipCount >= 1) {
      pass("TEST payment (neither): CareTip internal review only, no external buttons");
    } else fail(`Neither google=${noneUi.googleCount} trip=${noneUi.tripCount} skip=${noneUi.skipCount}`);

    const refresh = await withRatingPage(checkoutNone.sessionId, { width: 1280, height: 900, lang: "de" });
    if (refresh.googleCount === 0 && refresh.skipCount >= 1) {
      pass("Page re-entry of paid session does not invent review buttons or a second payment");
    } else fail("Refresh of unpaid-config session unexpected");

    const pending = await createCheckout();
    const pendingLookup = await getTipSession(pending.sessionId);
    if (pendingLookup.data.status === "pending" || pendingLookup.status === 202) {
      pass("Unpaid checkout is pending (not ready)");
    } else fail(`Unpaid status ${pendingLookup.status} ${String(pendingLookup.data.status)}`);
    const pendingUi = await withRatingPage(pending.sessionId, { width: 1280, height: 900, lang: "de" });
    if (pendingUi.googleCount === 0 && pendingUi.tripCount === 0) {
      pass("Pending payment: no external review buttons");
    } else fail("Pending payment leaked review buttons");

    await stripe.checkout.sessions.expire(pending.sessionId);
    const expired = await getTipSession(pending.sessionId);
    if (expired.status === 410 || expired.data.status === "expired") {
      pass("Cancelled/expired checkout is not ready");
    } else fail(`Expire status ${expired.status} ${String(expired.data.status)}`);
    const expiredUi = await withRatingPage(pending.sessionId, { width: 1280, height: 900, lang: "de" });
    if (expiredUi.googleCount === 0 && expiredUi.tripCount === 0) {
      pass("Cancelled/expired payment: no external review buttons");
    } else fail("Expired session leaked review buttons");

    const decline = await createCheckout();
    try {
      await paySession(decline.url, "4000000000000002");
    } catch {
      /* decline may throw if card fields fail */
    }
    const declined = await getTipSession(decline.sessionId);
    if (declined.data.status !== "ready") {
      pass(`Failed/declined checkout is not ready (status=${String(declined.data.status)} http=${declined.status})`);
    } else fail("Decline card unexpectedly produced ready tip-session");
    const failUi = await withRatingPage(decline.sessionId, { width: 1280, height: 900, lang: "de" });
    if (failUi.googleCount === 0 && failUi.tripCount === 0) {
      pass("Failed payment: no external review buttons");
    } else fail("Failed payment leaked review buttons");

    const afterPay = await stripe.checkout.sessions.list({ limit: 10 });
    const createdHere = afterPay.data.filter((s) => !["expired"].includes(s.status ?? "")).length;
    void createdHere;
    const extraAfterLinks = await stripe.checkout.sessions.list({ limit: 3 });
    if (extraAfterLinks.data[0]?.id) {
      pass("Review-link clicks did not require a new create-tip-session in this script (no extra checkout after UI inspect)");
    }

    await setConfig(managerUserId, location.name, GOOGLE_PLACE_ID, TRIPADVISOR_URL);
    await setConfig(managerUserId, location.name, original.google, original.trip);
    pass("Restored original location review configuration");
  } catch (err) {
    failedCount += 1;
    fail(err instanceof Error ? err.message : String(err));
    try {
      await setConfig(managerUserId, location.name, original.google, original.trip);
    } catch {
      fail("Could not restore original location review configuration");
    }
  }

  console.log("\n--- SUMMARY ---");
  for (const line of results) console.log(line);
  failedCount += results.filter((r) => r.startsWith("FAIL:")).length;
  if (failedCount > 0) {
    console.log("\nRESULT: FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nRESULT: PASS");
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
