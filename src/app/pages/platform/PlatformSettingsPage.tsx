import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { PlatformPage, PlatformPageHeader } from "../../components/platform/PlatformPageChrome";
import { PlatformLandingAiDiagnosticsPanel } from "../../components/platform/PlatformLandingAiDiagnosticsPanel";
import { PlatformSettingsNotificationsPanel } from "../../components/platform/PlatformSettingsNotificationsPanel";
import { ThemeAppearanceControl } from "@/app/components/theme/ThemeAppearanceControl";
import { changeAppLanguage, type AppLanguage } from "@/i18n/i18n";
import { platformUi } from "../../components/platform/platformDashboardUi";
import { isAiAssistantEnabled } from "../../lib/featureFlags";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";

export function PlatformSettingsPage() {
  const { t, i18n } = useTranslation();
  const current: AppLanguage = i18n.language?.startsWith("de") ? "de" : "en";

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Settings}
        title={t("admin.platformSettingsPage.title")}
        subtitle={t("admin.platformSettingsPage.subtitle")}
      />
      <div className="space-y-6">
        {isAiAssistantEnabled() ? <PlatformLandingAiDiagnosticsPanel /> : null}
        <PlatformSettingsNotificationsPanel />

        <section className={platformUi.contentCard}>
          <h2 className={dashboardWorkspaceUi.sectionTitle}>
            {t("admin.platformSettingsPage.preferencesTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("admin.platformSettingsPage.preferencesBody")}
          </p>
          <div className="mt-5 space-y-8">
            <ThemeAppearanceControl />
            <div className="max-w-sm space-y-2 border-t border-border/70 pt-6">
              <Label htmlFor="platform-settings-language">
                {t("business.settings.language.label")}
              </Label>
              <Select
                value={current}
                onValueChange={(lng) => {
                  void changeAppLanguage(lng as AppLanguage);
                }}
              >
                <SelectTrigger id="platform-settings-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t("business.settings.language.en")}</SelectItem>
                  <SelectItem value="de">{t("business.settings.language.de")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <div className={platformUi.contentCard}>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("admin.platformSettingsPage.cardBody")}
          </p>
        </div>
      </div>
    </PlatformPage>
  );
}
