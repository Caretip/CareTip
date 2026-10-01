import type { ElementType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";
import { platformUi } from "./platformDashboardUi";

export {
  PlatformAdminSection,
  PlatformAdminMetricStrip,
  PlatformAdminFilterBar,
  PlatformAdminEmptyBlock,
} from "./PlatformAdminWorkspace";

export function PlatformPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(platformUi.page, className)}>
      <div className={platformUi.pageInner}>{children}</div>
    </div>
  );
}

export function PlatformPageHeader({
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  className,
  children,
  actions,
  hideDefaultEyebrow = false,
}: {
  icon?: ElementType;
  /** Module kicker above the title — defaults to admin.workspace.eyebrow when omitted. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  className?: string;
  children?: ReactNode;
  actions?: ReactNode;
  hideDefaultEyebrow?: boolean;
}) {
  const { t } = useTranslation();
  const kicker = eyebrow ?? (hideDefaultEyebrow ? null : t("admin.workspace.eyebrow"));

  return (
    <header className={cn(platformUi.pageHeader, className)}>
      <div className={platformUi.pageTitleRow}>
        <div className="min-w-0 flex-1">
          {kicker ? <p className={cn(dashboardWorkspaceUi.eyebrow, platformUi.pageEyebrow)}>{kicker}</p> : null}
          <div className="mt-1 flex items-start gap-2.5">
            {Icon ? <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground sm:h-[1.35rem] sm:w-[1.35rem]" aria-hidden /> : null}
            <div className="min-w-0">
              <h1 className={platformUi.pageTitle}>{title}</h1>
              {subtitle ? <p className={platformUi.pageSubtitle}>{subtitle}</p> : null}
            </div>
          </div>
        </div>
        {actions ? <div className={platformUi.pageHeaderActions}>{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

export function PlatformSearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  hint,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn(platformUi.searchSection, className)}>
      <div className={platformUi.searchWrap}>
        <Search className={platformUi.searchIcon} aria-hidden />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          aria-label={ariaLabel}
          className={platformUi.searchInput}
        />
      </div>
      {hint ? <p className={platformUi.searchHint}>{hint}</p> : null}
    </div>
  );
}

export type PlatformDataPanelSurface = "panel" | "open";

export function PlatformDataPanel({
  children,
  footer,
  className,
  surface = "open",
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  surface?: PlatformDataPanelSurface;
}) {
  return (
    <section
      className={cn(
        surface === "open" ? "platform-admin-data-section--open" : platformUi.dataPanel,
        "platform-admin-data-section",
        className,
      )}
    >
      <div className="platform-admin-data-section__body">{children}</div>
      {footer ? <div className={platformUi.panelFooter}>{footer}</div> : null}
    </section>
  );
}

export function PlatformResponsiveData({
  mobile,
  desktop,
  footer,
  surface = "open",
}: {
  mobile: ReactNode;
  desktop: ReactNode;
  footer?: ReactNode;
  surface?: PlatformDataPanelSurface;
}) {
  return (
    <PlatformDataPanel footer={footer} surface={surface}>
      <div className={cn(platformUi.mobileList, "platform-admin-mobile-list")}>{mobile}</div>
      <div className={platformUi.tableWrap}>{desktop}</div>
    </PlatformDataPanel>
  );
}
