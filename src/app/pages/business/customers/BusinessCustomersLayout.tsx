import { Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import { MessageSquareHeart } from "lucide-react";
import { BusinessModuleWorkspaceHeader } from "../../../components/business/BusinessModuleWorkspaceHeader";
import { businessUi } from "@/app/components/business/businessDashboardUi";

export function BusinessCustomersLayout() {
  const { t } = useTranslation();

  return (
    <div className={businessUi.modulePageShell}>
      <div className={businessUi.modulePageContained}>
        <BusinessModuleWorkspaceHeader
          personality="customers"
          badge={t("business.customers.eyebrow")}
          icon={MessageSquareHeart}
          title={t("business.customers.title")}
          subtitle={t("business.customers.mergedSubtitle")}
          hideSubtitleOnMobile
        />
        <Outlet />
      </div>
    </div>
  );
}
