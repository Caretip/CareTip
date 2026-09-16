import { useTranslation } from "react-i18next";
import { Download, ExternalLink, FileText } from "lucide-react";
import { PublicLegalPageShell } from "@/components/public/PublicLegalPageShell";
import { Button } from "@/components/ui/button";
import { careTipLegalPdfUrl, normalizeCareTipUiLanguage } from "@/app/lib/caretipLegalLinks";
import { resolveApiBaseUrl } from "@/app/lib/apiOrigin";
import { openUrlInNewTab } from "@/app/lib/downloadBlobAsFile";

type Kind = "dpa" | "plv";

function ControlledLegalPdfPage({ kind }: { kind: Kind }) {
  const { t, i18n } = useTranslation();
  const language = normalizeCareTipUiLanguage(i18n.resolvedLanguage ?? i18n.language);
  const base = resolveApiBaseUrl();
  const viewUrl = careTipLegalPdfUrl(kind, { apiBase: base, language });
  const downloadUrl = careTipLegalPdfUrl(kind, { download: true, apiBase: base, language });
  const titleKey = kind === "dpa" ? "legal.dpaTitle" : "legal.plvTitle";
  const blurbKey = kind === "dpa" ? "legal.dpaBlurb" : "legal.plvBlurb";

  return (
    <PublicLegalPageShell title={t(titleKey)} subtitle={t(blurbKey)}>
      <div className="mx-auto flex max-w-2xl flex-col gap-6 py-2">
        <div className="flex items-start gap-3 text-muted-foreground">
          <FileText className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p className="text-sm leading-relaxed">{t(blurbKey)}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => openUrlInNewTab(viewUrl)}>
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
            {t("legal.viewPdf")}
          </Button>
          <Button type="button" variant="outline" onClick={() => openUrlInNewTab(downloadUrl)}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            {t("legal.downloadPdf")}
          </Button>
        </div>
      </div>
    </PublicLegalPageShell>
  );
}

export function AvvDpaPage() {
  return <ControlledLegalPdfPage kind="dpa" />;
}

export function PlvPage() {
  return <ControlledLegalPdfPage kind="plv" />;
}
