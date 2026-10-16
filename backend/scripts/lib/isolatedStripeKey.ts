/** Must match the placeholder set by runWithIsolatedPostgres.ts. */
export const ISOLATED_PLACEHOLDER_STRIPE_KEY = ["sk", "test", "isolated", "placeholder", "not", "a", "real", "key"].join("_");

/** True when the isolated harness replaced STRIPE_SECRET_KEY, so real Stripe API calls cannot succeed. */
export function isIsolatedPlaceholderStripeKey(): boolean {
  return (process.env.STRIPE_SECRET_KEY?.trim() ?? "") === ISOLATED_PLACEHOLDER_STRIPE_KEY;
}
