import { Download, ExternalLink, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BusinessSettingsPanelShell } from "./BusinessSettingsPanelShell";
import { Button } from "@/components/ui/button";
import { CARETIP_LEGAL_LINKS, careTipLegalPdfUrl, normalizeCareTipUiLanguage } from "@/app/lib/caretipLegalLinks";
import { resolveApiBaseUrl } from "@/app/lib/apiOrigin";
import { openUrlInNewTab } from "@/app/lib/downloadBlobAsFile";

type DocRow = {
  id: "dpa" | "plv" | "terms" | "privacy";
  titleKey: string;
  descKey: string;
  viewHref: string;
  downloadHref?: string;
};

/**
 * Merchant Settings → Privacy & Legal.
 * CareTip-controlled docs (DPA/PLV) open/download on demand — no PDF fetch on dashboard boot.
 * Terms/Privacy open CareTip-hosted IT-Recht pages (third-party managed content).
 */
export function BusinessSettingsPrivacyLegalPanel() {
  const { t, i18n } = useTranslation();
  const apiBase = resolveApiBaseUrl();
  const language = normalizeCareTipUiLanguage(i18n.resolvedLanguage ?? i18n.language);

  const docs: DocRow[] = [
    {
      id: "terms",
      titleKey: "business.settings.privacyLegal.termsTitle",
      descKey: "business.settings.privacyLegal.termsDesc",
      viewHref: CARETIP_LEGAL_LINKS.terms.path,
    },
    {
      id: "privacy",
      titleKey: "business.settings.privacyLegal.privacyTitle",
      descKey: "business.settings.privacyLegal.privacyDesc",
      viewHref: CARETIP_LEGAL_LINKS.privacy.path,
    },
    {
      id: "dpa",
      titleKey: "business.settings.privacyLegal.dpaTitle",
      descKey: "business.settings.privacyLegal.dpaDesc",
      viewHref: careTipLegalPdfUrl("dpa", { apiBase, language }),
      downloadHref: careTipLegalPdfUrl("dpa", { download: true, apiBase, language }),
    },
    {
      id: "plv",
      titleKey: "business.settings.privacyLegal.plvTitle",
      descKey: "business.settings.privacyLegal.plvDesc",
      viewHref: careTipLegalPdfUrl("plv", { apiBase, language }),
      downloadHref: careTipLegalPdfUrl("plv", { download: true, apiBase, language }),
    },
  ];

  return (
    // Match General / Preferences / Notifications: page header owns title; avoid duplicate H2.
    <BusinessSettingsPanelShell embedded>
      <ul className="divide-y divide-border/60">
        {docs.map((doc) => (
          <li key={doc.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium text-foreground">{t(doc.titleKey)}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{t(doc.descKey)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openUrlInNewTab(doc.viewHref)}
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {t("business.settings.privacyLegal.view")}
              </Button>
              {doc.downloadHref ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => openUrlInNewTab(doc.downloadHref!)}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {t("business.settings.privacyLegal.download")}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </BusinessSettingsPanelShell>
  );
}
