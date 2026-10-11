/** Stripe Payout.metadata keys (Connect standard payouts). Present on creates after Phase A.1. */
export const SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID = "caretip_scheduled_payout_correlation_id";
export const SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY = "caretip_schedule_window_key";

export function buildScheduledPayoutStripeMetadata(args: {
  correlationId: string;
  scheduleWindowKey: string;
}): Record<string, string> {
  return {
    [SCHEDULED_PAYOUT_STRIPE_METADATA_CORRELATION_ID]: args.correlationId,
    [SCHEDULED_PAYOUT_STRIPE_METADATA_WINDOW_KEY]: args.scheduleWindowKey,
  };
}
