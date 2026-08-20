import type { CareIconName } from "@/components/icons";
import {
  hasFeature,
  type BusinessSubscriptionTier,
  type FeatureKey,
} from "@/app/lib/subscriptionCapabilities";

export type EmployeeDashboardNavItem = {
  labelKey: string;
  href: string;
  icon: CareIconName;
  featureKey?: FeatureKey;
};

export const employeeDashboardNavItems: readonly EmployeeDashboardNavItem[] = [
  { labelKey: "dashboardNav.employee.overview", href: "/employee/dashboard", icon: "overview" },
  { labelKey: "dashboardNav.employee.inbox", href: "/employee/inbox", icon: "inbox" },
  { labelKey: "dashboardNav.employee.tipHistory", href: "/employee/tip-history", icon: "transactions" },
  { labelKey: "dashboardNav.employee.assignment", href: "/employee/assignment", icon: "locations" },
  {
    labelKey: "dashboardNav.employee.tipGoals",
    href: "/employee/tip-goals",
    icon: "tipGoals",
    featureKey: "employeeGoals",
  },
  { labelKey: "dashboardNav.employee.settings", href: "/employee/settings", icon: "settings" },
] as const;

export function isEmployeeNavItemLocked(
  item: Pick<EmployeeDashboardNavItem, "featureKey">,
  tier: BusinessSubscriptionTier | undefined | null,
): boolean {
  if (!item.featureKey) return false;
  return !hasFeature(tier, item.featureKey);
}

/** Never show nav lock icons until entitlements are resolved (prevents hydration flash). */
export function showEmployeeNavSubscriptionLock(
  entitlementsReady: boolean,
  item: Pick<EmployeeDashboardNavItem, "featureKey">,
  tier: BusinessSubscriptionTier | undefined | null,
): boolean {
  if (!entitlementsReady) return false;
  return isEmployeeNavItemLocked(item, tier);
}

/** @deprecated Use full nav list + isEmployeeNavItemLocked — items are no longer hidden. */
export function filterEmployeeDashboardNavItems(
  items: readonly EmployeeDashboardNavItem[],
  _tier: BusinessSubscriptionTier | undefined | null,
): EmployeeDashboardNavItem[] {
  return [...items];
}

export function isEmployeeDashboardNavActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
