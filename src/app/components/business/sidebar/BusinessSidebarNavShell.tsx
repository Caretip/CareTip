import { useState } from "react";
import { useNavigate } from "react-router";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import { prefetchBusinessDashboardRoute } from "@/app/lib/businessDashboardRoutePrefetch";
import { useBusinessSidebarNavigationPath } from "@/app/hooks/useBusinessSidebarNavigationPath";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CareIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  dashboardSidebarNavLinkIdle,
} from "@/lib/theme/dashboardSidebarUi";
import type { FeatureKey } from "@/app/lib/subscriptionCapabilities";
import { useBusinessSidebarEntitlements } from "./useBusinessSidebarEntitlements";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/app/components/ui/tooltip";
import {
  businessSidebarNavEntries,
  isBusinessSidebarChildActive,
  isBusinessSidebarGroupActive,
  type BusinessSidebarChildNavItem,
  type BusinessSidebarNavEntry,
} from "../businessDashboardNav";
import { useBusinessSidebarNavState } from "@/app/hooks/useBusinessSidebarNavState";
import { getFeatureCatalog } from "@/app/lib/subscriptionFeatureCatalog";
import {
  planLabelKeyForFeature,
  resolveSidebarNavLock,
  type SidebarNavLockReason,
} from "./sidebarNavLock";
import { PremiumAccessDialog } from "./PremiumAccessDialog";
import { BusinessSidebarSubscriptionStatus } from "./BusinessSidebarSubscriptionStatus";
import { ACTIVATION_DIALOG_CLOSE_MS } from "@/app/lib/activateCareTipNavigation";
import { ProductFeedbackSidebarNavItem } from "@/app/components/product-feedback/ProductFeedbackSidebarNavItem";

type BusinessSidebarNavShellProps = {
  onNavigate?: () => void;
  showSubscriptionStatus?: boolean;
};

type LockedDialogState = {
  featureKey: FeatureKey;
  reason: SidebarNavLockReason;
};

function useSidebarEntitlements() {
  return useBusinessSidebarEntitlements();
}

function warmSidebarDestination(href: string): void {
  void prefetchBusinessDashboardRoute(href);
}

function SidebarLink({
  entry,
  pathname,
  navPending,
  onNavigate,
}: {
  entry: Extract<BusinessSidebarNavEntry, { type: "link" }>;
  pathname: string;
  navPending: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const isActive =
    entry.href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === entry.href || pathname.startsWith(`${entry.href}/`);

  return (
    <li>
      <PrefetchLink
        to={entry.href}
        onPointerDown={() => warmSidebarDestination(entry.href)}
        onClick={onNavigate}
        className={cn(
          "business-dash-nav-link flex items-center gap-3 px-3 py-2.5 text-sm font-medium",
          isActive
            ? cn(
                "business-dash-nav-link--active font-semibold text-foreground",
                navPending && "business-dash-nav-link--pending",
              )
            : dashboardSidebarNavLinkIdle,
        )}
        aria-current={isActive ? "page" : undefined}
      >
        <span className="business-dash-nav-icon" aria-hidden>
          <CareIcon name={entry.icon} size="nav" />
        </span>
        <span className="truncate tracking-tight">{t(entry.labelKey)}</span>
      </PrefetchLink>
    </li>
  );
}

function SidebarChildNavItem({
  child,
  groupId,
  pathname,
  search,
  navPending,
  entitlements,
  onNavigate,
  onLockedClick,
}: {
  child: BusinessSidebarChildNavItem;
  groupId: string;
  pathname: string;
  search: string;
  navPending: boolean;
  entitlements: ReturnType<typeof useSidebarEntitlements>;
  onNavigate?: () => void;
  onLockedClick: (state: LockedDialogState) => void;
}) {
  const { t } = useTranslation();
  const childActive = isBusinessSidebarChildActive(child.href, pathname, search);
  const lock = resolveSidebarNavLock(child.href, child.featureKey, groupId, entitlements);
  const catalog = getFeatureCatalog(lock.dialogFeatureKey);
  const planLabel = t(planLabelKeyForFeature(lock.dialogFeatureKey));

  const secondaryLabel = lock.locked
    ? t("dashboardNav.business.locked.includedInPlan", { plan: planLabel })
    : null;

  const itemBody = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {lock.locked ? (
          <Lock className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{t(child.labelKey)}</span>
      </span>
      {secondaryLabel ? (
        <span className="mt-0.5 block pl-5 text-[11px] font-normal leading-snug text-muted-foreground">
          {secondaryLabel}
        </span>
      ) : null}
    </>
  );

  const itemClass = cn(
    "business-sidebar-child-link flex w-full flex-col items-stretch py-1.5 pl-11 pr-3 text-left font-sans text-xs font-medium leading-snug tracking-tight transition-colors",
    lock.locked
      ? "cursor-pointer text-sidebar-foreground/55 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/75"
      : childActive
        ? cn("text-primary before:bg-primary", navPending && "business-sidebar-child-link--pending")
        : "text-sidebar-foreground/75 hover:text-sidebar-foreground before:bg-transparent",
  );

  if (lock.locked) {
    return (
      <li className={child.dividerBefore ? "mt-2 border-t border-sidebar-border/80 pt-2" : undefined}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                onLockedClick({ featureKey: lock.dialogFeatureKey, reason: lock.reason });
              }}
            >
              {itemBody}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[240px] text-left">
            <p className="font-semibold">{t(catalog.titleKey)}</p>
            <p className="mt-1 text-primary-foreground/90">
              {t("dashboardNav.business.locked.tooltipUpgrade", { plan: planLabel })}
            </p>
          </TooltipContent>
        </Tooltip>
      </li>
    );
  }

  return (
    <li className={child.dividerBefore ? "mt-2 border-t border-sidebar-border/80 pt-2" : undefined}>
      <PrefetchLink
        to={child.href}
        onPointerDown={() => warmSidebarDestination(child.href)}
        onClick={onNavigate}
        className={itemClass}
        aria-current={childActive ? "page" : undefined}
      >
        {itemBody}
      </PrefetchLink>
    </li>
  );
}

function SidebarGroup({
  entry,
  pathname,
  search,
  navPending,
  isExpanded,
  onToggle,
  entitlements,
  onNavigate,
  onLockedClick,
}: {
  entry: Extract<BusinessSidebarNavEntry, { type: "group" }>;
  pathname: string;
  search: string;
  navPending: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  entitlements: ReturnType<typeof useSidebarEntitlements>;
  onNavigate?: () => void;
  onLockedClick: (state: LockedDialogState) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groupActive = isBusinessSidebarGroupActive(entry, pathname, search);
  const panelId = `business-sidebar-group-${entry.id}`;

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
          "business-dash-nav-link flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium transition-colors",
          groupActive
            ? cn(
                "business-dash-nav-link--active font-semibold text-sidebar-foreground",
                navPending && "business-dash-nav-link--pending",
              )
            : dashboardSidebarNavLinkIdle,
        )}
        aria-expanded={isExpanded}
        aria-controls={panelId}
      >
        <span className="business-dash-nav-icon" aria-hidden>
          <CareIcon name={entry.icon} size="nav" />
        </span>
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
            <SidebarChildNavItem
              key={child.href}
              child={child}
              groupId={entry.id}
              pathname={pathname}
              search={search}
              navPending={navPending}
              entitlements={entitlements}
              onNavigate={onNavigate}
              onLockedClick={onLockedClick}
            />
          ))}
        </ul>
      </div>
    </li>
  );
}

export function BusinessSidebarNavShell({
  onNavigate,
  showSubscriptionStatus = true,
}: BusinessSidebarNavShellProps) {
  const { pathname, search, pending: navPending } = useBusinessSidebarNavigationPath();
  const { isExpanded, toggleGroup } = useBusinessSidebarNavState();
  const entitlements = useSidebarEntitlements();
  const [dialogState, setDialogState] = useState<LockedDialogState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  function openLockedDialog(state: LockedDialogState) {
    setDialogState(state);
    setDialogOpen(true);
  }

  function closeLockedDialog() {
    setDialogOpen(false);
    window.setTimeout(() => setDialogState(null), ACTIVATION_DIALOG_CLOSE_MS);
  }

  return (
    <>
      {showSubscriptionStatus ? <BusinessSidebarSubscriptionStatus /> : null}
      <TooltipProvider delayDuration={350}>
        <ul className="space-y-0.5">
          {businessSidebarNavEntries.map((entry) => {
            if (entry.type === "action" && entry.action === "productFeedback") {
              return (
                <ProductFeedbackSidebarNavItem
                  key={entry.id}
                  labelKey={entry.labelKey}
                  onNavigate={onNavigate}
                  variant="business"
                  separated={entry.separated}
                />
              );
            }
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
            if (entry.type !== "group") return null;
            return (
              <SidebarGroup
                key={entry.id}
                entry={entry}
                pathname={pathname}
                search={search}
                navPending={navPending}
                isExpanded={isExpanded(entry.id)}
                onToggle={() => toggleGroup(entry.id)}
                entitlements={entitlements}
                onNavigate={onNavigate}
                onLockedClick={openLockedDialog}
              />
            );
          })}
        </ul>
      </TooltipProvider>
      <PremiumAccessDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setDialogOpen(true);
            return;
          }
          closeLockedDialog();
        }}
        featureKey={dialogState?.featureKey ?? null}
        lockReason={dialogState?.reason ?? "none"}
      />
    </>
  );
}
