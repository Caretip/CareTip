import { Check, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { UpgradeCta } from "../../subscription/UpgradeCta";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";
import { cn } from "@/lib/utils";

export const DASHBOARD_PREMIUM_SECTION_ID = "dashboard-premium-features";

const PREMIUM_FEATURE_KEYS = [
  "business.dashboard.preview.features.customerFeedback",
  "business.dashboard.preview.features.employeeGoals",
  "business.dashboard.preview.features.advancedAnalytics",
  "business.dashboard.preview.features.qrBranding",
  "business.dashboard.preview.features.qrTemplates",
  "business.dashboard.preview.features.unlimitedLocations",
  "business.dashboard.preview.features.unlimitedTables",
] as const;

type DashboardPremiumFeaturesSectionProps = {
  className?: string;
};

/** Upgrade section for legacy no-entitlement preview dashboards — Pro feature highlights. */
export function DashboardPremiumFeaturesSection({ className }: DashboardPremiumFeaturesSectionProps) {
  const { t } = useTranslation();

  return (
    <section
      id={DASHBOARD_PREMIUM_SECTION_ID}
      className={cn(dashboardWorkspaceUi.card, dashboardWorkspaceUi.cardPad, className)}
      aria-labelledby="dashboard-premium-features-title"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-2xl space-y-4">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {t("business.dashboard.preview.premiumEyebrow")}
            </span>
          </div>
          <div className="space-y-2">
            <h2
              id="dashboard-premium-features-title"
              className={dashboardWorkspaceUi.sectionTitle}
            >
              {t("business.dashboard.preview.premiumTitle")}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              {t("business.dashboard.preview.premiumLead")}
            </p>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("business.dashboard.preview.premiumIncludes")}
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {PREMIUM_FEATURE_KEYS.map((key) => (
                <li key={key} className="flex items-start gap-2.5 text-sm text-foreground/90">
                  <Check className="caretip-feature-check mt-0.5 shrink-0" strokeWidth={2.75} aria-hidden />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-3 lg:pt-2">
          <UpgradeCta featureKey="advancedAnalytics" className="w-full min-w-[200px] sm:w-auto" />
        </div>
      </div>
    </section>
  );
}
