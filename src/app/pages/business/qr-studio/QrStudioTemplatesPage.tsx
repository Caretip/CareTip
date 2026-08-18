/**
 * Retired standalone Templates route. `/dashboard/qr-studio/templates` now
 * redirects to Branding. Digital template picking lives in QrStudioDesigner
 * via QrTemplatePicker; do not delete qrTemplateEngine.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { fetchBusinessBrandingSettings } from "../../../lib/api";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { QrTemplatePicker } from "../../../components/business/settings/QrTemplatePicker";
import { FeatureGate } from "@/app/components/subscription/FeatureGate";
import { DEFAULT_QR_TEMPLATE } from "../../../lib/qrTemplateStyles";
import type { QrTemplateId } from "../../../lib/qrTemplateStyles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { logClientError } from "../../../lib/clientLog";

function QrStudioTemplatesPageContent() {
  const { t } = useTranslation();
  const { user } = useRequireAuth();
  const [template, setTemplate] = useState<QrTemplateId>(DEFAULT_QR_TEMPLATE);
  const [accent, setAccent] = useState("#EB992C");
  const [background, setBackground] = useState("#FFFFFF");
  const [displayName, setDisplayName] = useState("");
  const [tagline, setTagline] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchBusinessBrandingSettings()
      .then((s) => {
        if (cancelled) return;
        setTemplate(s.qrTemplate);
        setAccent(s.qrAccentColor);
        setBackground(s.qrBackgroundColor);
        setDisplayName(s.brandDisplayName ?? user?.businessName ?? "");
        setTagline(s.brandTagline ?? "");
      })
      .catch((e) => logClientError("QrStudioTemplatesPage", e));
    return () => {
      cancelled = true;
    };
  }, [user?.businessName]);

  return (
    <div className="space-y-6">
      <Card className={businessUi.cardStatic}>
        <CardHeader className="border-b border-neutral-100/90">
          <CardTitle className="text-base">{t("business.qrStudio.templates.title")}</CardTitle>
          <CardDescription className={businessUi.cardDesc}>
            {t("business.qrStudio.templates.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <QrTemplatePicker
            value={template}
            onChange={setTemplate}
            canEdit
            accentColor={accent}
            backgroundColor={background}
            displayName={displayName || user?.businessName || "Your Brand"}
            tagline={tagline}
          />
          <p className="text-xs text-muted-foreground">{t("business.qrStudio.templates.saveHint")}</p>
          <Button asChild variant="outline" size="sm" className="w-fit">
            <Link to="/dashboard/qr-studio/branding">{t("business.qrStudio.templates.openBranding")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** Premium QR template marketplace — preview + locked states. */
export function QrStudioTemplatesPage() {
  return (
    <FeatureGate featureKey="qrTemplates" role="business">
      <QrStudioTemplatesPageContent />
    </FeatureGate>
  );
}
