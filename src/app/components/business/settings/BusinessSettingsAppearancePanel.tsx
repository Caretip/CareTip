import { useTranslation } from "react-i18next";
import { changeAppLanguage, type AppLanguage } from "@/i18n/i18n";
import { BusinessSettingsPanelShell } from "./BusinessSettingsPanelShell";
import { ThemeAppearanceControl } from "@/app/components/theme/ThemeAppearanceControl";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";

/** Preferences — theme + language in one Settings destination. */
export function BusinessSettingsAppearancePanel() {
  const { t, i18n } = useTranslation();
  const current: AppLanguage = i18n.language?.startsWith("de") ? "de" : "en";

  return (
    <BusinessSettingsPanelShell embedded>
      <div className="space-y-8">
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">{t("theme.appearance.panelHint")}</p>
          <ThemeAppearanceControl />
        </div>

        <div className="space-y-3 border-t border-border/70 pt-6">
          <h3 className={dashboardWorkspaceUi.sectionTitle}>{t("business.settings.panels.languageTitle")}</h3>
          <p className={dashboardWorkspaceUi.helperText}>{t("business.settings.panels.languageDesc")}</p>
          <div className="max-w-sm space-y-2">
            <Label htmlFor="settings-language">{t("business.settings.language.label")}</Label>
            <Select
              value={current}
              onValueChange={(lng) => {
                void changeAppLanguage(lng as AppLanguage);
              }}
            >
              <SelectTrigger id="settings-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("business.settings.language.en")}</SelectItem>
                <SelectItem value="de">{t("business.settings.language.de")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </BusinessSettingsPanelShell>
  );
}
