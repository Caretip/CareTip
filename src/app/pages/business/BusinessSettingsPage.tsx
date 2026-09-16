import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { processBillingCheckoutSuccess } from "../../lib/subscriptionActivationNotification";
import { BusinessSubPageShellSkeleton } from "../../components/dashboard/BusinessSubPageShellSkeleton";
import { BusinessProfilePage } from "./BusinessProfilePage";
import {
  BUSINESS_SETTINGS_SECTIONS,
  legacySettingsSectionRedirectTarget,
  parseBusinessSettingsSection,
} from "../../components/business/settings/businessSettingsSections";
import { BusinessSettingsGeneralPanel } from "../../components/business/settings/BusinessSettingsGeneralPanel";
import { BusinessSettingsAppearancePanel } from "../../components/business/settings/BusinessSettingsAppearancePanel";
import { BusinessSettingsSecurityPanel } from "../../components/business/settings/BusinessSettingsSecurityPanel";
import { BusinessSettingsNotificationsPanel } from "../../components/business/settings/BusinessSettingsNotificationsPanel";
import { BusinessSettingsIntegrationsPanel } from "../../components/business/settings/BusinessSettingsIntegrationsPanel";
import { BusinessSettingsPrivacyLegalPanel } from "../../components/business/settings/BusinessSettingsPrivacyLegalPanel";
import { useBusinessSettingsData } from "../../components/business/settings/useBusinessSettingsData";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";
import { businessUi } from "@/app/components/business/businessDashboardUi";

export function BusinessSettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useRequireAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawSection = searchParams.get("section");
  const section = parseBusinessSettingsSection(rawSection);
  const settings = useBusinessSettingsData();

  useEffect(() => {
    const legacy = legacySettingsSectionRedirectTarget(rawSection);
    if (legacy) {
      const billing = searchParams.get("billing");
      const qs = billing ? `?billing=${billing}` : "";
      navigate(`${legacy}${qs}`, { replace: true });
    }
  }, [rawSection, searchParams, navigate]);

  useEffect(() => {
    const billing = searchParams.get("billing");
    if (!billing) return;
    if (billing === "success") {
      void processBillingCheckoutSuccess({
        t,
        sessionId: searchParams.get("session_id"),
      });
    } else if (billing === "canceled") {
      toast.message(t("business.billing.checkoutCanceled"));
    }
    navigate("/dashboard/billing/subscription", { replace: true });
  }, [searchParams, navigate, t]);

  const activeMeta = BUSINESS_SETTINGS_SECTIONS.find((s) => s.id === section)!;

  useEffect(() => {
    if (legacySettingsSectionRedirectTarget(rawSection)) return;
    if (searchParams.get("section") === section) return;
    setSearchParams({ section }, { replace: true });
  }, [section, searchParams, setSearchParams, rawSection]);

  if (!user || user.role !== "business") {
    return <BusinessSubPageShellSkeleton />;
  }

  return (
    <main className={businessUi.modulePageShell}>
      <div className={businessUi.modulePageContained}>
        <header className="mb-6 border-b border-border pb-5">
          <p className={dashboardWorkspaceUi.eyebrow}>{t("business.settings.eyebrow")}</p>
          <h1 className={dashboardWorkspaceUi.pageTitle}>{t(activeMeta.labelKey)}</h1>
          <p className={dashboardWorkspaceUi.pageDescription}>{t(activeMeta.descriptionKey)}</p>
        </header>

        <div className="min-w-0">
          {section === "general" ? <BusinessSettingsGeneralPanel {...settings} /> : null}
          {section === "appearance" ? <BusinessSettingsAppearancePanel /> : null}
          {section === "business" ? <BusinessProfilePage embedded /> : null}
          {section === "notifications" ? <BusinessSettingsNotificationsPanel {...settings} /> : null}
          {section === "security" ? <BusinessSettingsSecurityPanel {...settings} /> : null}
          {section === "integrations" ? <BusinessSettingsIntegrationsPanel /> : null}
          {section === "privacy-legal" ? <BusinessSettingsPrivacyLegalPanel /> : null}
        </div>
      </div>
    </main>
  );
}
