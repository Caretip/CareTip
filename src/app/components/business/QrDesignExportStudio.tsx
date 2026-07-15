import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Palette, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import type { QrBrandingOptions } from "../../lib/businessBranding";
import {
  customizationFromBaseBranding,
  DEFAULT_QR_EXPORT_CUSTOMIZATION,
  mergeQrBrandingForExport,
  QR_EXPORT_DESIGN_FILE_EXT,
  readQrExportDesignFile,
  type QrExportCustomization,
} from "../../lib/qrDesignExport";
import { renderBrandedQrUrlToDataUrl } from "../../lib/qrBranded";
import {
  DEFAULT_QR_TEMPLATE,
  QR_BORDER_STYLE_IDS,
  QR_SHAPE_IDS,
  normalizeQrTemplateId,
  type QrBorderStyleId,
  type QrShapeId,
  type QrTemplateId,
} from "../../lib/qrTemplateStyles";
import { QrTemplatePicker } from "./settings/QrTemplatePicker";
import { UpgradeCta } from "../subscription/UpgradeCta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { toUserFriendlyMessage } from "../../lib/errorMessages";

type QrDesignExportStudioProps = {
  baseBranding: QrBrandingOptions;
  sampleQrUrl: string;
  businessName: string;
  canCustomize: boolean;
};

export function QrDesignExportStudio({
  baseBranding,
  sampleQrUrl,
  businessName,
  canCustomize,
}: QrDesignExportStudioProps) {
  const { t } = useTranslation();
  const importInputId = useId();

  const [customization, setCustomization] = useState<QrExportCustomization>(() =>
    customizationFromBaseBranding(baseBranding),
  );
  const [presetName, setPresetName] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const effectiveBranding = useMemo(
    () => mergeQrBrandingForExport(baseBranding, customization),
    [baseBranding, customization],
  );

  const refreshPreview = useCallback(async () => {
    if (!sampleQrUrl.trim()) return;
    setPreviewLoading(true);
    try {
      const dataUrl = await renderBrandedQrUrlToDataUrl(sampleQrUrl, effectiveBranding, { scale: 1 });
      setPreviewUrl(dataUrl);
    } catch {
      setPreviewUrl("");
    } finally {
      setPreviewLoading(false);
    }
  }, [sampleQrUrl, effectiveBranding]);

  useEffect(() => {
    void refreshPreview();
  }, [refreshPreview]);

  const patch = (next: Partial<QrExportCustomization>) => {
    setCustomization((prev) => ({ ...prev, ...next }));
  };

  const handleReset = () => {
    setCustomization(customizationFromBaseBranding(baseBranding));
    setPresetName("");
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = await readQrExportDesignFile(file);
      setCustomization(parsed.customization);
      setPresetName(parsed.presetName);
    } catch (err) {
      toast.error(toUserFriendlyMessage(err));
    }
  };

  const accent = customization.qrAccentColor ?? effectiveBranding.qrAccentColor ?? effectiveBranding.primaryColor;
  const background =
    customization.qrBackgroundColor ??
    effectiveBranding.qrBackgroundColor ??
    DEFAULT_QR_EXPORT_CUSTOMIZATION.qrBackgroundColor;

  return (
    <Card className={businessUi.cardStatic}>
      <CardHeader className="border-b border-neutral-100/90">
        <CardTitle className="text-base">{t("business.qrPage.designStudio.title")}</CardTitle>
        <CardDescription className={businessUi.cardDesc}>
          {t("business.qrPage.designStudio.description")}
        </CardDescription>
        {!canCustomize ? (
          <div className="pt-2">
            <UpgradeCta featureKey="brandingCustomization" />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="flex flex-wrap gap-2">
          <input
            id={importInputId}
            type="file"
            accept={`application/json,${QR_EXPORT_DESIGN_FILE_EXT}`}
            className="sr-only"
            onChange={(e) => void handleImport(e)}
          />
          <Button type="button" variant="default" size="sm" asChild={canCustomize}>
            <label htmlFor={canCustomize ? importInputId : undefined} className={canCustomize ? "cursor-pointer" : ""}>
              <Upload className="mr-2 h-4 w-4" />
              {t("business.qrPage.designStudio.importDesign")}
            </label>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={handleReset} disabled={!canCustomize}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t("business.qrPage.designStudio.reset")}
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="import-preset-name">{t("business.qrPage.designStudio.presetName")}</Label>
              <Input
                id="import-preset-name"
                value={presetName}
                readOnly
                placeholder={t("business.qrPage.designStudio.presetNamePlaceholder")}
                className="bg-muted/40"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="import-display-name">{t("business.qrPage.designStudio.displayName")}</Label>
                <Input
                  id="import-display-name"
                  value={customization.displayName ?? ""}
                  onChange={(e) => patch({ displayName: e.target.value })}
                  placeholder={businessName}
                  maxLength={80}
                  disabled={!canCustomize}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="import-tagline">{t("business.qrPage.designStudio.tagline")}</Label>
                <Input
                  id="import-tagline"
                  value={customization.tagline ?? ""}
                  onChange={(e) => patch({ tagline: e.target.value })}
                  maxLength={120}
                  disabled={!canCustomize}
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-foreground">
                {t("business.qrPage.designStudio.templateSection")}
              </p>
              <QrTemplatePicker
                value={normalizeQrTemplateId(customization.qrTemplate) as QrTemplateId}
                onChange={(template) => patch({ qrTemplate: template })}
                canEdit={canCustomize}
                accentColor={accent}
                backgroundColor={background ?? "#FFFFFF"}
                displayName={customization.displayName?.trim() || businessName}
                tagline={customization.tagline}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="import-border">{t("business.qrPage.designStudio.border")}</Label>
                <Select
                  value={customization.qrBorderStyle ?? "rounded"}
                  onValueChange={(v) => patch({ qrBorderStyle: v as QrBorderStyleId })}
                  disabled={!canCustomize}
                >
                  <SelectTrigger id="import-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QR_BORDER_STYLE_IDS.map((id) => (
                      <SelectItem key={id} value={id}>
                        {t(`business.branding.qrBorders.${id}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="import-shape">{t("business.qrPage.designStudio.shape")}</Label>
                <Select
                  value={customization.qrShape ?? "square"}
                  onValueChange={(v) => patch({ qrShape: v as QrShapeId })}
                  disabled={!canCustomize}
                >
                  <SelectTrigger id="import-shape">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QR_SHAPE_IDS.map((id) => (
                      <SelectItem key={id} value={id}>
                        {t(`business.branding.qrShapes.${id}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="import-accent" className="flex items-center gap-1.5">
                  <Palette className="h-3.5 w-3.5" aria-hidden />
                  {t("business.qrPage.designStudio.accent")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="import-accent"
                    type="color"
                    value={accent}
                    onChange={(e) => patch({ qrAccentColor: e.target.value.toUpperCase() })}
                    className="h-10 w-14 shrink-0 cursor-pointer p-1"
                    disabled={!canCustomize}
                  />
                  <Input
                    value={accent}
                    onChange={(e) => patch({ qrAccentColor: e.target.value.toUpperCase() })}
                    maxLength={7}
                    className="font-mono text-sm"
                    disabled={!canCustomize}
                  />
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{t("business.qrPage.designStudio.importOnlyHint")}</p>
          </div>

          <div className="flex flex-col items-center gap-3">
            <div
              className={cn(
                "flex min-h-[12rem] w-full items-center justify-center rounded-xl border border-border bg-muted/20 p-3",
                previewLoading && "opacity-70",
              )}
            >
              {previewLoading ? (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
              ) : previewUrl ? (
                <img src={previewUrl} alt="" className="max-h-56 w-full object-contain" />
              ) : (
                <span className="text-xs text-muted-foreground">{t("business.qrPage.toastQrNotReady")}</span>
              )}
            </div>
            <p className="text-center text-[11px] text-muted-foreground">
              {t("business.qrPage.designStudio.previewCaption")}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
