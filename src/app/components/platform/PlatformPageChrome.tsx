import type { ElementType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { platformUi } from "./platformDashboardUi";
import { ConsoleHeader, ConsoleSearch, type ConsoleCrumb } from "./console/AdminConsole";
import { PLATFORM_ADMIN_OVERVIEW_HREF, platformAdminNavEntries } from "./platformAdminNav";

export {
  PlatformAdminSection,
  PlatformAdminMetricStrip,
  PlatformAdminFilterBar,
  PlatformAdminEmptyBlock,
} from "./PlatformAdminWorkspace";

export {
  PlatformAdminMetricCell,
  PlatformAdminFreshnessIndicator,
  PlatformAdminStatusBadge,
} from "./PlatformAdminDesignPrimitives";
export type { PlatformAdminStatusTone } from "./PlatformAdminDesignPrimitives";

/** Admin console page frame (see console/AdminConsole + styles/admin-console.css). */
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

/** Breadcrumb from the sidebar nav: Platform admin › Module (› current page when it differs). */
function usePlatformCrumbs(title: string): ConsoleCrumb[] {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const crumbs: ConsoleCrumb[] = [{ label: t("admin.workspace.eyebrow"), href: PLATFORM_ADMIN_OVERVIEW_HREF }];
  for (const entry of platformAdminNavEntries) {
    if (entry.type !== "group") continue;
    const child = entry.children.find((c) => pathname === c.href || pathname.startsWith(`${c.href}/`));
    if (child) {
      crumbs.push({ label: t(entry.labelKey), href: entry.defaultHref });
      const childLabel = t(child.labelKey);
      if (childLabel !== title) crumbs.push({ label: childLabel, href: child.href });
      return crumbs;
    }
  }
  return crumbs;
}

export function PlatformPageHeader({
  icon,
  eyebrow,
  title,
  subtitle,
  className,
  children,
  actions,
  hideDefaultEyebrow = false,
}: {
  icon?: ElementType;
  /** Module kicker above the title — replaced by the nav breadcrumb unless given explicitly. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  className?: string;
  children?: ReactNode;
  actions?: ReactNode;
  hideDefaultEyebrow?: boolean;
}) {
  const navCrumbs = usePlatformCrumbs(title);
  const crumbs = eyebrow ? [{ label: eyebrow }] : hideDefaultEyebrow ? undefined : navCrumbs;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <ConsoleHeader icon={icon} crumbs={crumbs} title={title} description={subtitle} actions={actions} />
      {children}
    </div>
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
    <div className={cn("flex flex-col gap-1.5", className)}>
      <ConsoleSearch value={value} onChange={onChange} placeholder={placeholder} label={ariaLabel} wide />
      {hint ? <p className="ac-field__hint">{hint}</p> : null}
    </div>
  );
}

export type PlatformDataPanelSurface = "panel" | "open";

/** Data surface: always a console card (the "open" variant is kept for API compatibility). */
export function PlatformDataPanel({
  children,
  footer,
  className,
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  surface?: PlatformDataPanelSurface;
}) {
  return (
    <section className={cn("ac-card overflow-hidden", className)}>
      <div className="min-w-0">{children}</div>
      {footer ? <div className={platformUi.panelFooter}>{footer}</div> : null}
    </section>
  );
}

export function PlatformResponsiveData({
  mobile,
  desktop,
  footer,
}: {
  mobile: ReactNode;
  desktop: ReactNode;
  footer?: ReactNode;
  surface?: PlatformDataPanelSurface;
}) {
  return (
    <PlatformDataPanel footer={footer}>
      <div className={platformUi.mobileList}>{mobile}</div>
      <div className={platformUi.tableWrap}>{desktop}</div>
    </PlatformDataPanel>
  );
}
