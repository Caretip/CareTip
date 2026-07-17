import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Brush,
  Download,
  FileImage,
  Loader2,
  Pencil,
  Palette,
  QrCode,
  Save,
  Sparkles,
  Type,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useQrStudioDesign } from "../../hooks/useQrStudioDesign";
import { QrTemplatePicker } from "./settings/QrTemplatePicker";
import { QrReliabilityScore } from "./QrReliabilityScore";
import { UpgradeCta } from "../subscription/UpgradeCta";
import {
  downloadQrDataUrlPng,
  isQrExportAllowed,
  renderBrandedQrUrlToDataUrl,
  type QrReliabilityReport,
} from "../../lib/qrBranded";
import {
  QR_LAYOUT_VARIANT_IDS,
  type QrLayoutVariantId,
} from "../../lib/qrDesignSystem";
import {
  QR_BORDER_STYLE_IDS,
  QR_SHAPE_IDS,
  normalizeQrTemplateId,
  type QrBorderStyleId,
  type QrShapeId,
  type QrTemplateId,
} from "../../lib/qrTemplateStyles";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Switch } from "@/app/components/ui/switch";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { BusinessLogoMark } from "./BusinessLogoMark";
import { resolveMediaUrl } from "../../lib/mediaUrl";

const LOGO_MAX = 5 * 1024 * 1024;

type StudioSection = "design" | "branding" | "qr" | "content" | "export";

const SECTIONS: Array<{ id: StudioSection; icon: typeof Brush; labelKey: string }> = [
  { id: "design", icon: Brush, labelKey: "business.qrStudio.design.sections.design" },
  { id: "branding", icon: Palette, labelKey: "business.qrStudio.design.sections.branding" },
  { id: "qr", icon: QrCode, labelKey: "business.qrStudio.design.sections.qr" },
  { id: "content", icon: Type, labelKey: "business.qrStudio.design.sections.content" },
  { id: "export", icon: Download, labelKey: "business.qrStudio.design.sections.export" },
];

type QrStudioDesignerProps = {
  businessId: string | null | undefined;
  businessName: string;
  canEdit: boolean;
};

export function QrStudioDesigner({ businessId, businessName, canEdit }: QrStudioDesignerProps) {
  const { t } = useTranslation();
  const logoInputId = useId();
  const studio = useQrStudioDesign({ businessId, businessName, canEdit });

  const [section, setSection] = useState<StudioSection>("design");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [reliabilityReport, setReliabilityReport] = useState<QrReliabilityReport | null>(null);
  const [editingVenueName, setEditingVenueName] = useState(false);
  const venueNameInputRef = useRef<HTMLInputElement>(null);

  const refreshPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const scale =
        typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? 1 : 2;
      const dataUrl = await renderBrandedQrUrlToDataUrl(studio.sampleUrl, studio.previewBranding, {
        scale,
      });
      setPreviewUrl(dataUrl);
    } catch {
      setPreviewUrl("");
    } finally {
      setPreviewLoading(false);
    }
  }, [studio.sampleUrl, studio.previewBranding]);

  useEffect(() => {
    void refreshPreview();
  }, [refreshPreview]);

  const handleSave = async () => {
    const ok = await studio.save();
    if (!ok) toast.error(t("business.branding.toastSaveError"));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !canEdit) return;
    if (file.size > LOGO_MAX) {
      toast.error(t("business.branding.toastLogoSize"));
      return;
    }
    try {
      await studio.uploadLogo(file);
    } catch (err) {
      toast.error(toUserFriendlyMessage(err));
    }
  };

  const exportAllowed = reliabilityReport ? isQrExportAllowed(reliabilityReport) : false;

  const handleExportPng = () => {
    if (!previewUrl) return;
    const name = studio.previewBranding.businessName.replace(/\s+/g, "-").toLowerCase();
    downloadQrDataUrlPng(previewUrl, `caretip-${name}-experience.png`, { exportAllowed });
    if (!exportAllowed) toast.error(t("business.qrReliability.exportBlocked"));
  };

  if (studio.loading) {
    return (
      <div className={cn(businessUi.cardStatic, "flex min-h-[320px] items-center justify-center")}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const logoUrl = studio.settings?.logoPath ? resolveMediaUrl(studio.settings.logoPath) : null;
  const activeSection = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const ActiveSectionIcon = activeSection.icon;

  return (
    <div className="qr-studio-designer min-w-0 w-full max-w-full space-y-5 overflow-x-clip sm:space-y-6">
      <header className="min-w-0 space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          {t("business.qrStudio.design.title")}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("business.qrStudio.design.subtitle")}</p>
      </header>

      {!canEdit ? (
        <div className="min-w-0">
          <UpgradeCta featureKey="brandingCustomization" className="w-full" />
        </div>
      ) : null}

      <div className="grid min-w-0 w-full grid-cols-1 gap-5 auto-rows-auto lg:gap-6 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <aside className="order-2 row-start-2 flex min-w-0 flex-col gap-3 xl:order-1 xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("business.qrStudio.design.stepsLabel")}
            </p>
            <nav
              className="flex max-w-full gap-1.5 overflow-x-auto pb-1 snap-x snap-mandatory scroll-px-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:flex-col xl:overflow-visible xl:pb-0"
              aria-label={t("business.qrStudio.design.navAria")}
            >
            {SECTIONS.map(({ id, icon: Icon, labelKey }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "flex min-h-[44px] shrink-0 touch-manipulation items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors xl:shrink xl:min-h-0",
                  section === id
                    ? "border-primary/40 bg-primary/[0.06] text-foreground"
                    : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {t(labelKey)}
              </button>
            ))}
            </nav>
          </div>

          <Card className={cn(businessUi.cardStatic, "min-w-0 overflow-hidden")}>
            <CardHeader className="space-y-1 border-b border-neutral-100/90 px-4 pb-3 pt-4 sm:px-6">
              <div className="flex items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ActiveSectionIcon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <CardTitle className="text-base">{t(activeSection.labelKey)}</CardTitle>
                  <CardDescription className={cn(businessUi.cardDesc, "mt-1")}>
                    {t(`business.qrStudio.design.sectionHints.${section}`)}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-6">
              {section === "design" ? (
                <>
                  <div>
                    <p className="mb-2 text-sm font-medium">{t("business.qrStudio.design.template")}</p>
                    <QrTemplatePicker
                      value={normalizeQrTemplateId(studio.qrTemplate) as QrTemplateId}
                      onChange={studio.setQrTemplate}
                      canEdit={canEdit}
                      accentColor={studio.qrAccentColor}
                      backgroundColor={studio.qrBackgroundColor}
                      displayName={studio.previewBranding.businessName}
                      tagline={studio.previewBranding.brandTagline}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="layout-variant">{t("business.qrStudio.design.layout")}</Label>
                    <Select
                      value={studio.extras.layoutVariant}
                      onValueChange={(v) => studio.setLayoutVariant(v as QrLayoutVariantId)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger id="layout-variant">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QR_LAYOUT_VARIANT_IDS.map((id) => (
                          <SelectItem key={id} value={id}>
                            {t(`business.qrStudio.design.layouts.${id}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="ds-accent">{t("business.qrStudio.design.accent")}</Label>
                      <Input
                        id="ds-accent"
                        type="color"
                        value={studio.qrAccentColor}
                        onChange={(e) => studio.setQrAccentColor(e.target.value.toUpperCase())}
                        className="h-10 cursor-pointer p-1"
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ds-bg">{t("business.qrStudio.design.background")}</Label>
                      <Input
                        id="ds-bg"
                        type="color"
                        value={studio.qrBackgroundColor}
                        onChange={(e) => studio.setQrBackgroundColor(e.target.value.toUpperCase())}
                        className="h-10 cursor-pointer p-1"
                        disabled={!canEdit}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border/80 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{t("business.qrStudio.design.decorations")}</p>
                      <p className="text-xs text-muted-foreground">{t("business.qrStudio.design.decorationsHint")}</p>
                    </div>
                    <Switch
                      checked={studio.extras.decorationsEnabled}
                      onCheckedChange={(v: boolean) => studio.patchExtras({ decorationsEnabled: v })}
                      disabled={!canEdit}
                    />
                  </div>
                </>
              ) : null}

              {section === "branding" ? (
                <>
                  <div className="flex items-center gap-3">
                    <BusinessLogoMark
                      logoPathOrUrl={logoUrl}
                      businessName={businessName}
                      className="h-14 w-14 rounded-xl"
                    />
                    <div className="space-y-1">
                      <input
                        id={logoInputId}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        onChange={(e) => void handleLogoUpload(e)}
                      />
                      <Button type="button" variant="outline" size="sm" asChild={canEdit}>
                        <label htmlFor={canEdit ? logoInputId : undefined} className={canEdit ? "cursor-pointer" : ""}>
                          <Upload className="mr-2 h-4 w-4" />
                          {t("business.branding.uploadLogo")}
                        </label>
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-3 rounded-2xl border border-orange-200/70 bg-[linear-gradient(180deg,rgb(255_247_237)_0%,rgb(255_255_255)_100%)] p-4 shadow-sm dark:border-orange-900/40 dark:bg-[linear-gradient(180deg,rgb(67_32_11_/_0.28)_0%,rgb(24_24_27)_100%)] sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Label htmlFor="brand-name" className="text-[13px] font-semibold tracking-wide text-foreground">
                          {t("business.qrStudio.design.venueNameLabel")}
                        </Label>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {t("business.qrStudio.design.venueNameHint")}
                        </p>
                      </div>
                      {canEdit && !editingVenueName ? (
                        <Button
                          type="button"
                          size="sm"
                          className="h-9 shrink-0 gap-1.5 rounded-lg bg-[#e9781c] px-3.5 text-sm font-semibold text-white shadow-sm hover:bg-[#d96a14]"
                          onClick={() => {
                            setEditingVenueName(true);
                            requestAnimationFrame(() => venueNameInputRef.current?.focus());
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          {t("business.qrStudio.design.editVenueName")}
                        </Button>
                      ) : null}
                    </div>
                    {editingVenueName || !canEdit ? (
                      <div className="space-y-2.5">
                        <Input
                          ref={venueNameInputRef}
                          id="brand-name"
                          value={studio.brandDisplayName}
                          onChange={(e) => studio.setBrandDisplayName(e.target.value)}
                          placeholder={businessName}
                          maxLength={80}
                          disabled={!canEdit}
                          className="h-11 rounded-xl border-orange-200/80 bg-white text-base font-semibold shadow-sm dark:border-orange-900/50 dark:bg-zinc-950"
                        />
                        {canEdit ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              className="h-9 rounded-lg bg-[#e9781c] px-3.5 font-semibold text-white hover:bg-[#d96a14]"
                              onClick={() => setEditingVenueName(false)}
                            >
                              {t("business.qrStudio.design.doneEditingVenueName")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-9 rounded-lg font-medium"
                              onClick={() => {
                                studio.setBrandDisplayName(businessName);
                                setEditingVenueName(false);
                              }}
                            >
                              {t("business.qrStudio.design.resetVenueName")}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="truncate text-lg font-semibold tracking-tight text-foreground">
                        {studio.brandDisplayName.trim() || businessName}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brand-address">{t("business.qrStudio.design.address")}</Label>
                    <Input
                      id="brand-address"
                      value={studio.registeredAddress}
                      onChange={(e) => studio.setRegisteredAddress(e.target.value)}
                      placeholder={t("business.qrStudio.design.addressPlaceholder")}
                      maxLength={200}
                      disabled={!canEdit}
                    />
                    <p className="text-xs text-muted-foreground">{t("business.qrStudio.design.addressHint")}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border/80 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{t("business.qrStudio.design.showAddress")}</p>
                      <p className="text-xs text-muted-foreground">{t("business.qrStudio.design.showAddressHint")}</p>
                    </div>
                    <Switch
                      checked={studio.extras.templateFieldVisibility.address !== false}
                      onCheckedChange={(v: boolean) => studio.setTemplateFieldVisible("address", v)}
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brand-tagline">{t("business.qrStudio.design.tagline")}</Label>
                    <Input
                      id="brand-tagline"
                      value={studio.brandTagline}
                      onChange={(e) => studio.setBrandTagline(e.target.value)}
                      maxLength={120}
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="brand-website">{t("business.qrStudio.design.website")}</Label>
                    <Input
                      id="brand-website"
                      value={studio.extras.websiteUrl}
                      onChange={(e) => studio.patchExtras({ websiteUrl: e.target.value })}
                      placeholder="https://"
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="social-ig">{t("business.qrStudio.design.instagram")}</Label>
                      <Input
                        id="social-ig"
                        value={studio.extras.socialInstagram}
                        onChange={(e) => studio.patchExtras({ socialInstagram: e.target.value })}
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="social-fb">{t("business.qrStudio.design.facebook")}</Label>
                      <Input
                        id="social-fb"
                        value={studio.extras.socialFacebook}
                        onChange={(e) => studio.patchExtras({ socialFacebook: e.target.value })}
                        disabled={!canEdit}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border/80 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{t("business.qrStudio.design.headerLogo")}</p>
                      <p className="text-xs text-muted-foreground">{t("business.qrStudio.design.headerLogoHint")}</p>
                    </div>
                    <Switch
                      checked={studio.extras.showVenueLogoHeader}
                      onCheckedChange={(v: boolean) => studio.patchExtras({ showVenueLogoHeader: v })}
                      disabled={!canEdit}
                    />
                  </div>
                </>
              ) : null}

              {section === "qr" ? (
                <>
                  <div className="space-y-2">
                    <Label>{t("business.qrStudio.design.qrSize")}</Label>
                    <p className="text-xs text-muted-foreground">{t("business.qrStudio.design.qrSizeHint")}</p>
                    <Select
                      value={studio.extras.layoutVariant}
                      onValueChange={(v) => studio.setLayoutVariant(v as QrLayoutVariantId)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QR_LAYOUT_VARIANT_IDS.map((id) => (
                          <SelectItem key={id} value={id}>
                            {t(`business.qrStudio.design.layouts.${id}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="qr-shape">{t("business.qrPage.designStudio.shape")}</Label>
                    <Select
                      value={studio.qrShape}
                      onValueChange={(v) => studio.setQrShape(v as QrShapeId)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger id="qr-shape">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QR_SHAPE_IDS.filter((id) => id !== "circle").map((id) => (
                          <SelectItem key={id} value={id}>
                            {t(`business.branding.qrShapes.${id}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t("business.qrStudio.design.scanSafeHint")}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="qr-border">{t("business.qrPage.designStudio.border")}</Label>
                    <Select
                      value={studio.qrBorderStyle}
                      onValueChange={(v) => studio.setQrBorderStyle(v as QrBorderStyleId)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger id="qr-border">
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
                </>
              ) : null}

              {section === "content" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="welcome">{t("business.branding.welcomeLabel")}</Label>
                    <Textarea
                      id="welcome"
                      value={studio.welcomeMessage}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                        studio.setWelcomeMessage(e.target.value)
                      }
                      maxLength={120}
                      rows={2}
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cta">{t("business.qrStudio.design.cta")}</Label>
                    <Input
                      id="cta"
                      value={studio.extras.ctaText}
                      onChange={(e) => studio.patchExtras({ ctaText: e.target.value })}
                      maxLength={40}
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="thankyou">{t("business.branding.thankYouLabel")}</Label>
                    <Textarea
                      id="thankyou"
                      value={studio.thankYouMessage}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                        studio.setThankYouMessage(e.target.value)
                      }
                      maxLength={250}
                      rows={3}
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="promo">{t("business.qrStudio.design.promo")}</Label>
                    <Input
                      id="promo"
                      value={studio.brandTagline}
                      onChange={(e) => studio.setBrandTagline(e.target.value)}
                      maxLength={120}
                      disabled={!canEdit}
                    />
                  </div>
                </>
              ) : null}

              {section === "export" ? (
                <>
                  <p className="text-sm text-muted-foreground">{t("business.qrStudio.design.exportDesc")}</p>
                  <div className="grid gap-2">
                    <Button type="button" variant="outline" onClick={handleExportPng} disabled={!previewUrl}>
                      <FileImage className="mr-2 h-4 w-4" />
                      {t("business.qrStudio.downloads.png")}
                    </Button>
                    {QR_LAYOUT_VARIANT_IDS.map((id) => (
                      <Button
                        key={id}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="justify-start"
                        disabled={!canEdit}
                        onClick={() => studio.setLayoutVariant(id)}
                      >
                        <Sparkles className="mr-2 h-3.5 w-3.5 text-primary" />
                        {t(`business.qrStudio.design.layouts.${id}`)}
                      </Button>
                    ))}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </aside>

        <main className="order-1 row-start-1 min-w-0 w-full max-w-full xl:col-start-2 xl:row-start-1">
          <Card className={cn(businessUi.cardStatic, "min-w-0 overflow-hidden")}>
            <CardHeader className="border-b border-neutral-100/90 px-4 pb-3 pt-4 sm:px-6">
              <CardTitle className="text-base">{t("business.qrStudio.design.canvasTitle")}</CardTitle>
              <CardDescription className={businessUi.cardDesc}>
                {t("business.qrStudio.design.canvasDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex w-full min-w-0 items-center justify-center overflow-hidden bg-muted/20 p-2 sm:p-4 lg:p-6">
              <div className="qr-studio-canvas-frame flex w-full max-w-full min-w-0 items-center justify-center">
                {previewLoading ? (
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
                ) : previewUrl ? (
                  <img
                    src={previewUrl}
                    alt=""
                    className="block h-auto max-h-[min(70vh,520px)] w-full max-w-full object-contain rounded-xl shadow-lg ring-1 ring-black/5"
                  />
                ) : (
                  <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                    {t("business.qrPage.toastQrNotReady")}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </main>

        <section
          className="order-3 row-start-3 min-w-0 xl:col-start-2 xl:row-start-2"
          aria-label={t("business.qrReliability.title")}
        >
          <QrReliabilityScore
            sampleUrl={studio.sampleUrl}
            branding={studio.previewBranding}
            onReportChange={setReliabilityReport}
          />
        </section>
      </div>

      <footer
        className={cn(
          businessUi.cardStatic,
          "border border-primary/15 bg-gradient-to-br from-muted/30 via-background to-primary/[0.04] p-4 sm:p-5",
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("business.qrStudio.design.saveFooterTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("business.qrStudio.design.saveFooterDesc")}</p>
          </div>
          <Button
            type="button"
            className={cn(businessUi.btnPrimary, "h-11 min-h-11 w-full shrink-0 px-6 sm:w-auto")}
            onClick={() => void handleSave()}
            disabled={!canEdit || studio.saving}
          >
            {studio.saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="mr-2 h-4 w-4" aria-hidden />
            )}
            {t("business.branding.save")}
          </Button>
        </div>
      </footer>
    </div>
  );
}
