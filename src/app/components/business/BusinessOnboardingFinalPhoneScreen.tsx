import { useEffect, useState } from "react";
import { Building2, Lock, Signal, Users, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BusinessLogoMark } from "./BusinessLogoMark";
import { EmployeeProfilePhoto } from "../ui/profile-avatar";
import { customerFlowUi as cf } from "../../pages/customer/customerFlowUi";
import { cn } from "@/lib/utils";
import type { TipPreviewStaffMember } from "./BusinessOnboardingGuestPreview.types";

type PreviewLine = { text: string; isPlaceholder: boolean };

type BusinessOnboardingFinalPhoneScreenProps = {
  displayName: string;
  venueNameLine: PreviewLine;
  venueTypeLine: PreviewLine;
  addressLine: PreviewLine;
  heroLogoSrc: string | null;
  tipStaff: TipPreviewStaffMember[];
  employeeCount: number;
};

function PreviewInfoCard({
  icon: Icon,
  label,
  value,
  isPlaceholder,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  isPlaceholder?: boolean;
}) {
  return (
    <div className="business-onboarding-final-phone__info-card">
      <div className="business-onboarding-final-phone__info-icon" aria-hidden>
        <Icon className="h-3.5 w-3.5 text-primary" strokeWidth={2.25} />
      </div>
      <div className="business-onboarding-final-phone__info-copy">
        <p className="business-onboarding-final-phone__info-label">{label}</p>
        <p
          className={cn(
            "business-onboarding-final-phone__info-value",
            isPlaceholder && "business-onboarding-guest-preview__text--placeholder",
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function TippableStaffGrid({
  staff,
  selectedId,
  onSelect,
}: {
  staff: TipPreviewStaffMember[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="business-onboarding-final-phone__staff-section business-onboarding-final-phone__staff-section--tippable">
      <div className="business-onboarding-final-phone__staff-pill">
        <Users className="h-4 w-4 shrink-0 text-primary" strokeWidth={2.25} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="business-onboarding-final-phone__staff-pill-title">
            {t("business.onboarding.preview.selectStaffToTip")}
          </p>
          <p className="business-onboarding-final-phone__staff-pill-desc">
            {t("business.onboarding.preview.tapStaffToTip")}
          </p>
        </div>
      </div>
      <ul className="business-onboarding-final-phone__staff-grid">
        {staff.map((member) => {
          const isSelected = member.id === selectedId;
          return (
            <li key={member.id}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(member.id)}
                className={cn(
                  "business-onboarding-final-phone__staff-tile-btn",
                  cf.selectableTile,
                  isSelected ? cf.selectableOn : cf.selectableIdle,
                )}
              >
                <EmployeeProfilePhoto
                  src={member.photoUrl}
                  displayName={member.displayName}
                  lightbox={false}
                  className={cn(
                    "business-onboarding-final-phone__staff-photo",
                    isSelected
                      ? "h-[3.5rem] w-[3.5rem] ring-[3px] ring-primary/45"
                      : "h-[3.25rem] w-[3.25rem] ring-2 ring-primary/25",
                  )}
                />
                <span className="business-onboarding-final-phone__staff-name business-onboarding-final-phone__staff-name--premium">
                  {member.displayName}
                </span>
                <span className="business-onboarding-final-phone__staff-role">{member.roleLabel}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BusinessOnboardingFinalPhoneScreen({
  displayName,
  venueNameLine,
  venueTypeLine,
  addressLine,
  heroLogoSrc,
  tipStaff,
  employeeCount,
}: BusinessOnboardingFinalPhoneScreenProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState(tipStaff[0]?.id ?? "");

  useEffect(() => {
    if (tipStaff.length === 0) {
      setSelectedId("");
      return;
    }
    if (!tipStaff.some((member) => member.id === selectedId)) {
      setSelectedId(tipStaff[0]!.id);
    }
  }, [tipStaff, selectedId]);

  const selected = tipStaff.find((member) => member.id === selectedId) ?? tipStaff[0];

  const guestStatusTitle =
    employeeCount > 0
      ? t("tipFlow.qrLanding.staffReady", { count: employeeCount })
      : t("tipFlow.qrLanding.leaveTip");

  const guestStatusSub = t("tipFlow.qrLanding.secureFooter");

  return (
    <>
      <div className="business-onboarding-guest-preview__status-bar">
        <span className="business-onboarding-guest-preview__status-time">9:41</span>
        <div className="business-onboarding-guest-preview__status-icons">
          <Signal className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
          <Wifi className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
          <span className="business-onboarding-guest-preview__status-battery" aria-hidden />
        </div>
      </div>

      <header className="business-onboarding-final-phone__header">
        <BusinessLogoMark
          logoPathOrUrl={heroLogoSrc}
          businessName={displayName}
          size="sm"
          className="business-onboarding-final-phone__header-logo shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "business-onboarding-final-phone__header-name",
              venueNameLine.isPlaceholder && "business-onboarding-guest-preview__text--placeholder",
            )}
          >
            {displayName}
          </p>
          <p
            className={cn(
              "business-onboarding-final-phone__header-sub",
              addressLine.isPlaceholder && "business-onboarding-guest-preview__text--placeholder",
            )}
          >
            {addressLine.text}
          </p>
        </div>
      </header>

      <div className="business-onboarding-final-phone__scroll">
        <div className="business-onboarding-final-phone__hero">
          <span className="business-onboarding-final-phone__live-chip">
            <span className="business-onboarding-final-phone__live-dot" aria-hidden />
            {t("tipFlow.qrLanding.tippingLabel")}
          </span>
          <div className="business-onboarding-final-phone__hero-visual">
            <BusinessLogoMark
              logoPathOrUrl={heroLogoSrc}
              businessName={displayName}
              size="customer"
              className="business-onboarding-final-phone__hero-logo"
            />
          </div>
          <p className="business-onboarding-final-phone__hero-title">
            {t("tipFlow.qrLanding.whoServedYou")}
          </p>
          <p className="business-onboarding-final-phone__hero-sub">
            {t("tipFlow.qrLanding.whoServedYouDesc")}
          </p>
        </div>

        <TippableStaffGrid staff={tipStaff} selectedId={selectedId} onSelect={setSelectedId} />

        <div className="business-onboarding-final-phone__info-stack">
          <PreviewInfoCard
            icon={Building2}
            label={t("business.onboarding.preview.infoVenue")}
            value={venueTypeLine.text}
            isPlaceholder={venueTypeLine.isPlaceholder}
          />
        </div>

        <div className="business-onboarding-final-phone__trust-card">
          <div className="business-onboarding-final-phone__trust-icon" aria-hidden>
            <Lock className="h-3.5 w-3.5 text-primary" strokeWidth={2.25} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="business-onboarding-final-phone__trust-title">
              {t("business.onboarding.preview.trustTitle")}
            </p>
            <p className="business-onboarding-final-phone__trust-body">
              {t("business.onboarding.preview.trustBody")}
            </p>
          </div>
        </div>

        <div className="business-onboarding-final-phone__status-card">
          <span className="business-onboarding-final-phone__status-dot" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="business-onboarding-final-phone__status-title">{guestStatusTitle}</p>
            <p className="business-onboarding-final-phone__status-sub">{guestStatusSub}</p>
          </div>
          <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-600/70 dark:text-emerald-400/75" strokeWidth={2} aria-hidden />
        </div>
      </div>

      <footer className="business-onboarding-final-phone__footer">
        <div className="business-onboarding-final-phone__cta" role="presentation">
          {selected
            ? t("business.onboarding.preview.tipButtonPreviewNamed", { name: selected.displayName })
            : t("business.onboarding.preview.tipButtonPreview")}
        </div>
        <p className="business-onboarding-final-phone__cta-helper">
          {t("business.onboarding.preview.ctaHelper")}
        </p>
        <div className="business-onboarding-guest-preview__home-indicator" aria-hidden />
      </footer>
    </>
  );
}
