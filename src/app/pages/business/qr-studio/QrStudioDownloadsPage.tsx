import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Download, FileDown, Printer, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { QR_STUDIO_GALLERY_HREF } from "../../../components/business/businessDashboardNav";

const DOWNLOAD_FORMATS = [
  { id: "png", icon: Download, labelKey: "business.qrStudio.downloads.png", descKey: "business.qrStudio.downloads.pngDesc" },
  { id: "pdf", icon: FileDown, labelKey: "business.qrStudio.downloads.pdf", descKey: "business.qrStudio.downloads.pdfDesc" },
  { id: "poster", icon: Printer, labelKey: "business.qrStudio.downloads.poster", descKey: "business.qrStudio.downloads.posterDesc" },
  { id: "tent", icon: Printer, labelKey: "business.qrStudio.downloads.tent", descKey: "business.qrStudio.downloads.tentDesc" },
  { id: "sticker", icon: Download, labelKey: "business.qrStudio.downloads.sticker", descKey: "business.qrStudio.downloads.stickerDesc" },
] as const;

const FUTURE_FORMATS = [
  { labelKey: "business.qrStudio.downloads.social" },
  { labelKey: "business.qrStudio.downloads.flyer" },
] as const;

/** Print & download formats — actions run from QR Gallery. */
export function QrStudioDownloadsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <Card className={businessUi.cardStatic}>
        <CardHeader className="border-b border-neutral-100/90">
          <CardTitle className="text-base">{t("business.qrStudio.downloads.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-3 max-lg:grid-cols-1">
          {DOWNLOAD_FORMATS.map((fmt) => (
            <div
              key={fmt.id}
              className="flex flex-col rounded-xl border border-border bg-muted/20 p-4 max-lg:rounded-none max-lg:border-x-0 max-lg:border-t-0 max-lg:bg-transparent max-lg:px-0 first:max-lg:border-t"
            >
              <fmt.icon className="mb-2 h-5 w-5 text-primary" aria-hidden />
              <h3 className="text-sm font-semibold text-foreground">{t(fmt.labelKey)}</h3>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">{t(fmt.descKey)}</p>
              <Button type="button" variant="outline" size="sm" className="mt-4" asChild>
                <Link to={QR_STUDIO_GALLERY_HREF}>{t("business.qrStudio.downloads.openGallery")}</Link>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className={`${businessUi.cardStatic} border-dashed`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            {t("business.qrStudio.downloads.futureTitle")}
          </CardTitle>
          <CardDescription className={businessUi.cardDesc}>
            {t("business.qrStudio.downloads.futureDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {FUTURE_FORMATS.map((f) => (
            <span
              key={f.labelKey}
              className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground"
            >
              {t(f.labelKey)} · {t("business.moduleNav.comingSoon")}
            </span>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
