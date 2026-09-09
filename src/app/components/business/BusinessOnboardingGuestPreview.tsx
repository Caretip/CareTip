import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Building2, MapPin, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CareTipLogo } from "../CareTipLogo";
import { BusinessLogoMark } from "./BusinessLogoMark";
import { EmployeeProfilePhoto } from "../ui/profile-avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { customerFlowUi as cf } from "../../pages/customer/customerFlowUi";
import { cn } from "@/lib/utils";
import { BUSINESS_TYPE_I18N } from "../../lib/businessVenueOptions";
import { getEmployees } from "../../lib/api";
import { logClientError } from "../../lib/clientLog";
import { buildPreviewStaffSlots } from "./businessOnboardingGuestPreview.utils";
import { BusinessOnboardingCustomerJourney } from "./BusinessOnboardingCustomerJourney";
import { BusinessOnboardingFinalPhoneScreen } from "./BusinessOnboardingFinalPhoneScreen";
import { PhoneMockup } from "../ui/PhoneMockup";
import type { GuestPreviewData, TipPreviewStaffMember } from "./BusinessOnboardingGuestPreview.types";
import type { PreviewStaffSlot } from "./businessOnboardingGuestPreview.utils";

export type { GuestPreviewData } from "./BusinessOnboardingGuestPreview.types";

type BusinessOnboardingGuestPreviewProps = GuestPreviewData & {
  variant?: "default" | "final";
};

type PreviewLine = {
  text: string;
  isPlaceholder: boolean;
};

function previewLine(value: string, placeholderKey: string, t: (key: string) => string): PreviewLine {
  const trimmed = value.trim();
  if (trimmed.length > 0) return { text: trimmed, isPlaceholder: false };
  return { text: t(placeholderKey), isPlaceholder: true };
}

function PreviewStaffCard({
  staff,
  t,
  premium = false,
}: {
  staff: PreviewStaffSlot[];
  t: (key: string, options?: Record<string, string>) => string;
  premium?: boolean;
}) {
  return (
    <Card
      className={cn(
        cf.cardShadcn,
        premium && "business-onboarding-guest-preview__staff-card--premium border-primary/15 shadow-[0_12px_32px_-18px_rgba(233,120,28,0.35)]",
      )}
    >
      <CardHeader className={cn(cf.cardHeaderPadding, "pb-2", premium && "px-4 pt-4")}>
        <CardTitle className={cn(cf.cardTitle, premium ? "text-[0.8125rem]" : "text-base")}>
          {t("business.onboarding.preview.selectStaffToTip")}
        </CardTitle>
        <CardDescription className={cn(cf.cardDesc, premium && "text-[0.625rem] leading-snug")}>
          {t("business.onboarding.preview.selectStaffToTipDesc")}
        </CardDescription>
      </CardHeader>
      <CardContent className={cn("px-4 pb-4", !premium && "px-5 pb-5")}>
        <ul
          className={cn(
            "business-onboarding-guest-preview__staff-grid",
            premium && "business-onboarding-guest-preview__staff-grid--premium",
          )}
        >
          {staff.map((member, index) => (
            <li key={`${member.displayName}-${index}`}>
              <div
                className={cn(
                  "business-onboarding-guest-preview__staff-tile",
                  premium && "business-onboarding-guest-preview__staff-tile--premium",
                  premium && index === 0 && "business-onboarding-guest-preview__staff-tile--selected",
                  member.isPlaceholder && "business-onboarding-guest-preview__staff-tile--placeholder",
                )}
              >
                <EmployeeProfilePhoto
                  src={member.photoUrl}
                  displayName={member.displayName}
                  lightbox={false}
                  className={cn(
                    "business-onboarding-guest-preview__staff-photo",
                    premium
                      ? "h-[3.25rem] w-[3.25rem] ring-2 ring-primary/35"
                      : "h-12 w-12 ring-2 ring-primary/25",
                    member.isPlaceholder && "opacity-80 saturate-[0.85]",
                  )}
                />
                <span
                  className={cn(
                    "business-onboarding-guest-preview__staff-name",
                    premium && "business-onboarding-guest-preview__staff-name--premium",
                    member.isPlaceholder && "business-onboarding-guest-preview__text--placeholder",
                  )}
                >
                  {member.displayName}
                </span>
                <span
                  className={cn(
                    "business-onboarding-guest-preview__staff-role",
                    member.isPlaceholder && "business-onboarding-guest-preview__text--placeholder",
                  )}
                >
                  {t(`business.onboarding.preview.staffRoles.${member.roleKey}`)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function BusinessOnboardingGuestPreview({
  legalBusinessName,
  businessType,
  registeredAddress,
  logoFile,
  savedLogoPath,
  employeeCount,
  businessId,
  variant = "default",
}: BusinessOnboardingGuestPreviewProps) {
  const { t } = useTranslation();
  const [uploadLogoUrl, setUploadLogoUrl] = useState<string | null>(null);
  const [liveStaff, setLiveStaff] = useState<TipPreviewStaffMember[] | null>(null);
  const isFinal = variant === "final";

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
    () => buildPreviewStaffSlots(legalBusinessName, businessType, { count: isFinal ? 4 : 2 }),
    [legalBusinessName, businessType, isFinal],
  );

  useEffect(() => {
    if (!isFinal || !businessId?.trim()) {
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
  }, [businessId, isFinal, t]);

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

  const chromeSubtitle = t("business.onboarding.preview.selectStaffToTip");

  const helperText = isFinal
    ? hasBusinessName
      ? t("business.onboarding.preview.helperTextReviewNamed", { name: displayName })
      : t("business.onboarding.preview.helperTextReview")
    : hasBusinessName
      ? t("business.onboarding.preview.helperTextNamed", { name: displayName })
      : t("business.onboarding.preview.helperText");

  return (
    <section
      className={cn(
        "business-onboarding-guest-preview",
        isFinal && "business-onboarding-guest-preview--final",
      )}
      aria-label={t("business.onboarding.preview.panelAria")}
    >
      <div className="business-onboarding-guest-preview__intro">
        <div className="business-onboarding-guest-preview__heading-row">
          <p className="business-onboarding-guest-preview__label" id="onboarding-guest-preview-label">
            {isFinal
              ? t("business.onboarding.preview.reviewLabel")
              : t("business.onboarding.preview.liveLabel")}
          </p>
          <span className="business-onboarding-guest-preview__badge">
            {t("business.onboarding.preview.previewOnlyBadge")}
          </span>
        </div>
        <p className="business-onboarding-guest-preview__helper">{helperText}</p>
      </div>

      <div
        className={cn(
          "business-onboarding-guest-preview__device-wrap",
          isFinal && "business-onboarding-guest-preview__device-wrap--final",
        )}
        role="group"
        aria-labelledby="onboarding-guest-preview-label"
      >
        <p id="onboarding-guest-preview-helper" className="sr-only">
          {hasBusinessName
            ? t("business.onboarding.preview.guestAriaNamed", { name: displayName })
            : t("business.onboarding.preview.guestAria")}
        </p>

        {isFinal ? (
          <>
            <PhoneMockup
              size="xl"
              maxShellHeight={580}
              variant="iphone-15-pro"
              label={t("business.onboarding.preview.panelAria")}
              className="business-onboarding-guest-preview__phone-mockup"
            >
              <div className="business-onboarding-final-phone flex h-full min-h-0 flex-col">
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
            </PhoneMockup>
            <BusinessOnboardingCustomerJourney className="business-onboarding-guest-preview__customer-journey" />
          </>
        ) : (
          <>
        <div className="business-onboarding-guest-preview__device" aria-hidden="true">
          <div className="business-onboarding-guest-preview__device-notch" />
          <div
            className="business-onboarding-guest-preview__device-screen customer-flow"
          >
            <div className="business-onboarding-guest-preview__chrome-header">
              <CareTipLogo
                size="customer"
                className="business-onboarding-guest-preview__chrome-caretip-logo shrink-0"
              />
              <div className="business-onboarding-guest-preview__chrome-titles">
                <p
                  className={cn(
                    "business-onboarding-guest-preview__chrome-name",
                    venueNameLine.isPlaceholder && "business-onboarding-guest-preview__text--placeholder",
                  )}
                >
                  {displayName}
                </p>
                <p className="business-onboarding-guest-preview__chrome-sub">{chromeSubtitle}</p>
              </div>
            </div>

            <div className="business-onboarding-guest-preview__scroll">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className={cf.card}>
                  <div className="business-onboarding-guest-preview__hero">
                    <BusinessLogoMark
                      logoPathOrUrl={heroLogoSrc}
                      businessName={displayName}
                      size="customer"
                      className="business-onboarding-guest-preview__hero-logo"
                    />
                  </div>
                  <CardContent className="space-y-4 p-5 pt-3">
                    <div className="business-onboarding-guest-preview__meta-row">
                      <span className="business-onboarding-guest-preview__meta-item">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                        <span
                          className={cn(
                            addressLine.isPlaceholder &&
                              "business-onboarding-guest-preview__text--placeholder",
                          )}
                        >
                          {addressLine.text}
                        </span>
                      </span>
                      <span className="business-onboarding-guest-preview__meta-item">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                        <span
                          className={cn(
                            venueTypeLine.isPlaceholder && "business-onboarding-guest-preview__text--placeholder",
                          )}
                        >
                          {venueTypeLine.text}
                        </span>
                      </span>
                    </div>
                    <div className="business-onboarding-guest-preview__staff-pill">
                      <Users className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                      <span>
                        {employeeCount > 0
                          ? t("tipFlow.qrLanding.staffReady", { count: employeeCount })
                          : t("business.onboarding.preview.staffReadyGeneric")}
                      </span>
                    </div>
                  </CardContent>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
                className="business-onboarding-guest-preview__stack-gap"
              >
                <PreviewStaffCard staff={previewStaff} t={t} />
              </motion.div>
            </div>

            <div className="business-onboarding-guest-preview__bottom-bar">
              <div className="business-onboarding-guest-preview__bottom-cta" role="presentation">
                {t("business.onboarding.preview.previewPayBar")}
              </div>
            </div>
          </div>
        </div>

            <div className="business-onboarding-guest-preview__device-shadow" aria-hidden />
          </>
        )}
      </div>
    </section>
  );
}
