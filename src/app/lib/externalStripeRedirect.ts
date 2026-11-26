import {
  beginExternalStripeNavigationHold,
  endExternalStripeNavigationHold,
  type ExternalStripeHoldPresentation,
} from "./externalStripeNavigationHold";

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

export type ExternalStripeRedirectOptions = {
  /**
   * "inline" keeps the CareTip page on screen (the caller's button shows the progress) until the
   * browser actually replaces it with Stripe. Default "overlay" shows the global loading screen.
   */
  presentation?: ExternalStripeHoldPresentation;
  /**
   * Inline only: called if the page is still showing `stallMs` after the hand-off started (the
   * browser never left, for example offline or blocked). The caller restores its button and
   * explains; a retry reuses the same open Checkout Session (server-side idempotency).
   */
  onStalled?: () => void;
  stallMs?: number;
};

/** After this long without leaving the page, an inline hand-off is treated as failed. */
export const EXTERNAL_STRIPE_HANDOFF_STALL_MS = 20_000;

let stallTimer: number | null = null;

function clearStallTimer(): void {
  if (stallTimer !== null) window.clearTimeout(stallTimer);
  stallTimer = null;
}

/**
 * Navigate to a Stripe-hosted checkout, billing portal, Connect onboarding, or Express Dashboard URL.
 * Only call it once the server returned the URL: it validates the destination (HTTPS, exact Stripe
 * host) and only then starts the browser navigation. Nothing is unmounted and no intermediate route
 * is used; the current page stays until the browser replaces it.
 * On success, keeps caller loading state active — the browser is leaving the SPA.
 * Only release loading when this returns `{ ok: false }` or throws (or `onStalled` fires).
 */
export function performExternalStripeRedirect(
  rawUrl: string | null | undefined,
  kind: StripeRedirectKind = "checkout",
  holdMessage?: string,
  options?: ExternalStripeRedirectOptions,
): ExternalStripeRedirectResult {
  const trimmed = rawUrl?.trim();
  if (!trimmed) {
    return { ok: false, reason: "missing_url" };
  }

  let parsed: URL;
  try {
    parsed = parseStripeRedirectUrl(trimmed, kind);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  const presentation = options?.presentation ?? "overlay";
  beginExternalStripeNavigationHold(holdMessage, { presentation });
  if (presentation === "inline" && options?.onStalled) {
    clearStallTimer();
    const onStalled = options.onStalled;
    const cancel = () => clearStallTimer();
    window.addEventListener("pagehide", cancel, { once: true });
    stallTimer = window.setTimeout(() => {
      stallTimer = null;
      window.removeEventListener("pagehide", cancel);
      endExternalStripeNavigationHold();
      onStalled();
    }, options.stallMs ?? EXTERNAL_STRIPE_HANDOFF_STALL_MS);
  }
  try {
    window.location.assign(parsed.href);
  } catch {
    clearStallTimer();
    endExternalStripeNavigationHold();
    return { ok: false, reason: "invalid_url" };
  }
  return { ok: true, navigated: true };
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
