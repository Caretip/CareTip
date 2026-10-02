import type { PlatformSubscriptionActivityFilter } from "../../lib/api";

const SUBSCRIPTION_ACTIVITY_FILTERS: readonly PlatformSubscriptionActivityFilter[] = [
  "all",
  "successful",
  "failed",
  "trialing",
  "active",
  "cancelled",
  "past_due",
];

export function parsePlatformSubscriptionActivityFilter(
  raw: string | null | undefined,
): PlatformSubscriptionActivityFilter {
  if (raw && (SUBSCRIPTION_ACTIVITY_FILTERS as readonly string[]).includes(raw)) {
    return raw as PlatformSubscriptionActivityFilter;
  }
  return "all";
}
