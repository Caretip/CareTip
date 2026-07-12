import { Plug, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BusinessSettingsPanelShell } from "./BusinessSettingsPanelShell";

export function BusinessSettingsIntegrationsPanel() {
  const { t } = useTranslation();
  return (
    <BusinessSettingsPanelShell embedded>
      <div className="flex min-h-[22rem] flex-col items-center justify-center px-4 py-12 text-center sm:min-h-[26rem]">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
          <Plug className="h-7 w-7 text-primary" aria-hidden />
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.08] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
          <Sparkles className="h-3 w-3" aria-hidden />
          {t("common.comingSoonBadge")}
        </span>
        <h2 className="mt-4 font-hero-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {t("business.settings.panels.integrationsTitle")}
        </h2>
        <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {t("business.settings.integrations.comingSoon")}
        </p>
        <p className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
          {t("common.comingSoonInDevelopment")}
        </p>
      </div>
    </BusinessSettingsPanelShell>
  );
}
