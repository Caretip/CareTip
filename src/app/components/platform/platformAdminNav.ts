import type { CareIconName } from "@/components/icons";

export const PLATFORM_ADMIN_OVERVIEW_HREF = "/platform-admin/dashboard" as const;

export const PLATFORM_BUSINESS_BASE = "/platform-admin/businesses" as const;
export const PLATFORM_REVENUE_BASE = "/platform-admin/revenue" as const;
export const PLATFORM_USERS_BASE = "/platform-admin/users" as const;
export const PLATFORM_COMMUNICATION_BASE = "/platform-admin/communication" as const;
export const PLATFORM_REPORTS_BASE = "/platform-admin/reports" as const;
export const PLATFORM_SYSTEM_BASE = "/platform-admin/system" as const;

export type PlatformAdminChildNavItem = {
  labelKey: string;
  href: string;
};

export type PlatformAdminNavEntry =
  | {
      type: "link";
      id: string;
      labelKey: string;
      href: string;
      icon: CareIconName;
    }
  | {
      type: "group";
      id: string;
      labelKey: string;
      icon: CareIconName;
      defaultHref: string;
      children: readonly PlatformAdminChildNavItem[];
    };

export const platformAdminNavEntries: readonly PlatformAdminNavEntry[] = [
  {
    type: "link",
    id: "overview",
    labelKey: "admin.sidebar.navOverview",
    href: PLATFORM_ADMIN_OVERVIEW_HREF,
    icon: "overview",
  },
  {
    type: "group",
    id: "business-management",
    labelKey: "admin.sidebar.groups.businessManagement",
    icon: "businesses",
    defaultHref: `${PLATFORM_BUSINESS_BASE}/onboarding-verification`,
    children: [
      { labelKey: "admin.sidebar.business.all", href: `${PLATFORM_BUSINESS_BASE}/all` },
      { labelKey: "admin.sidebar.business.onboardingVerification", href: `${PLATFORM_BUSINESS_BASE}/onboarding-verification` },
      { labelKey: "admin.sidebar.business.kycVerification", href: `${PLATFORM_BUSINESS_BASE}/kyc-verification` },
      { labelKey: "admin.sidebar.business.subscriptions", href: `${PLATFORM_BUSINESS_BASE}/subscriptions` },
      { labelKey: "admin.sidebar.business.analytics", href: `${PLATFORM_BUSINESS_BASE}/analytics` },
    ],
  },
  {
    type: "group",
    id: "revenue",
    labelKey: "admin.sidebar.groups.revenue",
    icon: "transactions",
    defaultHref: `${PLATFORM_REVENUE_BASE}/transactions`,
    children: [
      { labelKey: "admin.sidebar.revenue.transactions", href: `${PLATFORM_REVENUE_BASE}/transactions` },
      { labelKey: "admin.sidebar.revenue.failedPayments", href: `${PLATFORM_REVENUE_BASE}/failed-payments` },
      { labelKey: "admin.sidebar.revenue.successfulSubscriptions", href: `${PLATFORM_REVENUE_BASE}/successful-subscriptions` },
      { labelKey: "admin.sidebar.revenue.failedSubscriptions", href: `${PLATFORM_REVENUE_BASE}/failed-subscriptions` },
      { labelKey: "admin.sidebar.revenue.refunds", href: `${PLATFORM_REVENUE_BASE}/refunds` },
    ],
  },
  {
    type: "group",
    id: "users",
    labelKey: "admin.sidebar.groups.users",
    icon: "users",
    defaultHref: `${PLATFORM_USERS_BASE}/management`,
    children: [
      { labelKey: "admin.sidebar.users.management", href: `${PLATFORM_USERS_BASE}/management` },
      { labelKey: "admin.sidebar.users.staff", href: `${PLATFORM_USERS_BASE}/staff` },
      { labelKey: "admin.sidebar.users.admins", href: `${PLATFORM_USERS_BASE}/admins` },
    ],
  },
  {
    type: "group",
    id: "communication",
    labelKey: "admin.sidebar.groups.communication",
    icon: "inbox",
    defaultHref: `${PLATFORM_COMMUNICATION_BASE}/inbox`,
    children: [
      { labelKey: "admin.sidebar.communication.inbox", href: `${PLATFORM_COMMUNICATION_BASE}/inbox` },
      { labelKey: "admin.sidebar.communication.notifications", href: `${PLATFORM_COMMUNICATION_BASE}/notifications` },
      { labelKey: "admin.sidebar.communication.broadcasts", href: `${PLATFORM_COMMUNICATION_BASE}/broadcasts` },
    ],
  },
  {
    type: "group",
    id: "reports",
    labelKey: "admin.sidebar.groups.reports",
    icon: "logs",
    defaultHref: `${PLATFORM_REPORTS_BASE}/audit-logs`,
    children: [
      { labelKey: "admin.sidebar.reports.auditLogs", href: `${PLATFORM_REPORTS_BASE}/audit-logs` },
      { labelKey: "admin.sidebar.reports.security", href: `${PLATFORM_REPORTS_BASE}/security` },
      { labelKey: "admin.sidebar.reports.usage", href: `${PLATFORM_REPORTS_BASE}/usage` },
      { labelKey: "admin.sidebar.reports.commercial", href: `${PLATFORM_REPORTS_BASE}/commercial` },
    ],
  },
  {
    type: "group",
    id: "system",
    labelKey: "admin.sidebar.groups.system",
    icon: "settings",
    defaultHref: `${PLATFORM_SYSTEM_BASE}/health`,
    children: [
      { labelKey: "admin.sidebar.system.health", href: `${PLATFORM_SYSTEM_BASE}/health` },
      { labelKey: "admin.sidebar.system.settings", href: `${PLATFORM_SYSTEM_BASE}/settings` },
      { labelKey: "admin.sidebar.system.legalHold", href: `${PLATFORM_SYSTEM_BASE}/legal-hold` },
    ],
  },
] as const;

const MODULE_PREFIXES = [
  PLATFORM_BUSINESS_BASE,
  PLATFORM_REVENUE_BASE,
  PLATFORM_USERS_BASE,
  PLATFORM_COMMUNICATION_BASE,
  PLATFORM_REPORTS_BASE,
  PLATFORM_SYSTEM_BASE,
] as const;

export function isPlatformAdminChildActive(href: string, pathname: string): boolean {
  if (pathname === href) return true;
  if (href.endsWith("/verification") || href.endsWith("/all")) {
    return pathname === href;
  }
  return pathname.startsWith(`${href}/`);
}

export function isPlatformAdminGroupActive(
  entry: Extract<PlatformAdminNavEntry, { type: "group" }>,
  pathname: string,
): boolean {
  if (
    entry.id === "business-management" &&
    pathname.startsWith(`${PLATFORM_BUSINESS_BASE}/`) &&
    !entry.children.some((child) => pathname === child.href)
  ) {
    const segment = pathname.slice(`${PLATFORM_BUSINESS_BASE}/`.length);
    if (segment && !segment.includes("/")) return true;
  }
  return entry.children.some((child) => isPlatformAdminChildActive(child.href, pathname));
}

export function resolvePlatformAdminActiveGroupId(pathname: string): string | null {
  for (const entry of platformAdminNavEntries) {
    if (entry.type !== "group") continue;
    if (isPlatformAdminGroupActive(entry, pathname)) return entry.id;
  }
  return null;
}

/** Legacy flat nav active check — used for overview link. */
export function isPlatformAdminOverviewActive(pathname: string): boolean {
  return pathname === PLATFORM_ADMIN_OVERVIEW_HREF;
}

/** @deprecated Use platformAdminNavEntries — kept for redirects. */
export { PLATFORM_ADMIN_OVERVIEW_HREF as PLATFORM_ADMIN_DASHBOARD_HREF };
