import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, Loader2, Palette, QrCode, Save, Type, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  fetchBusinessBrandingSettings,
  patchBusinessBrandingSettings,
  uploadMyBusinessBanner,
  uploadMyBusinessLogo,
  type BusinessBrandingSettings,
} from "../../../lib/api";
import {
  brandingFromSettings,
  DEFAULT_BRAND_PRIMARY_COLOR,
  DEFAULT_BRAND_SECONDARY_COLOR,
  isValidBrandHex,
  notifyBusinessBrandingChanged,
  qrOptionsFromBrandingFields,
  trackBrandingClientEvent,
} from "../../../lib/businessBranding";
import {
  DEFAULT_QR_BACKGROUND_COLOR,
  DEFAULT_QR_BORDER_STYLE,
  DEFAULT_QR_SHAPE,
  DEFAULT_QR_TEMPLATE,
  QR_BORDER_STYLE_IDS,
  QR_SHAPE_IDS,
  type QrBorderStyleId,
  type QrShapeId,
  type QrTemplateId,
} from "../../../lib/qrTemplateStyles";
import { QrTemplatePicker } from "./QrTemplatePicker";
import { resolveMediaUrl, withMediaCacheBust } from "../../../lib/mediaUrl";
import { logClientError } from "../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";
import { UpgradeCta } from "../../subscription/UpgradeCta";
import { BusinessLogoMark } from "../BusinessLogoMark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { QrReliabilityScore } from "../QrReliabilityScore";
import { BrandedGuestSuccessPreview } from "./BrandedGuestSuccessPreview";
import { isQrExportAllowed, type QrReliabilityReport } from "../../../lib/qrBranded";
import { isQrModuleContrastSafe } from "../../../lib/qrReliability";
import { QR_TEMPLATE_PRESETS } from "../../../lib/qrTemplateStyles";

const LOGO_MAX = 5 * 1024 * 1024;
const BANNER_MAX = 8 * 1024 * 1024;
const QR_RELIABILITY_SAMPLE_URL = "https://caretip.app/qr-studio-scan-check";

type BusinessBrandingSettingsPanelProps = {
  businessName: string;
  canEdit: boolean;
};

export function BusinessBrandingSettingsPanel({ businessName, canEdit }: BusinessBrandingSettingsPanelProps) {
  const { t } = useTranslation();
  const logoInputId = useId();
  const bannerInputId = useId();

  const [settings, setSettings] = useState<BusinessBrandingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoBust, setLogoBust] = useState(0);
  const [bannerBust, setBannerBust] = useState(0);

  const [primaryColor, setPrimaryColor] = useState(DEFAULT_BRAND_PRIMARY_COLOR);
  const [secondaryColor, setSecondaryColor] = useState(DEFAULT_BRAND_SECONDARY_COLOR);
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [thankYouMessage, setThankYouMessage] = useState("");
  const [brandDisplayName, setBrandDisplayName] = useState("");
  const [brandTagline, setBrandTagline] = useState("");
  const [qrTemplate, setQrTemplate] = useState<QrTemplateId>(DEFAULT_QR_TEMPLATE);
  const [qrBorderStyle, setQrBorderStyle] = useState<QrBorderStyleId>(DEFAULT_QR_BORDER_STYLE);
  const [qrShape, setQrShape] = useState<QrShapeId>(DEFAULT_QR_SHAPE);
  const [qrAccentColor, setQrAccentColor] = useState(DEFAULT_BRAND_PRIMARY_COLOR);
  const [qrBackgroundColor, setQrBackgroundColor] = useState(DEFAULT_QR_BACKGROUND_COLOR);
  const [reliabilityReport, setReliabilityReport] = useState<QrReliabilityReport | null>(null);

  const previewGuestBranding = useMemo(() => {
    if (!settings) return null;
    return brandingFromSettings(
      {
        ...settings,
        brandPrimaryColor: primaryColor,
        brandSecondaryColor: secondaryColor,
        welcomeMessage: welcomeMessage.trim() || null,
        thankYouMessage: thankYouMessage.trim() || null,
        brandDisplayName: brandDisplayName.trim() || null,
        brandTagline: brandTagline.trim() || null,
        qrTemplate,
        qrBorderStyle,
        qrShape,
        qrAccentColor,
        qrBackgroundColor,
      },
      brandDisplayName.trim() || businessName,
      canEdit,
    );
  }, [
    settings,
    primaryColor,
    secondaryColor,
    welcomeMessage,
    thankYouMessage,
    brandDisplayName,
    brandTagline,
    qrTemplate,
    qrBorderStyle,
    qrShape,
    qrAccentColor,
    qrBackgroundColor,
    businessName,
    canEdit,
  ]);

  const previewBranding = useMemo(() => {
    const opts = qrOptionsFromBrandingFields(
      canEdit,
      {
        logoPath: settings?.logoPath ?? null,
        brandPrimaryColor: primaryColor,
        brandSecondaryColor: secondaryColor,
        brandDisplayName: brandDisplayName.trim() || null,
        brandTagline: brandTagline.trim() || null,
        welcomeMessage: welcomeMessage.trim() || null,
        thankYouMessage: thankYouMessage.trim() || null,
        qrTemplate,
        qrBorderStyle,
        qrShape,
        qrAccentColor,
        qrBackgroundColor,
      },
      brandDisplayName.trim() || businessName,
    );
    if (opts.centerLogoUrl && settings?.logoPath) {
      return {
        ...opts,
        centerLogoUrl: withMediaCacheBust(resolveMediaUrl(settings.logoPath) ?? settings.logoPath, logoBust),
      };
    }
    return opts;
  }, [
      canEdit,
      settings?.logoPath,
      primaryColor,
      secondaryColor,
      brandDisplayName,
      brandTagline,
      welcomeMessage,
      thankYouMessage,
      qrTemplate,
      qrBorderStyle,
      qrShape,
      qrAccentColor,
      qrBackgroundColor,
      businessName,
      logoBust,
    ],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchBusinessBrandingSettings();
      setSettings(s);
      setPrimaryColor(s.brandPrimaryColor);
      setSecondaryColor(s.brandSecondaryColor);
      setWelcomeMessage(s.welcomeMessage ?? "");
      setThankYouMessage(s.thankYouMessage ?? "");
      setBrandDisplayName(s.brandDisplayName ?? "");
      setBrandTagline(s.brandTagline ?? "");
      setQrTemplate(s.qrTemplate);
      setQrBorderStyle(s.qrBorderStyle);
      setQrShape(s.qrShape);
      setQrAccentColor(s.qrAccentColor);
      setQrBackgroundColor(s.qrBackgroundColor);
    } catch (e) {
      logClientError("BusinessBrandingSettingsPanel.load", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const logoSrc = settings?.logoPath
    ? withMediaCacheBust(resolveMediaUrl(settings.logoPath) ?? "", logoBust)
    : null;
  const bannerSrc = settings?.bannerImagePath
    ? withMediaCacheBust(resolveMediaUrl(settings.bannerImagePath) ?? "", bannerBust)
    : null;

  const handleLogoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !canEdit) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("business.branding.toastImageType"));
      return;
    }
    if (file.size > LOGO_MAX) {
      toast.error(t("business.branding.toastLogoSize"));
      return;
    }
    try {
      await uploadMyBusinessLogo(file);
      trackBrandingClientEvent("branding_logo_uploaded");
      setLogoBust((b) => b + 1);
      await load();
      window.dispatchEvent(new Event("caretip-business-profile-changed"));
      notifyBusinessBrandingChanged();
    } catch (err) {
      toast.error(toUserFriendlyMessage(err));
    }
  };

  const handleBannerPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !canEdit) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("business.branding.toastImageType"));
      return;
    }
    if (file.size > BANNER_MAX) {
      toast.error(t("business.branding.toastBannerSize"));
      return;
    }
    try {
      await uploadMyBusinessBanner(file);
      trackBrandingClientEvent("branding_banner_uploaded");
      setBannerBust((b) => b + 1);
      await load();
    } catch (err) {
      toast.error(toUserFriendlyMessage(err));
    }
  };

  const handleSave = async () => {
    if (!canEdit) return;
    if (!isValidBrandHex(primaryColor) || !isValidBrandHex(secondaryColor)) {
      toast.error(t("business.branding.toastInvalidColor"));
      return;
    }
    if (welcomeMessage.length > 120) {
      toast.error(t("business.branding.toastWelcomeMax"));
      return;
    }
    if (thankYouMessage.length > 250) {
      toast.error(t("business.branding.toastThankYouMax"));
      return;
    }
    if (brandDisplayName.length > 80) {
      toast.error(t("business.branding.toastDisplayNameMax"));
      return;
    }
    if (brandTagline.length > 120) {
      toast.error(t("business.branding.toastTaglineMax"));
      return;
    }
    if (!isValidBrandHex(qrAccentColor) || !isValidBrandHex(qrBackgroundColor)) {
      toast.error(t("business.branding.toastInvalidQrColor"));
      return;
    }
    const moduleLight = QR_TEMPLATE_PRESETS[qrTemplate].moduleLight;
    if (canEdit && !isQrModuleContrastSafe(secondaryColor, moduleLight)) {
      toast.error(t("business.qrReliability.toastUnsafeContrast"));
      return;
    }
    if (canEdit && reliabilityReport && !isQrExportAllowed(reliabilityReport)) {
      toast.error(t("business.qrReliability.saveBlocked"));
      return;
    }
    setSaving(true);
    try {
      const prev = settings;
      const next = await patchBusinessBrandingSettings({
        brandPrimaryColor: primaryColor,
        brandSecondaryColor: secondaryColor,
        welcomeMessage: welcomeMessage.trim() || null,
        thankYouMessage: thankYouMessage.trim() || null,
        brandDisplayName: brandDisplayName.trim() || null,
        brandTagline: brandTagline.trim() || null,
        qrTemplate,
        qrBorderStyle,
        qrShape,
        qrAccentColor: qrAccentColor.trim() || null,
        qrBackgroundColor,
      });
      setSettings(next);
      if (
        prev &&
        (prev.brandPrimaryColor !== next.brandPrimaryColor ||
          prev.brandSecondaryColor !== next.brandSecondaryColor)
      ) {
        trackBrandingClientEvent("branding_colors_changed");
      }
      if (prev && (prev.welcomeMessage ?? "") !== (next.welcomeMessage ?? "")) {
        trackBrandingClientEvent("branding_welcome_updated");
      }
      if (prev && (prev.thankYouMessage ?? "") !== (next.thankYouMessage ?? "")) {
        trackBrandingClientEvent("branding_thankyou_updated");
      }
      if (
        prev &&
        ((prev.brandDisplayName ?? "") !== (next.brandDisplayName ?? "") ||
          (prev.brandTagline ?? "") !== (next.brandTagline ?? "") ||
          prev.qrTemplate !== next.qrTemplate ||
          prev.qrBorderStyle !== next.qrBorderStyle ||
          prev.qrShape !== next.qrShape ||
          prev.qrAccentColor !== next.qrAccentColor ||
          prev.qrBackgroundColor !== next.qrBackgroundColor)
      ) {
        trackBrandingClientEvent("branding_qr_v2_updated", { qrTemplate: next.qrTemplate });
      }
      notifyBusinessBrandingChanged();
    } catch (e) {
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span>{t("business.branding.loading")}</span>
      </div>
    );
  }

  const disabled = !canEdit;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {t("business.branding.title")}
        </h2>
        <p className={cn("max-w-2xl text-sm", businessUi.cardDesc)}>{t("business.branding.description")}</p>
        {!canEdit ? (
          <div className="pt-2">
            <UpgradeCta featureKey="brandingCustomization" />
          </div>
        ) : null}
      </header>

      <fieldset disabled={disabled} className={cn("space-y-6", disabled && "opacity-90")}>
        <Card className={businessUi.cardStatic}>
          <CardHeader className="border-b border-neutral-100/90">
            <CardTitle className="text-base">{t("business.branding.logoTitle")}</CardTitle>
            <CardDescription className={businessUi.cardDesc}>{t("business.branding.logoDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center">
            <BusinessLogoMark logoPathOrUrl={logoSrc} businessName={businessName} size="xl" />
            <div>
              <input id={logoInputId} type="file" accept="image/*" className="sr-only" onChange={(e) => void handleLogoPick(e)} />
              <Button type="button" variant="outline" size="sm" asChild={canEdit}>
                <label htmlFor={canEdit ? logoInputId : undefined} className={canEdit ? "cursor-pointer" : ""}>
                  <Upload className="mr-2 h-4 w-4" />
                  {t("business.branding.uploadLogo")}
                </label>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className={businessUi.cardStatic}>
          <CardHeader className="border-b border-neutral-100/90">
            <CardTitle className="text-base">{t("business.branding.bannerTitle")}</CardTitle>
            <CardDescription className={businessUi.cardDesc}>{t("business.branding.bannerDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div
              className="relative flex min-h-[7rem] items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/30"
              style={
                !bannerSrc
                  ? {
                      background: `linear-gradient(135deg, ${primaryColor}22, ${primaryColor}44)`,
                    }
                  : undefined
              }
            >
              {bannerSrc ? (
                <img src={bannerSrc} alt="" className="max-h-40 w-full object-cover" loading="lazy" />
              ) : (
                <ImageIcon className="h-10 w-10 text-muted-foreground/50" aria-hidden />
              )}
            </div>
            <input id={bannerInputId} type="file" accept="image/*" className="sr-only" onChange={(e) => void handleBannerPick(e)} />
            <Button type="button" variant="outline" size="sm" asChild={canEdit}>
              <label htmlFor={canEdit ? bannerInputId : undefined} className={canEdit ? "cursor-pointer" : ""}>
                <Upload className="mr-2 h-4 w-4" />
                {t("business.branding.uploadBanner")}
              </label>
            </Button>
          </CardContent>
        </Card>

        <Card className={businessUi.cardStatic}>
          <CardHeader className="border-b border-neutral-100/90">
            <CardTitle className="flex items-center gap-2 text-base">
              <Type className="h-4 w-4 text-primary" aria-hidden />
              {t("business.branding.identityTitle")}
            </CardTitle>
            <CardDescription className={businessUi.cardDesc}>{t("business.branding.identityDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor="brand-tagline">{t("business.branding.taglineLabel")}</Label>
              <Input
                id="brand-tagline"
                value={brandTagline}
                onChange={(e) => setBrandTagline(e.target.value)}
                maxLength={120}
                placeholder={t("business.branding.taglinePlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{brandTagline.length}/120</p>
            </div>
          </CardContent>
        </Card>
      </fieldset>

      <Card className={businessUi.cardStatic}>
        <CardHeader className="border-b border-neutral-100/90">
          <CardTitle className="flex items-center gap-2 text-base">
            <QrCode className="h-4 w-4 text-primary" aria-hidden />
            {t("business.branding.qrTemplateTitle")}
          </CardTitle>
          <CardDescription className={businessUi.cardDesc}>{t("business.branding.qrTemplateDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <QrTemplatePicker
            value={qrTemplate}
            onChange={setQrTemplate}
            canEdit={canEdit}
            accentColor={qrAccentColor}
            backgroundColor={qrBackgroundColor}
            displayName={brandDisplayName.trim() || businessName}
            tagline={brandTagline}
          />
        </CardContent>
      </Card>

      <fieldset disabled={disabled} className={cn("space-y-6", disabled && "opacity-90")}>
        <Card className={businessUi.cardStatic}>
          <CardHeader className="border-b border-neutral-100/90">
            <CardTitle className="text-base">{t("business.branding.qrStyleTitle")}</CardTitle>
            <CardDescription className={businessUi.cardDesc}>{t("business.branding.qrStyleDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="qr-border">{t("business.branding.qrBorderLabel")}</Label>
              <Select value={qrBorderStyle} onValueChange={(v) => setQrBorderStyle(v as QrBorderStyleId)} disabled={disabled}>
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
            <div className="space-y-2">
              <Label htmlFor="qr-shape">{t("business.branding.qrShapeLabel")}</Label>
              <Select value={qrShape} onValueChange={(v) => setQrShape(v as QrShapeId)} disabled={disabled}>
                <SelectTrigger id="qr-shape">
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
              <Label htmlFor="qr-accent">{t("business.branding.qrAccentLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id="qr-accent"
                  type="color"
                  value={qrAccentColor}
                  onChange={(e) => setQrAccentColor(e.target.value.toUpperCase())}
                  className="h-10 w-14 shrink-0 cursor-pointer p-1"
                />
                <Input
                  value={qrAccentColor}
                  onChange={(e) => setQrAccentColor(e.target.value.toUpperCase())}
                  maxLength={7}
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="qr-bg">{t("business.branding.qrBackgroundLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id="qr-bg"
                  type="color"
                  value={qrBackgroundColor}
                  onChange={(e) => setQrBackgroundColor(e.target.value.toUpperCase())}
                  className="h-10 w-14 shrink-0 cursor-pointer p-1"
                />
                <Input
                  value={qrBackgroundColor}
                  onChange={(e) => setQrBackgroundColor(e.target.value.toUpperCase())}
                  maxLength={7}
                  className="font-mono text-sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={businessUi.cardStatic}>
          <CardHeader className="border-b border-neutral-100/90">
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4 text-primary" aria-hidden />
              {t("business.branding.colorsTitle")}
            </CardTitle>
            <CardDescription className={businessUi.cardDesc}>{t("business.branding.colorsDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brand-primary">{t("business.branding.primaryColor")}</Label>
              <div className="flex gap-2">
                <Input
                  id="brand-primary"
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value.toUpperCase())}
                  className="h-10 w-14 shrink-0 cursor-pointer p-1"
                />
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value.toUpperCase())}
                  maxLength={7}
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand-secondary">{t("business.branding.secondaryColor")}</Label>
              <div className="flex gap-2">
                <Input
                  id="brand-secondary"
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value.toUpperCase())}
                  className="h-10 w-14 shrink-0 cursor-pointer p-1"
                />
                <Input
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value.toUpperCase())}
                  maxLength={7}
                  className="font-mono text-sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={businessUi.cardStatic}>
          <CardHeader className="border-b border-neutral-100/90">
            <CardTitle className="text-base">{t("business.branding.messagingTitle")}</CardTitle>
            <CardDescription className={businessUi.cardDesc}>{t("business.branding.messagingDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{t("business.branding.businessIdentityTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("business.branding.businessIdentityDesc")}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="brand-display-name">{t("business.branding.displayNameLabel")}</Label>
                <Input
                  id="brand-display-name"
                  value={brandDisplayName}
                  onChange={(e) => setBrandDisplayName(e.target.value)}
                  maxLength={80}
                  placeholder={businessName}
                />
                <p className="text-xs text-muted-foreground">{t("business.branding.displayNameHelper")}</p>
                <p className="text-xs text-muted-foreground/80">{t("business.branding.displayNameExamples")}</p>
                <p className="text-xs text-muted-foreground">{brandDisplayName.length}/80</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="welcome-msg">{t("business.branding.welcomeLabel")}</Label>
              <Textarea
                id="welcome-msg"
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                maxLength={120}
                rows={2}
                placeholder={t("business.branding.welcomePlaceholder", { name: businessName })}
              />
              <p className="text-xs text-muted-foreground">{welcomeMessage.length}/120</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="thankyou-msg">{t("business.branding.thankYouLabel")}</Label>
              <Textarea
                id="thankyou-msg"
                value={thankYouMessage}
                onChange={(e) => setThankYouMessage(e.target.value)}
                maxLength={250}
                rows={3}
                placeholder={t("business.branding.thankYouPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{thankYouMessage.length}/250</p>
            </div>

            {previewGuestBranding ? (
              <div className="space-y-3 border-t border-border/70 pt-6">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">{t("business.branding.successPreviewTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("business.branding.successPreviewDesc")}</p>
                </div>
                <BrandedGuestSuccessPreview
                  businessName={brandDisplayName.trim() || businessName}
                  logoPath={settings?.logoPath ?? null}
                  branding={previewGuestBranding}
                  thankYouMessage={thankYouMessage.trim() || null}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {canEdit ? (
          <QrReliabilityScore
            sampleUrl={QR_RELIABILITY_SAMPLE_URL}
            branding={previewBranding}
            onReportChange={setReliabilityReport}
          />
        ) : null}

        {canEdit ? (
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || (reliabilityReport !== null && !isQrExportAllowed(reliabilityReport))}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {t("business.branding.save")}
            </Button>
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
