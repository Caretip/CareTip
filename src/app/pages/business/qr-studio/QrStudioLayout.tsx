import { Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { QrCode, Sparkles } from "lucide-react";
import { BusinessModuleWorkspaceHeader } from "../../../components/business/BusinessModuleWorkspaceHeader";
import {
  QrStudioAccessPanel,
  resolveQrStudioAccessBlock,
} from "../../../components/business/QrStudioAccessPanel";
import { BusinessBrandingProvider } from "../../../contexts/BusinessBrandingContext";
import { useBusinessEntitlementsContext } from "../../../contexts/BusinessEntitlementsContext";
import { useSubscriptionEntitlements } from "../../../hooks/useSubscriptionEntitlements";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { canUseProductionQr } from "../../../lib/businessVerificationCapabilities";
import {
  isEntitlementsSessionPrimed,
  sessionHasActiveEntitlements,
} from "../../../lib/subscriptionEntitlementFastPath";
import { FeatureGatePending } from "../../../components/subscription/FeatureGatePending";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";

export function QrStudioLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { user } = useRequireAuth();
  const businessContext = useBusinessEntitlementsContext();
  const fallbackEntitlements = useSubscriptionEntitlements({
    enabled: user?.role === "business" && businessContext == null,
    role: user?.role === "business" ? "business" : null,
  });
  const { ready: entitlementsReady, hasActiveEntitlements } = businessContext ?? fallbackEntitlements;

  const isPrintStudio = pathname.includes("/qr-studio/print");
  const canUseQr = canUseProductionQr(user?.onboardingVerificationStatus, Boolean(user?.impersonation));
  const entitlementsKnown = entitlementsReady || isEntitlementsSessionPrimed();
  const operationalAccess = entitlementsReady
    ? hasActiveEntitlements
    : sessionHasActiveEntitlements();

  const accessBlock = resolveQrStudioAccessBlock(
    entitlementsKnown,
    operationalAccess,
    canUseQr,
  );

  const showOutlet = entitlementsReady && accessBlock == null;
  const showPending = !entitlementsReady && accessBlock == null;

  return (
    <div className={cn("min-w-0 w-full overflow-x-clip", businessUi.modulePageShell)}>
      <div
        className={cn(
          "dashboard-page-contained mx-auto min-w-0 w-full max-w-full",
          isPrintStudio ? "max-w-7xl" : "max-w-6xl",
        )}
      >
        <BusinessModuleWorkspaceHeader
          personality="qrStudio"
          badge={t("premium.qrStudio.badge")}
          feature={
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
              {t("premium.qrStudio.feature")}
            </span>
          }
          icon={QrCode}
          title={t("business.qrStudio.title")}
          subtitle={t("business.qrStudio.subtitle")}
          hideSubtitleOnMobile
        />
        {accessBlock ? (
          <div className="py-8 sm:py-12">
            <QrStudioAccessPanel reason={accessBlock} onboardingVerificationStatus={user?.onboardingVerificationStatus} />
          </div>
        ) : showPending ? (
          <FeatureGatePending className="mx-auto max-w-2xl" />
        ) : showOutlet ? (
          <BusinessBrandingProvider canEdit>
            <Outlet />
          </BusinessBrandingProvider>
        ) : null}
      </div>
    </div>
  );
}
