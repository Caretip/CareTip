import { useNavigate } from "react-router";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import { prefetchPlatformAdminRoute } from "@/app/lib/platformAdminRoutePrefetch";
import { useSidebarNavigationPath } from "@/app/hooks/useBusinessSidebarNavigationPath";
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

function warmSidebarDestination(href: string): void {
  void prefetchPlatformAdminRoute(href);
}

function SidebarLink({
  entry,
  pathname,
  navPending,
  onNavigate,
}: {
  entry: Extract<PlatformAdminNavEntry, { type: "link" }>;
  pathname: string;
  navPending: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const isActive =
    entry.id === "overview"
      ? isPlatformAdminOverviewActive(pathname)
      : pathname === entry.href || pathname.startsWith(`${entry.href}/`);

  return (
    <li>
      <PrefetchLink
        to={entry.href}
        onPointerDown={() => warmSidebarDestination(entry.href)}
        onClick={onNavigate}
        className={cn(
          "admin-dash-nav-link flex items-center gap-3 px-3 py-2.5 text-sm font-medium",
          isActive
            ? cn(
                "admin-dash-nav-link--active font-semibold text-foreground",
                navPending && "admin-dash-nav-link--pending",
              )
            : dashboardSidebarNavLinkIdle,
        )}
        aria-current={isActive ? "page" : undefined}
      >
        <CareIcon name={entry.icon} size="nav" />
        <span className="truncate tracking-tight">{t(entry.labelKey)}</span>
      </PrefetchLink>
    </li>
  );
}

function SidebarChildLink({
  child,
  pathname,
  navPending,
  onNavigate,
}: {
  child: PlatformAdminChildNavItem;
  pathname: string;
  navPending: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const childActive = isPlatformAdminChildActive(child.href, pathname);

  return (
    <li>
      <PrefetchLink
        to={child.href}
        onPointerDown={() => warmSidebarDestination(child.href)}
        onClick={onNavigate}
        className={cn(
          "admin-sidebar-child-link business-sidebar-child-link flex w-full flex-col items-stretch py-2 pl-11 pr-3 text-left text-[13px] font-medium transition-colors",
          childActive
            ? cn("text-primary before:bg-primary", navPending && "admin-sidebar-child-link--pending")
            : "text-sidebar-foreground/75 hover:text-sidebar-foreground before:bg-transparent",
        )}
        aria-current={childActive ? "page" : undefined}
      >
        <span className="truncate">{t(child.labelKey)}</span>
      </PrefetchLink>
    </li>
  );
}

function SidebarGroup({
  entry,
  pathname,
  navPending,
  isExpanded,
  onToggle,
  onNavigate,
}: {
  entry: Extract<PlatformAdminNavEntry, { type: "group" }>;
  pathname: string;
  navPending: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groupActive = isPlatformAdminGroupActive(entry, pathname);
  const panelId = `platform-sidebar-group-${entry.id}`;

  function handleGroupClick() {
    if (isExpanded) {
      onToggle();
      return;
    }
    onToggle();
    if (!groupActive) {
      warmSidebarDestination(entry.defaultHref);
      navigate(entry.defaultHref);
    }
  }

  return (
    <li className="business-sidebar-group">
      <button
        type="button"
        onClick={handleGroupClick}
        onMouseEnter={() => warmSidebarDestination(entry.defaultHref)}
        onFocus={() => warmSidebarDestination(entry.defaultHref)}
        className={cn(
          "admin-dash-nav-link flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium transition-colors",
          groupActive
            ? cn(
                "admin-dash-nav-link--active font-semibold text-sidebar-foreground",
                navPending && "admin-dash-nav-link--pending",
              )
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
              navPending={navPending}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </div>
    </li>
  );
}

export function PlatformSidebarNavShell({ onNavigate }: PlatformSidebarNavShellProps) {
  const { pathname, pending: navPending } = useSidebarNavigationPath();
  const { isExpanded, toggleGroup } = usePlatformAdminSidebarNavState();

  return (
    <ul className="space-y-0.5">
      {platformAdminNavEntries.map((entry) => {
        if (entry.type === "link") {
          return (
            <SidebarLink
              key={entry.id}
              entry={entry}
              pathname={pathname}
              navPending={navPending}
              onNavigate={onNavigate}
            />
          );
        }
        return (
          <SidebarGroup
            key={entry.id}
            entry={entry}
            pathname={pathname}
            navPending={navPending}
            isExpanded={isExpanded(entry.id)}
            onToggle={() => toggleGroup(entry.id)}
            onNavigate={onNavigate}
          />
        );
      })}
    </ul>
  );
}
