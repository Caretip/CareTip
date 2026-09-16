/** Platform subscription free trial — Stripe Checkout `trial_period_days`. Product truth: 30 days. */
export const SUBSCRIPTION_TRIAL_PERIOD_DAYS = (() => {
  const raw = process.env.STRIPE_TRIAL_PERIOD_DAYS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 30;
  return Number.isFinite(n) && n > 0 ? n : 30;
})();

export function isSubscriptionTrialEnabled(): boolean {
  return process.env.SUBSCRIPTION_TRIAL_ENABLED?.trim().toLowerCase() !== "false";
}
