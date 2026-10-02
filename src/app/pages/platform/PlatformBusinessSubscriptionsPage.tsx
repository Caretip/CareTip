import { Suspense, useCallback } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { CreditCard } from "lucide-react";
import type { PlatformSubscriptionActivityFilter } from "../../lib/api";
import { PlatformPage, PlatformPageHeader } from "../../components/platform/PlatformPageChrome";
import { PlatformSubscriptionMonitoringSection } from "../../components/platform/PlatformSubscriptionMonitoringSection";
import { parsePlatformSubscriptionActivityFilter } from "./platformSubscriptionRouteUtils";

export function PlatformBusinessSubscriptionsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parsePlatformSubscriptionActivityFilter(searchParams.get("filter"));

  const onFilterChange = useCallback(
    (next: PlatformSubscriptionActivityFilter) => {
      const sp = new URLSearchParams(searchParams);
      if (next === "all") sp.delete("filter");
      else sp.set("filter", next);
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={CreditCard}
        title={t("admin.subscriptions.title")}
        subtitle={t("admin.subscriptions.desc")}
      />
      <Suspense fallback={null}>
        <PlatformSubscriptionMonitoringSection
          part="full"
          initialFilter={filter}
          onFilterChange={onFilterChange}
          hideActivityFilters={false}
        />
      </Suspense>
    </PlatformPage>
  );
}
