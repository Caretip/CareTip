import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { BUSINESS_TYPE_I18N } from "../../lib/businessVenueOptions";
import { getEmployees } from "../../lib/api";
import { logClientError } from "../../lib/clientLog";
import { buildPreviewStaffSlots } from "./businessOnboardingGuestPreview.utils";
import { BusinessOnboardingFinalPhoneScreen } from "./BusinessOnboardingFinalPhoneScreen";
import type { GuestPreviewData, TipPreviewStaffMember } from "./BusinessOnboardingGuestPreview.types";

export type { GuestPreviewData } from "./BusinessOnboardingGuestPreview.types";

type BusinessOnboardingGuestPreviewProps = GuestPreviewData;

function previewLine(value: string, placeholderKey: string, t: (key: string) => string) {
  const trimmed = value.trim();
  if (trimmed.length > 0) return { text: trimmed, isPlaceholder: false };
  return { text: t(placeholderKey), isPlaceholder: true };
}

export function BusinessOnboardingGuestPreview({
  legalBusinessName,
  businessType,
  registeredAddress,
  logoFile,
  savedLogoPath,
  employeeCount,
  businessId,
}: BusinessOnboardingGuestPreviewProps) {
  const { t } = useTranslation();
  const [uploadLogoUrl, setUploadLogoUrl] = useState<string | null>(null);
  const [liveStaff, setLiveStaff] = useState<TipPreviewStaffMember[] | null>(null);

  useEffect(() => {
    if (!logoFile) {
      setUploadLogoUrl(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setUploadLogoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const venueNameLine = useMemo(
    () => previewLine(legalBusinessName, "business.onboarding.preview.placeholderVenueName", t),
    [legalBusinessName, t],
  );

  const venueTypeLine = useMemo(() => {
    if (!businessType.trim()) {
      return {
        text: t("business.onboarding.preview.placeholderVenueType"),
        isPlaceholder: true,
      };
    }
    const key = BUSINESS_TYPE_I18N[businessType];
    return {
      text: key ? t(key) : businessType,
      isPlaceholder: false,
    };
  }, [businessType, t]);

  const addressLine = useMemo(
    () => previewLine(registeredAddress, "business.onboarding.preview.placeholderAddress", t),
    [registeredAddress, t],
  );

  const hasBusinessName = legalBusinessName.trim().length > 0;
  const displayName = venueNameLine.text;
  const heroLogoSrc = uploadLogoUrl ?? savedLogoPath ?? null;

  const previewStaff = useMemo(
    () => buildPreviewStaffSlots(legalBusinessName, businessType, { count: 4 }),
    [legalBusinessName, businessType],
  );

  useEffect(() => {
    if (!businessId?.trim()) {
      setLiveStaff(null);
      return;
    }
    let cancelled = false;
    void getEmployees(businessId)
      .then((rows) => {
        if (cancelled) return;
        const mapped = (rows ?? [])
          .filter((row) => row.name?.trim())
          .slice(0, 4)
          .map((row) => ({
            id: row.id,
            displayName: row.name.trim(),
            photoUrl: row.avatar,
            roleLabel: row.role?.trim() || t("business.onboarding.preview.staffRoles.teamMember"),
            isLive: true,
          }));
        setLiveStaff(mapped.length > 0 ? mapped : null);
      })
      .catch((err) => {
        logClientError("BusinessOnboardingGuestPreview.getEmployees", err);
        if (!cancelled) setLiveStaff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, t]);

  const tipStaff = useMemo((): TipPreviewStaffMember[] => {
    if (liveStaff && liveStaff.length > 0) return liveStaff;
    return previewStaff.map((member, index) => ({
      id: `preview-${index}`,
      displayName: member.displayName,
      photoUrl: member.photoUrl,
      roleLabel: t(`business.onboarding.preview.staffRoles.${member.roleKey}`),
      isLive: false,
    }));
  }, [liveStaff, previewStaff, t]);

  return (
    <section
      className="business-onboarding-guest-preview"
      aria-label={t("business.onboarding.preview.panelAria")}
    >
      <div className="business-onboarding-guest-preview__intro">
        <p className="business-onboarding-guest-preview__label" id="onboarding-guest-preview-label">
          {t("business.onboarding.preview.liveLabel")}
        </p>
        <p className="business-onboarding-guest-preview__helper">{t("business.onboarding.preview.caption")}</p>
      </div>

      <div
        className="business-onboarding-guest-preview__device-wrap"
        role="group"
        aria-labelledby="onboarding-guest-preview-label"
      >
        <p id="onboarding-guest-preview-helper" className="sr-only">
          {hasBusinessName
            ? t("business.onboarding.preview.guestAriaNamed", { name: displayName })
            : t("business.onboarding.preview.guestAria")}
        </p>

        <div className="business-onboarding-guest-preview__device" aria-hidden="true">
          <div className="business-onboarding-guest-preview__device-notch" />
          <div
            className={cn(
              "business-onboarding-guest-preview__device-screen",
              "business-onboarding-guest-preview__device-screen--guest-experience",
              "business-onboarding-final-phone",
              "flex min-h-0 flex-col",
            )}
          >
            <BusinessOnboardingFinalPhoneScreen
              displayName={displayName}
              venueNameLine={venueNameLine}
              venueTypeLine={venueTypeLine}
              addressLine={addressLine}
              heroLogoSrc={heroLogoSrc}
              tipStaff={tipStaff}
              employeeCount={employeeCount}
            />
          </div>
        </div>

        <div className="business-onboarding-guest-preview__device-shadow" aria-hidden />
      </div>
    </section>
  );
}
