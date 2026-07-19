import { Link } from "react-router";
import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProfileAvatar } from "../ui/profile-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { ThemeQuickToggle } from "@/app/components/theme/ThemeQuickToggle";
import { cn } from "@/lib/utils";

type DashboardHeaderMobileProfileProps = {
  displayName: string;
  displayEmail: string;
  avatarSrc?: string | null;
  settingsHref: string;
  className?: string;
};

export function DashboardHeaderMobileProfile({
  displayName,
  displayEmail,
  avatarSrc,
  settingsHref,
  className,
}: DashboardHeaderMobileProfileProps) {
  const { t } = useTranslation();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "caretip-dashboard-header-icon-btn caretip-dashboard-header-profile-trigger lg:hidden",
            className,
          )}
          aria-label={t("shell.header.profileMenuAria")}
        >
          <ProfileAvatar
            src={avatarSrc}
            displayName={displayName}
            className="h-8 w-8 ring-2 ring-accent/25"
            lightbox={false}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(100vw-1.5rem,16rem)] rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-xl lg:hidden"
      >
        <div className="border-b border-border/80 px-4 py-3">
          <div className="flex items-center gap-3">
            <ProfileAvatar
              src={avatarSrc}
              displayName={displayName}
              className="h-10 w-10 ring-2 ring-accent/25"
              lightbox={false}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{displayEmail}</p>
            </div>
          </div>
        </div>
        <div className="space-y-2 p-1.5">
          <Link
            to={settingsHref}
            className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Settings className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {t("shell.nav.settings")}
          </Link>
          <div className="caretip-dashboard-header-profile-secondary flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {t("shell.drawer.preferences")}
            </span>
            <div className="flex items-center gap-1.5">
              <ThemeQuickToggle className="!min-h-8 !min-w-8 !rounded-lg !px-2 !py-1.5 !shadow-none" />
              <LanguageSwitcher variant="dashboard" className="!min-h-8 !min-w-8 !rounded-lg !px-2 !py-1.5" />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
