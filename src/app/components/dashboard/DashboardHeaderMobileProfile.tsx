import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router";
import { Loader2, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CareIcon } from "@/components/icons";
import { EmployeeProfilePhoto, ProfileAvatar } from "../ui/profile-avatar";
import { MobileDrawer } from "../ui/MobileDrawer";
import { useAuth } from "../../hooks/useAuth";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../../lib/authLogoutTransition";
import { cn } from "@/lib/utils";

type DashboardHeaderMobileProfileProps = {
  displayName: string;
  displayEmail: string;
  avatarSrc?: string | null;
  settingsHref: string;
  employeePhoto?: boolean;
  /** Replaces the avatar, in the header button and in the sheet. */
  renderMark?: (place: "trigger" | "sheet") => ReactNode;
  className?: string;
};

export function DashboardHeaderMobileProfile({
  displayName,
  displayEmail,
  avatarSrc,
  settingsHref,
  employeePhoto = false,
  renderMark,
  className,
}: DashboardHeaderMobileProfileProps) {
  const { t } = useTranslation();
  const { user, logout, exitImpersonation } = useAuth();
  const [open, setOpen] = useState(false);
  const signingOut = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );
  const HeaderPhoto = employeePhoto ? EmployeeProfilePhoto : ProfileAvatar;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "caretip-dashboard-header-icon-btn caretip-dashboard-header-profile-trigger lg:hidden",
          className,
        )}
        aria-label={t("shell.header.profileMenuAria")}
        aria-expanded={open}
      >
        {renderMark ? (
          renderMark("trigger")
        ) : (
          <HeaderPhoto
            src={avatarSrc}
            displayName={displayName}
            className="h-8 w-8 ring-2 ring-accent/25"
            lightbox={false}
          />
        )}
      </button>
      <MobileDrawer
        isOpen={open}
        onClose={() => setOpen(false)}
        side="bottom"
        ariaLabel={t("shell.header.profileMenuAria")}
      >
        <div className="caretip-profile-sheet">
          <div className="caretip-profile-sheet__grip" aria-hidden />
          <div className="caretip-profile-sheet__identity">
            {renderMark ? (
              renderMark("sheet")
            ) : (
              <HeaderPhoto
                src={avatarSrc}
                displayName={displayName}
                className="h-14 w-14 shrink-0"
                lightbox={false}
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="caretip-profile-sheet__name">{displayName}</p>
              <p className="caretip-profile-sheet__email">{displayEmail}</p>
            </div>
          </div>
          <div className="caretip-profile-sheet__actions">
            <Link
              to={settingsHref}
              onClick={() => setOpen(false)}
              className="caretip-profile-sheet__action touch-manipulation"
            >
              <Settings className="h-5 w-5 shrink-0" aria-hidden />
              {t("shell.nav.settings")}
            </Link>
            <button
              type="button"
              disabled={signingOut}
              aria-busy={signingOut}
              onClick={() => {
                if (signingOut) return;
                if (user?.impersonation) {
                  void exitImpersonation();
                  setOpen(false);
                  return;
                }
                /* Stay open: unmount + overflow unlock races the logout cover (mobile jitter). */
                logout();
              }}
              className="caretip-profile-sheet__action touch-manipulation"
            >
              <CareIcon name="signOut" size="md" />
              {signingOut ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : null}
              {t("dashboard.signOut")}
            </button>
          </div>
        </div>
      </MobileDrawer>
    </>
  );
}
