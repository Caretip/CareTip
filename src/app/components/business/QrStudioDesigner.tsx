import { useCallback, useEffect, useId, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import {
  Brush,
  Download,
  Eye,
  FileImage,
  Loader2,
  Pencil,
  Palette,
  Save,
  Type,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useQrStudioDesign } from "../../hooks/useQrStudioDesign";
import { QrReliabilityScore } from "./QrReliabilityScore";
import { UpgradeCta } from "../subscription/UpgradeCta";
import {
  downloadQrDataUrlPng,
  isQrExportAllowed,
  renderBrandedQrUrlToDataUrl,
  type QrReliabilityReport,
} from "../../lib/qrBranded";
import { QR_STUDIO_PREVIEW_DEBOUNCE_MS } from "../../lib/qrStudioPerformance";
import {
  type QrLogoAlignment,
  type QrLogoOrientation,
  type QrLogoPadding,
  type QrLogoSize,
} from "../../lib/qrDesignSystem";
import {
  normalizeQrTemplateId,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { BusinessLogoMark } from "./BusinessLogoMark";
import { resolveMediaUrl } from "../../lib/mediaUrl";

const QrTemplatePicker = lazy(() =>
  import("./settings/QrTemplatePicker").then((m) => ({ default: m.QrTemplatePicker })),
);

const LOGO_MAX = 5 * 1024 * 1024;

const LOGO_SIZES: QrLogoSize[] = ["small", "medium", "large"];
const LOGO_ORIENTATIONS: QrLogoOrientation[] = ["landscape", "portrait", "square"];
const LOGO_ALIGNMENTS: QrLogoAlignment[] = ["center", "top"];
const LOGO_PADDINGS: QrLogoPadding[] = ["tight", "balanced", "generous"];

type StudioSection = "design" | "branding" | "content" | "export";

const SECTIONS: Array<{ id: StudioSection; icon: typeof Brush; labelKey: string }> = [
  { id: "design", icon: Brush, labelKey: "business.qrStudio.design.sections.design" },
  { id: "branding", icon: Palette, labelKey: "business.qrStudio.design.sections.branding" },
  { id: "content", icon: Type, labelKey: "business.qrStudio.design.sections.content" },
  { id: "export", icon: Download, labelKey: "business.qrStudio.design.sections.export" },
];

type QrStudioDesignerProps = {
  businessId: string | null | undefined;
  businessName: string;
  canEdit: boolean;
  /** Which studio step to open (e.g. branding route → `"branding"`). */
  initialSection?: StudioSection;
};

function isStudioSection(value: string | null | undefined): value is StudioSection {
  return value === "design" || value === "branding" || value === "content" || value === "export";
}

export function QrStudioDesigner({
  businessId,
  businessName,
  canEdit,
  initialSection = "design",
}: QrStudioDesignerProps) {
  const { t } = useTranslation();
  const logoInputId = useId();
  const studio = useQrStudioDesign({ businessId, businessName, canEdit });
  const sectionPanelRef = useRef<HTMLDivElement>(null);

  const [section, setSection] = useState<StudioSection>(initialSection);
  const [previewUrl, setPreviewUrl] = useState("");
  const [inspectionUrl, setInspectionUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [livePreviewOpen, setLivePreviewOpen] = useState(false);
  const [reliabilityReport, setReliabilityReport] = useState<QrReliabilityReport | null>(null);
  const [editingVenueName, setEditingVenueName] = useState(false);
  const venueNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isStudioSection(initialSection)) return;
    setSection(initialSection);
  }, [initialSection]);

  const selectSection = useCallback((id: StudioSection) => {
    setSection(id);
    window.requestAnimationFrame(() => {
      sectionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  useEffect(() => {
    if (initialSection !== "branding") return;
    const timer = window.setTimeout(() => {
      sectionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [initialSection, studio.loading]);

  const previewRenderScale = useCallback((): 1 | 2 | 3 | 4 => {
    if (typeof window === "undefined") return 3;
    const dpr = Math.round(window.devicePixelRatio || 1);
    return Math.min(4, Math.max(2, dpr)) as 2 | 3 | 4;
  }, []);

  const previewBrandingFingerprint = useMemo(
    () => `ssot:v${studio.snapshot.version}`,
    [studio.snapshot.version],
  );

  const handleReliabilityReport = useCallback((report: QrReliabilityReport | null) => {
    setReliabilityReport(report);
  }, []);

  useEffect(() => {
    if (studio.loading) return;
    let cancelled = false;
    setPreviewLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const dataUrl = await renderBrandedQrUrlToDataUrl(studio.sampleUrl, studio.snapshot.branding, {
            scale: previewRenderScale(),
          });
          if (!cancelled) setPreviewUrl(dataUrl);
        } catch {
          if (!cancelled) setPreviewUrl("");
        } finally {
          if (!cancelled) setPreviewLoading(false);
        }
      })();
    }, QR_STUDIO_PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [studio.loading, studio.sampleUrl, studio.snapshot.branding, previewBrandingFingerprint, previewRenderScale]);

  const refreshInspectionPreview = useCallback(async () => {
    setInspectionLoading(true);
    try {
      const dataUrl = await renderBrandedQrUrlToDataUrl(studio.sampleUrl, studio.snapshot.branding, {
        scale: 4,
      });
      setInspectionUrl(dataUrl);
    } catch {
      setInspectionUrl("");
    } finally {
      setInspectionLoading(false);
    }
  }, [studio.sampleUrl, studio.snapshot.branding]);

  useEffect(() => {
    if (!livePreviewOpen) return;
    void refreshInspectionPreview();
  }, [livePreviewOpen, refreshInspectionPreview]);

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

  const handleExportPng = async () => {
    try {
      const dataUrl = await renderBrandedQrUrlToDataUrl(studio.sampleUrl, studio.snapshot.branding, {
        scale: 4,
      });
      if (!dataUrl) return;
      const name = studio.snapshot.branding.businessName.replace(/\s+/g, "-").toLowerCase();
      downloadQrDataUrlPng(dataUrl, `caretip-${name}-experience.png`, { exportAllowed });
      if (!exportAllowed) toast.error(t("business.qrReliability.exportBlocked"));
    } catch {
      toast.error(t("business.qrPage.toastQrNotReady"));
    }
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
                onClick={() => selectSection(id)}
                className={cn(
                  "flex min-h-[44px] shrink-0 touch-manipulation items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors xl:shrink xl:min-h-0",
                  section === id
                    ? "border-primary/40 bg-primary/[0.06] text-foreground"
                    : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
                aria-current={section === id ? "page" : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {t(labelKey)}
              </button>
            ))}
            </nav>
          </div>

          <div
            ref={sectionPanelRef}
            id={`qr-studio-section-${section}`}
            className="min-w-0 scroll-mt-24"
          >
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
            <CardContent
              className={cn(
                "p-4 sm:p-6",
                section === "branding" || section === "content"
                  ? "space-y-8 sm:space-y-9"
                  : "space-y-5 sm:space-y-6",
              )}
            >
              {section === "design" ? (
                <>
                  <div className="space-y-3">
                    <p className="text-sm font-medium">{t("business.qrStudio.design.template")}</p>
                    <Suspense
                      fallback={
                        <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-border/60 bg-muted/20">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
                        </div>
                      }
                    >
                      <QrTemplatePicker
                        value={normalizeQrTemplateId(studio.qrTemplate) as QrTemplateId}
                        onChange={studio.setQrTemplate}
                        canEdit={canEdit}
                        accentColor={studio.qrAccentColor}
                        backgroundColor={studio.qrBackgroundColor}
                        displayName={studio.snapshot.branding.businessName}
                        tagline={studio.snapshot.branding.brandTagline}
                      />
                    </Suspense>
                  </div>
                  <div className="space-y-2.5">
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
                </>
              ) : null}

              {section === "branding" ? (
                <>
                  <section className="space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight text-foreground">
                        {t("business.qrStudio.design.logoSectionTitle")}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t("business.qrStudio.design.logoSectionHint")}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <BusinessLogoMark
                        logoPathOrUrl={logoUrl}
                        businessName={businessName}
                        className="h-16 w-16 rounded-2xl"
                      />
                      <div className="space-y-2">
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
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 px-4 py-3.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t("business.qrStudio.design.headerLogo")}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{t("business.qrStudio.design.headerLogoHint")}</p>
                      </div>
                      <Switch
                        checked={studio.extras.showVenueLogoHeader}
                        onCheckedChange={(v: boolean) => studio.patchExtras({ showVenueLogoHeader: v })}
                        disabled={!canEdit}
                      />
                    </div>
                    {studio.extras.showVenueLogoHeader ? (
                      <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-2.5">
                          <Label htmlFor="logo-size">{t("business.qrStudio.design.logoSize")}</Label>
                          <Select
                            value={studio.extras.logoSize}
                            onValueChange={(v) => studio.patchExtras({ logoSize: v as QrLogoSize })}
                            disabled={!canEdit}
                          >
                            <SelectTrigger id="logo-size">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {LOGO_SIZES.map((id) => (
                                <SelectItem key={id} value={id}>
                                  {t(`business.qrStudio.design.logoSizes.${id}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2.5">
                          <Label htmlFor="logo-orientation">{t("business.qrStudio.design.logoOrientation")}</Label>
                          <Select
                            value={studio.extras.logoOrientation}
                            onValueChange={(v) => studio.patchExtras({ logoOrientation: v as QrLogoOrientation })}
                            disabled={!canEdit}
                          >
                            <SelectTrigger id="logo-orientation">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {LOGO_ORIENTATIONS.map((id) => (
                                <SelectItem key={id} value={id}>
                                  {t(`business.qrStudio.design.logoOrientations.${id}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2.5">
                          <Label htmlFor="logo-alignment">{t("business.qrStudio.design.logoAlignment")}</Label>
                          <Select
                            value={studio.extras.logoAlignment}
                            onValueChange={(v) => studio.patchExtras({ logoAlignment: v as QrLogoAlignment })}
                            disabled={!canEdit}
                          >
                            <SelectTrigger id="logo-alignment">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {LOGO_ALIGNMENTS.map((id) => (
                                <SelectItem key={id} value={id}>
                                  {t(`business.qrStudio.design.logoAlignments.${id}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2.5">
                          <Label htmlFor="logo-padding">{t("business.qrStudio.design.logoPadding")}</Label>
                          <Select
                            value={studio.extras.logoPadding}
                            onValueChange={(v) => studio.patchExtras({ logoPadding: v as QrLogoPadding })}
                            disabled={!canEdit}
                          >
                            <SelectTrigger id="logo-padding">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {LOGO_PADDINGS.map((id) => (
                                <SelectItem key={id} value={id}>
                                  {t(`business.qrStudio.design.logoPaddings.${id}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <div className="h-px bg-border/70" aria-hidden />

                  <section className="space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight text-foreground">
                        {t("business.qrStudio.design.identitySectionTitle")}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t("business.qrStudio.design.identitySectionHint")}
                      </p>
                    </div>
                    <div className="space-y-3 rounded-2xl border border-orange-200/70 bg-[linear-gradient(180deg,rgb(255_247_237)_0%,rgb(255_255_255)_100%)] p-5 shadow-sm dark:border-orange-900/40 dark:bg-[linear-gradient(180deg,rgb(67_32_11_/_0.28)_0%,rgb(24_24_27)_100%)] sm:p-6">
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
                  </section>

                  <div className="h-px bg-border/70" aria-hidden />

                  <section className="space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight text-foreground">
                        {t("business.qrStudio.design.linksSectionTitle")}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t("business.qrStudio.design.linksSectionHint")}
                      </p>
                    </div>
                    <div className="space-y-2.5">
                      <Label htmlFor="brand-website">{t("business.qrStudio.design.website")}</Label>
                      <Input
                        id="brand-website"
                        value={studio.extras.websiteUrl}
                        onChange={(e) => studio.patchExtras({ websiteUrl: e.target.value })}
                        placeholder="https://"
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div className="space-y-2.5">
                        <Label htmlFor="social-ig">{t("business.qrStudio.design.instagram")}</Label>
                        <Input
                          id="social-ig"
                          value={studio.extras.socialInstagram}
                          onChange={(e) => studio.patchExtras({ socialInstagram: e.target.value })}
                          placeholder="@yourvenue"
                          disabled={!canEdit}
                        />
                      </div>
                      <div className="space-y-2.5">
                        <Label htmlFor="social-fb">{t("business.qrStudio.design.facebook")}</Label>
                        <Input
                          id="social-fb"
                          value={studio.extras.socialFacebook}
                          onChange={(e) => studio.patchExtras({ socialFacebook: e.target.value })}
                          placeholder="facebook.com/yourvenue"
                          disabled={!canEdit}
                        />
                      </div>
                    </div>
                  </section>
                </>
              ) : null}

              {section === "content" ? (
                <>
                  <section className="space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight text-foreground">
                        {t("business.qrStudio.design.venueCopySectionTitle")}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t("business.qrStudio.design.venueCopySectionHint")}
                      </p>
                    </div>
                    <div className="space-y-2.5">
                      <Label htmlFor="brand-tagline">{t("business.qrStudio.design.tagline")}</Label>
                      <Input
                        id="brand-tagline"
                        value={studio.brandTagline}
                        onChange={(e) => studio.setBrandTagline(e.target.value)}
                        maxLength={120}
                        disabled={!canEdit}
                        placeholder={t("business.qrStudio.design.taglinePlaceholder")}
                      />
                    </div>
                    <div className="space-y-2.5">
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
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 px-4 py-3.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t("business.qrStudio.design.showAddress")}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{t("business.qrStudio.design.showAddressHint")}</p>
                      </div>
                      <Switch
                        checked={studio.extras.templateFieldVisibility.address !== false}
                        onCheckedChange={(v: boolean) => studio.setTemplateFieldVisible("address", v)}
                        disabled={!canEdit}
                      />
                    </div>
                  </section>

                  <div className="h-px bg-border/70" aria-hidden />

                  <section className="space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold tracking-tight text-foreground">
                        {t("business.qrStudio.design.messagingSectionTitle")}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t("business.qrStudio.design.messagingSectionHint")}
                      </p>
                    </div>
                    <div className="space-y-2.5">
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
                    <div className="space-y-2.5">
                      <Label htmlFor="cta">{t("business.qrStudio.design.cta")}</Label>
                      <Input
                        id="cta"
                        value={studio.extras.ctaText}
                        onChange={(e) => studio.patchExtras({ ctaText: e.target.value })}
                        maxLength={40}
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-2.5">
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
                  </section>
                </>
              ) : null}

              {section === "export" ? (
                <>
                  <p className="text-sm text-muted-foreground">{t("business.qrStudio.design.exportDesc")}</p>
                  <div className="grid gap-2">
                    <Button type="button" variant="outline" onClick={() => void handleExportPng()} disabled={previewLoading}>
                      <FileImage className="mr-2 h-4 w-4" />
                      {t("business.qrStudio.downloads.png")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setLivePreviewOpen(true)}
                      disabled={!previewUrl || previewLoading}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      {t("business.qrStudio.design.previewLiveQr")}
                    </Button>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
          </div>
        </aside>

        <main className="order-1 row-start-1 min-w-0 w-full max-w-full xl:col-start-2 xl:row-start-1">
          <Card className={cn(businessUi.cardStatic, "min-w-0 overflow-hidden")}>
            <CardHeader className="border-b border-neutral-100/90 px-4 pb-3 pt-4 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-base">{t("business.qrStudio.design.canvasTitle")}</CardTitle>
                  <CardDescription className={businessUi.cardDesc}>
                    {t("business.qrStudio.design.canvasDesc")}
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 gap-1.5"
                  onClick={() => setLivePreviewOpen(true)}
                  disabled={!previewUrl || previewLoading}
                >
                  <Eye className="h-4 w-4" aria-hidden />
                  {t("business.qrStudio.design.previewLiveQr")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex w-full min-w-0 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,rgb(250_250_249),rgb(244_244_245)_70%)] p-4 sm:p-6 lg:p-8 dark:bg-[radial-gradient(ellipse_at_center,rgb(39_39_42),rgb(24_24_27)_70%)]">
              <div className="qr-studio-canvas-frame flex w-full max-w-[340px] min-w-0 items-center justify-center sm:max-w-[380px]">
                {previewLoading ? (
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
                ) : previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={t("business.qrStudio.design.canvasTitle")}
                    className="block h-auto w-full max-w-full object-contain rounded-2xl shadow-[0_18px_40px_-24px_rgba(0,0,0,0.45)] ring-1 ring-black/5 [image-rendering:auto]"
                    style={{ imageRendering: "auto" }}
                    draggable={false}
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
            branding={studio.snapshot.branding}
            onReportChange={handleReliabilityReport}
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

      <Dialog open={livePreviewOpen} onOpenChange={setLivePreviewOpen}>
        <DialogContent className="max-h-[94vh] overflow-y-auto rounded-2xl border-border sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("business.qrStudio.design.previewLiveQrTitle")}</DialogTitle>
            <DialogDescription>{t("business.qrStudio.design.previewLiveQrDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-[320px] items-center justify-center rounded-2xl bg-[radial-gradient(ellipse_at_center,rgb(250_250_249),rgb(244_244_245)_70%)] p-4 sm:p-10 dark:bg-[radial-gradient(ellipse_at_center,rgb(39_39_42),rgb(24_24_27)_70%)]">
            {inspectionLoading ? (
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
            ) : inspectionUrl ? (
              <img
                src={inspectionUrl}
                alt={t("business.qrStudio.design.previewLiveQrTitle")}
                className="block h-auto w-full max-w-[min(92vw,640px)] object-contain rounded-2xl shadow-[0_24px_60px_-28px_rgba(0,0,0,0.5)] ring-1 ring-black/5"
                draggable={false}
              />
            ) : (
              <p className="py-10 text-sm text-muted-foreground">{t("business.qrPage.toastQrNotReady")}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
