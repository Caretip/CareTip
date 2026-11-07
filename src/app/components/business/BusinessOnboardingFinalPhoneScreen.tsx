import { Home, Lock, RotateCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BusinessLogoMark } from "./BusinessLogoMark";
import type { TipPreviewStaffMember } from "./BusinessOnboardingGuestPreview.types";

type PreviewLine = { text: string; isPlaceholder: boolean };

type BusinessOnboardingFinalPhoneScreenProps = {
  displayName: string;
  venueNameLine: PreviewLine;
  /** Not shown: the guest page carries neither the type nor the address. */
  venueTypeLine?: PreviewLine;
  addressLine?: PreviewLine;
  heroLogoSrc: string | null;
  tipStaff: TipPreviewStaffMember[];
  employeeCount?: number;
};

function StatusBarIcons() {
  return (
    <span className="onb-phone__status-icons" aria-hidden>
      <svg viewBox="0 0 18 12" width="18" height="12">
        <rect x="0" y="8" width="3" height="4" rx="0.8" />
        <rect x="5" y="5.5" width="3" height="6.5" rx="0.8" />
        <rect x="10" y="3" width="3" height="9" rx="0.8" />
        <rect x="15" y="0" width="3" height="12" rx="0.8" />
      </svg>
      <svg viewBox="0 0 16 12" width="16" height="12">
        <path d="M8 2.6c2.3 0 4.4.9 6 2.4l1.3-1.4A10.4 10.4 0 0 0 8 .7 10.4 10.4 0 0 0 .7 3.6L2 5c1.6-1.5 3.7-2.4 6-2.4Zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.3-1.4A6.8 6.8 0 0 0 8 4.3a6.8 6.8 0 0 0-4.7 1.8l1.3 1.4c.9-.8 2.1-1.3 3.4-1.3Zm0 3.5c.5 0 1 .2 1.3.5L8 11.6 6.7 10.2c.3-.3.8-.5 1.3-.5Z" />
      </svg>
      <span className="onb-phone__battery">
        <span />
      </span>
    </span>
  );
}

function StaffTile({ member, tipLabel }: { member: TipPreviewStaffMember; tipLabel: string }) {
  const initial = member.displayName.trim().charAt(0).toUpperCase() || "?";
  return (
    <li className="onb-phone__staff">
      <span className="onb-phone__staff-photo">
        {member.photoUrl ? (
          <img src={member.photoUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        ) : (
          <span className="onb-phone__staff-initial">{initial}</span>
        )}
      </span>
      <span className="onb-phone__staff-name">{member.displayName}</span>
      <span className="onb-phone__staff-role">{member.roleLabel}</span>
      <span className="onb-phone__tip">{tipLabel}</span>
    </li>
  );
}

/**
 * The guest page as guests see it after scanning the QR code: same layout and wording as
 * BusinessStaffDirectoryPage, inside the phone's browser. Built at a real 390px width and scaled.
 */
export function BusinessOnboardingFinalPhoneScreen({
  displayName,
  venueNameLine,
  heroLogoSrc,
  tipStaff,
}: BusinessOnboardingFinalPhoneScreenProps) {
  const { t } = useTranslation();

  return (
    <div className="onb-phone__screen">
      <div className="onb-phone__status">
        <span className="onb-phone__time">9:41</span>
        <span className="onb-phone__island" />
        <StatusBarIcons />
      </div>

      <div className="onb-phone__page">
        <div className="onb-phone__topbar">
          <span className="onb-phone__home" aria-hidden>
            <Home className="h-5 w-5" strokeWidth={2} />
          </span>
          <span className="onb-phone__lang" aria-hidden>
            <span className="onb-phone__flag" />
            DE
          </span>
        </div>

        <header className="onb-phone__venue">
          <BusinessLogoMark
            logoPathOrUrl={heroLogoSrc}
            businessName={displayName}
            size="md"
            className="onb-phone__logo"
          />
          <p className={venueNameLine.isPlaceholder ? "onb-phone__name onb-phone__name--placeholder" : "onb-phone__name"}>
            {displayName}
          </p>
          <p className="onb-phone__prompt">{t("tipFlow.header.selectTeamMember")}</p>
        </header>

        <div className="onb-phone__section">
          <p className="onb-phone__label">{t("tipFlow.locationLanding.searchTitle")}</p>
          <span className="onb-phone__search">
            <Search className="h-5 w-5" strokeWidth={2} aria-hidden />
            {t("tipFlow.qrLanding.searchPlaceholder")}
          </span>

          <p className="onb-phone__label onb-phone__label--team">{t("tipFlow.locationLanding.teamTitle")}</p>
          <ul className="onb-phone__grid">
            {tipStaff.slice(0, 4).map((member) => (
              <StaffTile key={member.id} member={member} tipLabel={t("tipFlow.qrLanding.tipCta")} />
            ))}
          </ul>
        </div>
      </div>

      <div className="onb-phone__browser" aria-hidden>
        <span className="onb-phone__address">
          <span className="onb-phone__aa">aA</span>
          <span className="onb-phone__url">
            <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
            caretip.de
          </span>
          <RotateCw className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <span className="onb-phone__home-indicator" />
      </div>
    </div>
  );
}
