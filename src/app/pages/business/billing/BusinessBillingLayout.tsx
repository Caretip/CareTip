import { useEffect } from "react";
import { Outlet, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";
import "@/styles/caretip-pricing-premium.css";
import { trackGoogleAdsConversion } from "../../../lib/googleAdsConversion";
import { processBillingCheckoutSuccess } from "../../../lib/subscriptionActivationNotification";
import { BusinessModuleWorkspaceHeader } from "../../../components/business/BusinessModuleWorkspaceHeader";
import { MobileBillingHandoffBanner } from "../../../components/business/billing/MobileBillingHandoffBanner";
import { businessUi } from "@/app/components/business/businessDashboardUi";

export function BusinessBillingLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const connect = searchParams.get("connect");
    if (connect !== "return" && connect !== "refresh") return;
    navigate(`/dashboard/stripe/connect?connect=${connect}`, { replace: true });
  }, [navigate, searchParams]);

  useEffect(() => {
    const billing = searchParams.get("billing");
    if (!billing) return;
    if (billing === "success") {
      trackGoogleAdsConversion("billing_checkout_completed");
      void processBillingCheckoutSuccess({
        t,
        sessionId: searchParams.get("session_id"),
      });
    } else if (billing === "canceled") {
      toast.message(t("business.billing.checkoutCanceled"));
    }
    const next = new URLSearchParams(searchParams);
    next.delete("billing");
    next.delete("session_id");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  return (
    <div className={businessUi.modulePageShell}>
      <div className={businessUi.modulePageContained}>
        <BusinessModuleWorkspaceHeader
          personality="billing"
          badge={t("business.billing.moduleEyebrow")}
          icon={CreditCard}
          title={t("business.settings.panels.billingTitle")}
          subtitle={t("business.billing.moduleSubtitle")}
          hideSubtitleOnMobile
        />
        <MobileBillingHandoffBanner />
        <Outlet />
      </div>
    </div>
  );
}
