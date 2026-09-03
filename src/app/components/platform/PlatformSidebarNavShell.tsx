import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { CareIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { dashboardSidebarNavLinkIdle } from "@/lib/theme/dashboardSidebarUi";
import {
  isPlatformAdminChildActive,
  isPlatformAdminGroupActive,
  isPlatformAdminOverviewActive,
  platformAdminNavEntries,
  type PlatformAdminChildNavItem,
  type PlatformAdminNavEntry,
} from "./platformAdminNav";
import { usePlatformAdminSidebarNavState } from "@/app/hooks/usePlatformAdminSidebarNavState";

type PlatformSidebarNavShellProps = {
  onNavigate?: () => void;
};

function SidebarLink({
  entry,
  pathname,
  onNavigate,
}: {
  entry: Extract<PlatformAdminNavEntry, { type: "link" }>;
  pathname: string;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const isActive =
    entry.id === "overview"
      ? isPlatformAdminOverviewActive(pathname)
      : pathname === entry.href || pathname.startsWith(`${entry.href}/`);

  return (
    <li>
      <Link
        to={entry.href}
        onClick={onNavigate}
        className={cn(
          "admin-dash-nav-link flex items-center gap-3 px-3 py-2.5 text-sm font-medium",
          isActive
            ? "admin-dash-nav-link--active font-semibold text-foreground"
            : dashboardSidebarNavLinkIdle,
        )}
        aria-current={isActive ? "page" : undefined}
      >
        <CareIcon name={entry.icon} size="nav" />
        <span className="truncate tracking-tight">{t(entry.labelKey)}</span>
      </Link>
    </li>
  );
}

function SidebarChildLink({
  child,
  pathname,
  onNavigate,
}: {
  child: PlatformAdminChildNavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const childActive = isPlatformAdminChildActive(child.href, pathname);

  return (
    <li>
      <Link
        to={child.href}
        onClick={onNavigate}
        className={cn(
          "admin-sidebar-child-link business-sidebar-child-link flex w-full flex-col items-stretch py-2 pl-11 pr-3 text-left text-[13px] font-medium transition-colors",
          childActive
            ? "text-primary before:bg-primary"
            : "text-sidebar-foreground/75 hover:text-sidebar-foreground before:bg-transparent",
        )}
        aria-current={childActive ? "page" : undefined}
      >
        <span className="truncate">{t(child.labelKey)}</span>
      </Link>
    </li>
  );
}

function SidebarGroup({
  entry,
  pathname,
  isExpanded,
  onToggle,
  onNavigate,
}: {
  entry: Extract<PlatformAdminNavEntry, { type: "group" }>;
  pathname: string;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const groupActive = isPlatformAdminGroupActive(entry, pathname);
  const panelId = `platform-sidebar-group-${entry.id}`;

  return (
    <li className="business-sidebar-group">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "admin-dash-nav-link flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium transition-colors",
          groupActive
            ? "bg-sidebar-accent font-semibold text-sidebar-foreground"
            : dashboardSidebarNavLinkIdle,
        )}
        aria-expanded={isExpanded}
        aria-controls={panelId}
      >
        <CareIcon name={entry.icon} size="nav" />
        <span className="min-w-0 flex-1 truncate tracking-tight">{t(entry.labelKey)}</span>
      </button>
      <div
        id={panelId}
        className={cn(
          "business-sidebar-group-panel grid transition-[grid-template-rows] duration-200 ease-out",
          isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        aria-hidden={!isExpanded}
      >
        <ul className="overflow-hidden">
          {entry.children.map((child) => (
            <SidebarChildLink
              key={child.href}
              child={child}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </div>
    </li>
  );
}

export function PlatformSidebarNavShell({ onNavigate }: PlatformSidebarNavShellProps) {
  const { pathname } = useLocation();
  const { isExpanded, toggleGroup } = usePlatformAdminSidebarNavState();

  return (
    <ul className="space-y-0.5">
      {platformAdminNavEntries.map((entry) => {
        if (entry.type === "link") {
          return (
            <SidebarLink key={entry.id} entry={entry} pathname={pathname} onNavigate={onNavigate} />
          );
        }
        return (
          <SidebarGroup
            key={entry.id}
            entry={entry}
            pathname={pathname}
            isExpanded={isExpanded(entry.id)}
            onToggle={() => toggleGroup(entry.id)}
            onNavigate={onNavigate}
          />
        );
      })}
    </ul>
  );
}
