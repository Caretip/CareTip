/**
 * Phase 2 fixture classification rules shared by the fixture investigation and the local-copy manifest.
 * Inputs are raw (pre-sanitization) business slug / manager email / Stripe ids; outputs are labels only.
 */

/** Slug prefixes written by backend/scripts/*-runtime.ts fixtures (slug = `${prefix}-${suffix}`). */
export const SUITE_SLUG_PREFIXES = [
  "gen-rec", "tf-rec", "inj", "lk", "recon", "conc", "infl", "td", "p0", "p2-period", "bd-int", "biz-recon",
  "biz-fin", "fin-met", "ea-closure", "ea-tz", "ea-kpi", "emp-connect", "wh", "p2det", "routing-ns", "routing-o",
  "routing", "dispute", "connect16", "connect2", "connect25", "connect27", "connect28", "connect29", "connect3",
  "connect35", "connect4", "connectv2", "connect-a", "connect-b", "connect-none", "instant", "eip", "inact",
  "sched-payout", "test-hotel-fixture", "phase-a-fixture",
].sort((a, b) => b.length - a.length);

/** Businesses created by backend/prisma/seedDemoEnvironment.ts and seedPlatformAnalyticsDemo.ts. */
export const DEMO_SEED_SLUGS = new Set([
  "brasserie-lindenstrasse", "harbor-spa-wellness", "city-salon-collective", "alpine-chalet-hotel",
  "riverside-cafe-koeln", "the-rustic-table", "caretip-demo-venue",
]);
export const DEMO_SEED_BUSINESS_IDS = new Set(["seed-business-001"]);
export const DEMO_SEED_TIP_PREFIXES = ["wdemotip", "demotip-", "seed-demo-tip-"];

const REAL_ACCT = /^acct_[A-Za-z0-9]{16}$/;
const REAL_PI = /^pi_[A-Za-z0-9]{24}$/;
const REAL_TR = /^tr_[A-Za-z0-9]{24}$/;
const REAL_CH = /^(ch|py)_[A-Za-z0-9]{24}$/;

export type IdShape = "real-format" | "synthetic" | "none";

function shape(value: string | null | undefined, real: RegExp): IdShape {
  if (!value) return "none";
  return real.test(value) ? "real-format" : "synthetic";
}

export const stripeIdShape = {
  account: (v: string | null | undefined) => shape(v, REAL_ACCT),
  paymentIntent: (v: string | null | undefined) => shape(v, REAL_PI),
  transfer: (v: string | null | undefined) => shape(v, REAL_TR),
  charge: (v: string | null | undefined) => shape(v, REAL_CH),
};

const PLAUSIBLE_MIN = Date.UTC(2024, 0, 1);
const PLAUSIBLE_MAX = Date.UTC(2027, 11, 31);

/** Run timestamp embedded in a fixture slug suffix (Date.now() decimal, or Date.now().toString(36)). */
export function slugRunTimestamp(slug: string, prefix: string): number | null {
  const rest = slug.slice(prefix.length + 1);
  const decimal = rest.match(/(\d{13})/);
  if (decimal) {
    const ms = Number(decimal[1]);
    if (ms >= PLAUSIBLE_MIN && ms <= PLAUSIBLE_MAX) return ms;
  }
  const head = rest.match(/^([a-z0-9]{8})/);
  if (head) {
    const ms = parseInt(head[1], 36);
    if (ms >= PLAUSIBLE_MIN && ms <= PLAUSIBLE_MAX) return ms;
  }
  return null;
}

export type EmailClass = "example.com" | "demo-seed" | "other" | "none";

export function emailClass(email: string | null | undefined): EmailClass {
  if (!email) return "none";
  const lower = email.toLowerCase();
  if (lower.endsWith("@example.com")) return "example.com";
  if (/\.demo@caretip\.de$/.test(lower)) return "demo-seed";
  return "other";
}

export function suitePrefixForSlug(slug: string): string | null {
  return SUITE_SLUG_PREFIXES.find((p) => slug.startsWith(`${p}-`)) ?? null;
}

export type BusinessForClassification = {
  id: string;
  slug: string;
  createdAt: Date;
  stripeAccountId: string | null;
  managerEmail: string | null;
};

export type BusinessFixtureClass = "fixture" | "demo-seed" | "test-mode-real-format" | "non-fixture";

export type BusinessClassification = {
  businessId: string;
  class: BusinessFixtureClass;
  suite: string | null;
  slugRunVsBusinessCreatedMin: number | null;
  managerEmail: EmailClass;
  account: IdShape;
  evidence: string;
};

/**
 * Business-level classification for scan scope. `fixture` requires a test-suite slug or an
 * example.com manager; `test-mode-real-format` only says the ids look like Stripe test-mode ids —
 * it does not assert the records are genuine or that Stripe will resolve them.
 */
export function classifyBusiness(b: BusinessForClassification): BusinessClassification {
  const suite = suitePrefixForSlug(b.slug);
  const runTs = suite ? slugRunTimestamp(b.slug, suite) : null;
  const deltaMin = runTs != null ? Math.round(Math.abs(b.createdAt.getTime() - runTs) / 60000) : null;
  const mail = emailClass(b.managerEmail);
  const account = stripeIdShape.account(b.stripeAccountId);
  const base = { businessId: b.id, suite, slugRunVsBusinessCreatedMin: deltaMin, managerEmail: mail, account };

  if (suite || mail === "example.com") {
    const evidence = [
      suite ? `suite '${suite}'${deltaMin != null ? ` run-timestamp Δ${deltaMin}min` : " (no run timestamp)"}` : null,
      mail === "example.com" ? "example.com manager" : null,
      account === "synthetic" ? "synthetic acct id" : null,
    ]
      .filter(Boolean)
      .join(", ");
    return { ...base, class: "fixture", evidence };
  }
  if (DEMO_SEED_SLUGS.has(b.slug) || DEMO_SEED_BUSINESS_IDS.has(b.id) || mail === "demo-seed") {
    return { ...base, class: "demo-seed", evidence: "demo seed script conventions" };
  }
  if (account === "real-format") {
    return { ...base, class: "test-mode-real-format", evidence: "real-format acct id, non-example manager" };
  }
  return { ...base, class: "non-fixture", evidence: "no fixture markers" };
}

export type RecordClassification = "confirmed fixture" | "probable fixture" | "legitimate/unknown" | "inconclusive";

/** Record-level classification (requires two independent markers for "confirmed fixture"). */
export function classifyRecord(input: {
  business: BusinessForClassification | null;
  paymentIntentId: string | null;
  transferId: string | null;
  tipId: string | null;
}): { classification: RecordClassification; reason: string; pi: IdShape; tr: IdShape; business: BusinessClassification | null } {
  const b = input.business;
  const pi = stripeIdShape.paymentIntent(input.paymentIntentId);
  const tr = stripeIdShape.transfer(input.transferId);
  if (!b) return { classification: "inconclusive", reason: "business relation missing", pi, tr, business: null };

  const bc = classifyBusiness(b);
  const demoSeed =
    bc.class === "demo-seed" || (input.tipId ? DEMO_SEED_TIP_PREFIXES.some((p) => input.tipId!.startsWith(p)) : false);
  const suiteRunMatch = bc.suite != null && bc.slugRunVsBusinessCreatedMin != null && bc.slugRunVsBusinessCreatedMin <= 120;
  const syntheticStripe = [bc.account, pi, tr].includes("synthetic");
  const realStripe = [bc.account, pi, tr].includes("real-format");
  const markers = [bc.suite != null, syntheticStripe, bc.managerEmail === "example.com", demoSeed].filter(Boolean).length;

  let classification: RecordClassification;
  let reason: string;
  if (suiteRunMatch && (syntheticStripe || bc.managerEmail === "example.com") && !realStripe) {
    classification = "confirmed fixture";
    reason = `suite '${bc.suite}' slug run-timestamp within ${bc.slugRunVsBusinessCreatedMin}min of business creation + ${syntheticStripe ? "synthetic Stripe ids" : "example.com manager"}`;
  } else if (demoSeed && !realStripe) {
    classification = "probable fixture";
    reason = "demo seed script conventions (seed slug / seed tip id), no real-format Stripe ids";
  } else if (markers > 0 && realStripe) {
    classification = "inconclusive";
    reason = "fixture markers present but real-format Stripe ids also present";
  } else if (markers > 0) {
    classification = "probable fixture";
    reason = `markers: ${[bc.suite ? `suite '${bc.suite}'` : null, syntheticStripe ? "synthetic Stripe ids" : null, bc.managerEmail === "example.com" ? "example.com manager" : null].filter(Boolean).join(", ")}`;
  } else {
    classification = "legitimate/unknown";
    reason = "no fixture markers";
  }
  return { classification, reason, pi, tr, business: bc };
}
