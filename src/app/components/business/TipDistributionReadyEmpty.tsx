import { useTranslation } from "react-i18next";
import { HandCoins } from "lucide-react";
import { DashboardWorkspaceEmptyState } from "../dashboard/DashboardWorkspaceEmptyState";

/** Zero awaiting distribution — not loading or error. */
export function TipDistributionReadyEmpty() {
  const { t } = useTranslation();
  return (
    <div className="tip-distribution-ready-empty">
      <DashboardWorkspaceEmptyState
        compact
        icon={<HandCoins className="h-4 w-4" aria-hidden />}
        title={t("business.tipDistribution.ready.emptyTitle")}
        description={t("business.tipDistribution.ready.emptyDescription")}
        className="border-0 bg-transparent px-0 py-4 shadow-none sm:px-0"
      />
    </div>
  );
}
