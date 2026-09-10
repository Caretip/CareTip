import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Lock } from "lucide-react";
import { CareIcon } from "@/components/icons";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  dashboardSidebarNavLinkActive,
  dashboardSidebarNavLinkBase,
  dashboardSidebarNavLinkIdle,
} from "@/lib/theme/dashboardSidebarUi";
import {
  employeeDashboardNavEntries,
  isEmployeeDashboardNavActive,
  isEmployeePaymentsGroupActive,
  showEmployeeNavSubscriptionLock,
  type EmployeeDashboardNavEntry,
} from "./employeeDashboardNav";
import type { BusinessSubscriptionTier } from "@/app/lib/subscriptionCapabilities";

export function EmployeeSidebarNav({
  entitlementsReady,
  tier,
  onNavigate,
}: {
  entitlementsReady: boolean;
  tier: BusinessSubscriptionTier | undefined | null;
  onNavigate?: () => void;
}) {
  const location = useLocation();

  return (
    <ul className="space-y-0.5">
      {employeeDashboardNavEntries.map((entry) =>
        entry.type === "link" ? (
          <EmployeeSidebarLink
            key={entry.href}
            entry={entry}
            pathname={location.pathname}
            entitlementsReady={entitlementsReady}
            tier={tier}
            onNavigate={onNavigate}
          />
        ) : (
          <EmployeeSidebarGroup
            key={entry.id}
            entry={entry}
            pathname={location.pathname}
            onNavigate={onNavigate}
          />
        ),
      )}
    </ul>
  );
}

function EmployeeSidebarLink({
  entry,
  pathname,
  entitlementsReady,
  tier,
  onNavigate,
}: {
  entry: Extract<EmployeeDashboardNavEntry, { type: "link" }>;
  pathname: string;
  entitlementsReady: boolean;
  tier: BusinessSubscriptionTier | undefined | null;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const isActive = isEmployeeDashboardNavActive(entry.href, pathname);
  const subscriptionLocked = showEmployeeNavSubscriptionLock(entitlementsReady, entry, tier);

  return (
    <li>
      <Link
        to={entry.href}
        onClick={onNavigate}
        className={cn(
          "employee-dash-nav-link",
          dashboardSidebarNavLinkBase,
          isActive ? cn("employee-dash-nav-link--active", dashboardSidebarNavLinkActive) : dashboardSidebarNavLinkIdle,
        )}
        aria-current={isActive ? "page" : undefined}
      >
        <CareIcon name={entry.icon} size="nav" />
        <span className="flex min-w-0 flex-1 items-center gap-2 tracking-tight">
          <span className="truncate">{t(entry.labelKey)}</span>
          {subscriptionLocked ? (
            <Lock
              className="h-3.5 w-3.5 shrink-0 opacity-70"
              aria-label={t("subscription.nav.lockedAria", { feature: t(entry.labelKey) })}
            />
          ) : null}
        </span>
      </Link>
    </li>
  );
}

function EmployeeSidebarGroup({
  entry,
  pathname,
  onNavigate,
}: {
  entry: Extract<EmployeeDashboardNavEntry, { type: "group" }>;
  pathname: string;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groupActive = isEmployeePaymentsGroupActive(pathname);
  const [expanded, setExpanded] = useState(groupActive);
  const panelId = `employee-sidebar-group-${entry.id}`;

  useEffect(() => {
    if (groupActive) setExpanded(true);
  }, [groupActive]);

  return (
    <li>
      <button
        type="button"
        className={cn(
          "employee-dash-nav-link",
          dashboardSidebarNavLinkBase,
          "w-full text-left",
          groupActive ? cn("employee-dash-nav-link--active", dashboardSidebarNavLinkActive) : dashboardSidebarNavLinkIdle,
        )}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-current={groupActive ? "true" : undefined}
        onClick={() => {
          if (expanded) {
            setExpanded(false);
            return;
          }
          setExpanded(true);
          if (!groupActive) {
            navigate(entry.defaultHref);
            onNavigate?.();
          }
        }}
      >
        <CareIcon name={entry.icon} size="nav" />
        <span className="truncate tracking-tight">{t(entry.labelKey)}</span>
      </button>
      <div
        id={panelId}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        aria-hidden={!expanded}
      >
        <ul className="overflow-hidden" role="list">
          {entry.children.map((child) => {
            const childActive = pathname === child.href;
            return (
              <li key={child.href}>
                <Link
                  to={child.href}
                  onClick={onNavigate}
                  className={cn(
                    "employee-sidebar-child-link flex w-full items-center py-2 pl-11 pr-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    childActive
                      ? "text-primary"
                      : "text-sidebar-foreground/75 hover:text-sidebar-foreground",
                  )}
                  aria-current={childActive ? "page" : undefined}
                >
                  {t(child.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </li>
  );
}
