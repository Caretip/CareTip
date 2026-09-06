const STRIPE_CHECKOUT_HOST = "checkout.stripe.com";
const STRIPE_BILLING_PORTAL_HOST = "billing.stripe.com";
/** V1 Account Links (`accountLinks.create`) return this host. */
const STRIPE_CONNECT_HOST_V1 = "connect.stripe.com";
/**
 * Official Accounts V2 Account Link URL host.
 * Stripe docs example: https://accounts.stripe.com/r/acct_…
 */
const STRIPE_CONNECT_HOST_V2 = "accounts.stripe.com";

/** Exact Connect onboarding hosts only — no Stripe subdomain wildcard. */
const STRIPE_CONNECT_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  STRIPE_CONNECT_HOST_V1,
  STRIPE_CONNECT_HOST_V2,
]);

export type StripeRedirectKind = "checkout" | "portal" | "connect" | "expressDashboard";

export type ExternalStripeRedirectResult =
  | { ok: true; navigated: true }
  | { ok: false; reason: "missing_url" | "invalid_url" };

function allowedHostsForKind(kind: StripeRedirectKind): ReadonlySet<string> {
  if (kind === "portal") return new Set([STRIPE_BILLING_PORTAL_HOST]);
  if (kind === "connect") return STRIPE_CONNECT_ALLOWED_HOSTS;
  if (kind === "expressDashboard") {
    return new Set(["stripe.com", STRIPE_CONNECT_HOST_V1]);
  }
  return new Set([STRIPE_CHECKOUT_HOST]);
}

function isAllowedExpressDashboardPath(parsed: URL): boolean {
  if (parsed.hostname === STRIPE_CONNECT_HOST_V1) {
    return parsed.pathname.startsWith("/express") || parsed.pathname.startsWith("/express_login");
  }
  if (parsed.hostname === "stripe.com") {
    return parsed.pathname.startsWith("/express/") || parsed.pathname === "/express";
  }
  return false;
}

function parseStripeRedirectUrl(rawUrl: string, kind: StripeRedirectKind): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid redirect URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Redirect URL must use HTTPS");
  }
  const allowed = allowedHostsForKind(kind);
  if (!allowed.has(parsed.hostname)) {
    throw new Error("Redirect URL must be hosted by Stripe");
  }
  if (kind === "expressDashboard" && !isAllowedExpressDashboardPath(parsed)) {
    throw new Error("Redirect URL must be a Stripe Express Dashboard login link");
  }
  return parsed;
}

/** Pure host/protocol check — used by Connect UI tests without touching window.location. */
export function isAllowedStripeRedirectUrl(
  rawUrl: string | null | undefined,
  kind: StripeRedirectKind,
): boolean {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return false;
  try {
    parseStripeRedirectUrl(trimmed, kind);
    return true;
  } catch {
    return false;
  }
}

/**
 * Navigate to a Stripe-hosted checkout, billing portal, Connect onboarding, or Express Dashboard URL.
 * On success, keeps caller loading state active — the browser is leaving the SPA.
 * Only release loading when this returns `{ ok: false }` or throws.
 */
export function performExternalStripeRedirect(
  rawUrl: string | null | undefined,
  kind: StripeRedirectKind = "checkout",
): ExternalStripeRedirectResult {
  const trimmed = rawUrl?.trim();
  if (!trimmed) {
    return { ok: false, reason: "missing_url" };
  }

  try {
    const parsed = parseStripeRedirectUrl(trimmed, kind);
    window.location.assign(parsed.href);
    return { ok: true, navigated: true };
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
}

/** @deprecated Prefer {@link performExternalStripeRedirect} for flows that manage loading state. */
export function redirectToStripeCheckoutUrl(rawUrl: string): void {
  const result = performExternalStripeRedirect(rawUrl, "checkout");
  if (!result.ok) {
    throw new Error(
      result.reason === "missing_url" ? "Missing checkout URL" : "Invalid checkout URL",
    );
  }
}
