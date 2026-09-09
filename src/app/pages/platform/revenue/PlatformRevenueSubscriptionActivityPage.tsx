import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard } from "lucide-react";
import type { PlatformSubscriptionActivityFilter } from "../../../lib/api";
import { PlatformPage, PlatformPageHeader } from "../../../components/platform/PlatformPageChrome";
import { PlatformSubscriptionMonitoringSection } from "../../../components/platform/PlatformSubscriptionMonitoringSection";

type PlatformRevenueSubscriptionActivityPageProps = {
  initialFilter: PlatformSubscriptionActivityFilter;
  titleKey: string;
  subtitleKey: string;
  allowedFilters?: readonly PlatformSubscriptionActivityFilter[];
  onFilterChange?: (filter: PlatformSubscriptionActivityFilter) => void;
  hideActivityFilters?: boolean;
};

export function PlatformRevenueSubscriptionActivityPage({
  initialFilter,
  titleKey,
  subtitleKey,
  allowedFilters,
  onFilterChange,
  hideActivityFilters = true,
}: PlatformRevenueSubscriptionActivityPageProps) {
  const { t } = useTranslation();
  return (
    <PlatformPage>
      <PlatformPageHeader icon={CreditCard} title={t(titleKey)} subtitle={t(subtitleKey)} />
      <Suspense fallback={null}>
        <PlatformSubscriptionMonitoringSection
          part="activity"
          embedded
          initialFilter={initialFilter}
          allowedFilters={allowedFilters}
          onFilterChange={onFilterChange}
          hideActivityFilters={hideActivityFilters}
        />
      </Suspense>
    </PlatformPage>
  );
}
