const STRIPE_CHECKOUT_HOST = "checkout.stripe.com";
const STRIPE_BILLING_PORTAL_HOST = "billing.stripe.com";

export type StripeRedirectKind = "checkout" | "portal";

export type ExternalStripeRedirectResult =
  | { ok: true; navigated: true }
  | { ok: false; reason: "missing_url" | "invalid_url" };

function resolveAllowedHost(kind: StripeRedirectKind): string {
  return kind === "checkout" ? STRIPE_CHECKOUT_HOST : STRIPE_BILLING_PORTAL_HOST;
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
  if (parsed.hostname !== resolveAllowedHost(kind)) {
    throw new Error(`Redirect URL must be hosted by Stripe (${resolveAllowedHost(kind)})`);
  }
  return parsed;
}

/**
 * Navigate to a Stripe-hosted checkout or billing portal URL.
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
