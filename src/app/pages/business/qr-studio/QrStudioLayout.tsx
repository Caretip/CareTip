import { Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { QrCode } from "lucide-react";
import { BusinessModuleWorkspaceHeader } from "../../../components/business/BusinessModuleWorkspaceHeader";
import {
  QrStudioAccessPanel,
  resolveQrStudioAccessBlock,
} from "../../../components/business/QrStudioAccessPanel";
import { BusinessBrandingProvider } from "../../../contexts/BusinessBrandingContext";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { canUseProductionQr } from "../../../lib/businessVerificationCapabilities";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";

export function QrStudioLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { user } = useRequireAuth();

  const isPrintStudio = pathname.includes("/qr-studio/print");
  const canUseQr = canUseProductionQr(user?.onboardingVerificationStatus, Boolean(user?.impersonation));
  const accessBlock = resolveQrStudioAccessBlock(canUseQr);

  return (
    <div
      className={cn(
        "min-w-0 w-full overflow-x-clip",
        isPrintStudio
          ? "business-module-page bg-background px-4 pb-8 sm:px-6 lg:px-8"
          : businessUi.modulePageShell,
      )}
    >
      <div
        className={cn(
          "dashboard-page-contained mx-auto min-w-0 w-full max-w-full",
          isPrintStudio ? "max-w-none" : "max-w-6xl",
        )}
      >
        <BusinessModuleWorkspaceHeader
          personality="qrStudio"
          badge={t("premium.qrStudio.badge")}
          feature={t("premium.qrStudio.feature")}
          icon={QrCode}
          title={t("business.qrStudio.title")}
          subtitle={t("business.qrStudio.subtitle")}
          hideSubtitleOnMobile
          className={isPrintStudio ? "mb-4 pb-3" : undefined}
        />
        {accessBlock ? (
          <div className="py-8 sm:py-12">
            <QrStudioAccessPanel reason={accessBlock} onboardingVerificationStatus={user?.onboardingVerificationStatus} />
          </div>
        ) : (
          <BusinessBrandingProvider canEdit>
            <Outlet />
          </BusinessBrandingProvider>
        )}
      </div>
    </div>
  );
}
