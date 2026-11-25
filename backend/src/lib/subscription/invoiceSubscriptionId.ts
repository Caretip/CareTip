/**
 * Subscription an invoice belongs to, for every webhook payload version we may receive. The payload
 * shape follows the webhook endpoint's API version, not the SDK's:
 *  - before 2025-03-31.basil: `invoice.subscription`
 *  - since then: `invoice.parent.subscription_details.subscription` (`parent` is null or has another
 *    type for one-off and quote invoices)
 * Either may be an id or an expanded object. Returns null when the invoice has no subscription.
 */
function idOf(value: unknown): string | null {
  const id = typeof value === "object" && value !== null ? (value as { id?: unknown }).id : value;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function subscriptionIdFromInvoice(invoice: unknown): string | null {
  if (typeof invoice !== "object" || invoice === null) return null;
  const { subscription, parent } = invoice as {
    subscription?: unknown;
    parent?: { subscription_details?: { subscription?: unknown } | null } | null;
  };
  return idOf(subscription) ?? idOf(parent?.subscription_details?.subscription);
}
