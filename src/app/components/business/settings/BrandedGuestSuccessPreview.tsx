import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  resolveGuestThankYouMessage,
  type PublicGuestBranding,
} from "../../../lib/businessBranding";
import { venueBrandFromFields } from "../../../pages/customer/customerJourneyBrand";
import { TipSuccessExperience } from "../../../pages/customer/TipSuccessExperience";
import { resolveMediaUrl } from "../../../lib/mediaUrl";

type BrandedGuestSuccessPreviewProps = {
  businessName: string;
  logoPath?: string | null;
  branding: PublicGuestBranding;
  thankYouMessage?: string | null;
};

/** Live preview of the post-tip success screen for Branding & QR settings. */
export function BrandedGuestSuccessPreview({
  businessName,
  logoPath,
  branding,
  thankYouMessage,
}: BrandedGuestSuccessPreviewProps) {
  const { t } = useTranslation();

  const venue = useMemo(
    () =>
      venueBrandFromFields(
        businessName,
        logoPath ? resolveMediaUrl(logoPath) : null,
        undefined,
        branding,
      ),
    [businessName, branding, logoPath],
  );

  const confirmationMessage = resolveGuestThankYouMessage(
    { premium: branding.premium, thankYouMessage: thankYouMessage ?? branding.thankYouMessage },
    t("tipFlow.success.tipSentConfirmation"),
  );

  return (
    <div
      className="branded-guest-success-preview overflow-hidden rounded-xl border border-border/80 bg-muted/15"
      aria-label={t("business.branding.successPreviewAria")}
    >
      <TipSuccessExperience
        embedded
        venue={venue}
        employee={{
          name: t("business.branding.successPreviewStaffName"),
          avatar: null,
          role: t("business.branding.successPreviewStaffRole"),
          bio: null,
        }}
        headline={t("tipFlow.success.celebrationHeadline")}
        thankYouMessage={confirmationMessage}
        tipAmount={12}
        showReceipt={false}
        primaryLabel={t("tipFlow.completion.tipSomeoneElse")}
        secondaryLabel={t("tipFlow.completion.exit")}
        onPrimary={() => {}}
        onSecondary={() => {}}
        showAttribution={false}
      />
    </div>
  );
}
