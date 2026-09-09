import { useCallback } from "react";
import { useSearchParams } from "react-router";
import type { PlatformSubscriptionActivityFilter } from "../../../lib/api";
import { PlatformRevenueSubscriptionActivityPage } from "./PlatformRevenueSubscriptionActivityPage";

const BILLING_FAILURE_FILTERS: readonly PlatformSubscriptionActivityFilter[] = ["failed", "past_due"];

function parseFailedBillingFilter(raw: string | null): PlatformSubscriptionActivityFilter {
  return raw === "past_due" ? "past_due" : "failed";
}

export function PlatformFailedBillingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseFailedBillingFilter(searchParams.get("filter"));

  const onFilterChange = useCallback(
    (next: PlatformSubscriptionActivityFilter) => {
      const sp = new URLSearchParams(searchParams);
      sp.set("filter", next);
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return (
    <PlatformRevenueSubscriptionActivityPage
      initialFilter={filter}
      titleKey="admin.revenuePages.failedBilling.title"
      subtitleKey="admin.revenuePages.failedBilling.subtitle"
      allowedFilters={BILLING_FAILURE_FILTERS}
      onFilterChange={onFilterChange}
      hideActivityFilters={false}
    />
  );
}
