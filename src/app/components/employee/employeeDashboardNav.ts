import type { CareIconName } from "@/components/icons";
import {
  hasFeature,
  type BusinessSubscriptionTier,
  type FeatureKey,
} from "@/app/lib/subscriptionCapabilities";

export const EMPLOYEE_DASHBOARD_HOME = "/employee/dashboard";
export const EMPLOYEE_PAYMENTS_CONNECT_HREF = "/employee/payments/connect";
export const EMPLOYEE_PAYMENTS_HISTORY_HREF = "/employee/payments/history";

export type EmployeeDashboardNavItem = {
  labelKey: string;
  href: string;
  icon: CareIconName;
  featureKey?: FeatureKey;
};

export type EmployeeDashboardNavChild = {
  labelKey: string;
  href: string;
};

export type EmployeeDashboardNavEntry =
  | ({ type: "link" } & EmployeeDashboardNavItem)
  | {
      type: "group";
      id: string;
      labelKey: string;
      icon: CareIconName;
      defaultHref: string;
      children: readonly EmployeeDashboardNavChild[];
    };

export const employeeDashboardNavEntries: readonly EmployeeDashboardNavEntry[] = [
  { type: "link", labelKey: "dashboardNav.employee.overview", href: EMPLOYEE_DASHBOARD_HOME, icon: "overview" },
  { type: "link", labelKey: "dashboardNav.employee.inbox", href: "/employee/inbox", icon: "inbox" },
  { type: "link", labelKey: "dashboardNav.employee.tipHistory", href: "/employee/tip-history", icon: "transactions" },
  { type: "link", labelKey: "dashboardNav.employee.assignment", href: "/employee/assignment", icon: "locations" },
  {
    type: "link",
    labelKey: "dashboardNav.employee.tipGoals",
    href: "/employee/tip-goals",
    icon: "tipGoals",
    featureKey: "employeeGoals",
  },
  {
    type: "group",
    id: "payments",
    labelKey: "dashboardNav.employee.payments",
    icon: "earnings",
    defaultHref: EMPLOYEE_PAYMENTS_CONNECT_HREF,
    children: [
      { labelKey: "dashboardNav.employee.paymentsConnect", href: EMPLOYEE_PAYMENTS_CONNECT_HREF },
      { labelKey: "dashboardNav.employee.paymentsHistory", href: EMPLOYEE_PAYMENTS_HISTORY_HREF },
    ],
  },
  { type: "link", labelKey: "dashboardNav.employee.settings", href: "/employee/settings", icon: "settings" },
] as const;

/** Flat links for lock checks (excludes group parents). */
export const employeeDashboardNavItems: readonly EmployeeDashboardNavItem[] = employeeDashboardNavEntries.flatMap(
  (entry) => {
    if (entry.type === "link") {
      const { type: _type, ...item } = entry;
      return [item];
    }
    return [];
  },
);

export function isEmployeeNavItemLocked(
  item: Pick<EmployeeDashboardNavItem, "featureKey">,
  tier: BusinessSubscriptionTier | undefined | null,
): boolean {
  if (!item.featureKey) return false;
  return !hasFeature(tier, item.featureKey);
}

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
  if (href === EMPLOYEE_DASHBOARD_HOME) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isEmployeePaymentsPath(pathname: string): boolean {
  return (
    pathname === "/employee/payouts" ||
    pathname.startsWith("/employee/payouts?") ||
    pathname.startsWith("/employee/payments")
  );
}

export function isEmployeePaymentsGroupActive(pathname: string): boolean {
  return isEmployeePaymentsPath(pathname);
}
