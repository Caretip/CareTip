import type { CareIconName } from "@/components/icons";
import { Users, TrendingUp, Trophy } from "lucide-react";
import {
  hasFeature,
  type BusinessSubscriptionTier,
  type FeatureKey,
} from "@/app/lib/subscriptionCapabilities";
import { BUSINESS_SETTINGS_SECTIONS } from "./settings/businessSettingsSections";

export const BUSINESS_DASHBOARD_HOME_HREF = "/dashboard" as const;

export type BusinessDashboardNavItem = {
  labelKey: string;
  href: string;
  icon: CareIconName;
  /** When set, show tier badge — page still reachable for upgrade UX. */
  featureKey?: FeatureKey;
};

export type BusinessSidebarChildNavItem = {
  labelKey: string;
  href: string;
  featureKey?: FeatureKey;
};

export type BusinessSidebarNavEntry =
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
      children: readonly BusinessSidebarChildNavItem[];
    };

/** @deprecated Use businessSidebarNavEntries — kept for legacy imports. */
export const businessDashboardNavItems: readonly BusinessDashboardNavItem[] = [
  { labelKey: "dashboardNav.business.overview", href: "/dashboard", icon: "overview" },
  { labelKey: "dashboardNav.business.tips", href: "/dashboard/tips", icon: "tipsActivity" },
  { labelKey: "dashboardNav.business.team", href: "/dashboard/team", icon: "team" },
  {
    labelKey: "dashboardNav.business.qrStudio",
    href: "/dashboard/qr-studio",
    icon: "tableQr",
  },
  { labelKey: "dashboardNav.business.locations", href: "/dashboard/locations", icon: "locations" },
  { labelKey: "dashboardNav.business.customers", href: "/dashboard/customers", icon: "inbox" },
  { labelKey: "dashboardNav.business.stripe", href: "/dashboard/stripe", icon: "earnings" },
  { labelKey: "dashboardNav.business.billing", href: "/dashboard/billing", icon: "billing" },
  { labelKey: "dashboardNav.business.settings", href: "/dashboard/settings", icon: "settings" },
] as const;

/** Combined location + table management (create/edit/delete). QR Studio only displays QRs. */
export const VENUE_MANAGEMENT_HREF = "/dashboard/locations" as const;

export const QR_STUDIO_BASE = "/dashboard/qr-studio" as const;
export const QR_STUDIO_DEFAULT_HREF = `${QR_STUDIO_BASE}` as const;

export const qrStudioSubNavItems = [
  { labelKey: "business.qrStudio.nav.overview", href: `${QR_STUDIO_BASE}` },
  { labelKey: "business.qrStudio.nav.business", href: `${QR_STUDIO_BASE}/business` },
  { labelKey: "business.qrStudio.nav.employees", href: `${QR_STUDIO_BASE}/employees` },
  { labelKey: "business.qrStudio.nav.tables", href: `${QR_STUDIO_BASE}/tables` },
  { labelKey: "business.qrStudio.nav.locations", href: `${QR_STUDIO_BASE}/locations` },
  { labelKey: "business.qrStudio.nav.print", href: `${QR_STUDIO_BASE}/print` },
  { labelKey: "business.qrStudio.nav.orders", href: `${QR_STUDIO_BASE}/orders` },
] as const;

export const TIPS_BASE = "/dashboard/tips" as const;
export const tipsSubNavItems = [
  { labelKey: "business.tips.nav.live", href: `${TIPS_BASE}/live` },
  { labelKey: "business.tips.nav.transactions", href: `${TIPS_BASE}/transactions` },
  {
    labelKey: "business.tips.nav.analytics",
    href: `${TIPS_BASE}/analytics`,
    featureKey: "advancedAnalytics" as FeatureKey,
  },
] as const;

export const TEAM_BASE = "/dashboard/team" as const;
export const teamSubNavItems = [
  { labelKey: "business.team.nav.employees", href: `${TEAM_BASE}/employees`, icon: Users },
  { labelKey: "business.team.nav.performance", href: `${TEAM_BASE}/performance`, icon: TrendingUp, featureKey: "advancedAnalytics" as FeatureKey },
  {
    labelKey: "business.team.nav.topPerformers",
    href: `${TEAM_BASE}/top-performers`,
    icon: Trophy,
    featureKey: "advancedAnalytics" as FeatureKey,
  },
] as const;

export const CUSTOMERS_BASE = "/dashboard/customers" as const;
/** @deprecated Reviews merged into Customer Feedback — kept for any legacy imports. */
export const customersSubNavItems = [
  {
    labelKey: "business.customers.nav.feedback",
    href: `${CUSTOMERS_BASE}/feedback`,
    featureKey: "customerFeedback" as FeatureKey,
  },
] as const;

export const BILLING_BASE = "/dashboard/billing" as const;
export const billingSubNavItems = [
  { labelKey: "business.billing.nav.subscription", href: `${BILLING_BASE}/subscription` },
  { labelKey: "business.billing.nav.invoices", href: `${BILLING_BASE}/invoices` },
  { labelKey: "business.billing.nav.paymentMethods", href: `${BILLING_BASE}/payment-methods` },
  { labelKey: "business.billing.nav.history", href: `${BILLING_BASE}/history` },
] as const;

export const STRIPE_BASE = "/dashboard/stripe" as const;
export const STRIPE_CONNECT_HREF = `${STRIPE_BASE}/connect` as const;
export const STRIPE_PAYOUTS_HREF = `${STRIPE_BASE}/payouts` as const;
export const stripeSubNavItems = [
  { labelKey: "business.stripe.nav.connect", href: STRIPE_CONNECT_HREF },
  { labelKey: "business.stripe.nav.payouts", href: STRIPE_PAYOUTS_HREF },
] as const;

const settingsSidebarChildren: readonly BusinessSidebarChildNavItem[] =
  BUSINESS_SETTINGS_SECTIONS.map((section) => ({
    labelKey: section.labelKey,
    href: `/dashboard/settings?section=${section.id}`,
  }));

/** Collapsible sidebar navigation tree (single source of truth for business dashboard IA). */
export const businessSidebarNavEntries: readonly BusinessSidebarNavEntry[] = [
  {
    type: "link",
    id: "overview",
    labelKey: "dashboardNav.business.overview",
    href: BUSINESS_DASHBOARD_HOME_HREF,
    icon: "overview",
  },
  {
    type: "group",
    id: "tips",
    labelKey: "dashboardNav.business.tips",
    icon: "tipsActivity",
    defaultHref: `${TIPS_BASE}/transactions`,
    children: tipsSubNavItems,
  },
  {
    type: "group",
    id: "team",
    labelKey: "dashboardNav.business.team",
    icon: "team",
    defaultHref: `${TEAM_BASE}/employees`,
    children: teamSubNavItems,
  },
  {
    type: "group",
    id: "qr-studio",
    labelKey: "dashboardNav.business.qrStudio",
    icon: "tableQr",
    defaultHref: QR_STUDIO_DEFAULT_HREF,
    children: qrStudioSubNavItems,
  },
  {
    type: "link",
    id: "locations",
    labelKey: "dashboardNav.business.locations",
    href: "/dashboard/locations",
    icon: "locations",
  },
  {
    type: "link",
    id: "customers",
    labelKey: "dashboardNav.business.customers",
    href: CUSTOMERS_BASE,
    icon: "inbox",
  },
  {
    type: "group",
    id: "stripe",
    labelKey: "dashboardNav.business.stripe",
    icon: "earnings",
    defaultHref: STRIPE_CONNECT_HREF,
    children: stripeSubNavItems,
  },
  {
    type: "group",
    id: "billing",
    labelKey: "dashboardNav.business.billing",
    icon: "billing",
    defaultHref: `${BILLING_BASE}/subscription`,
    children: billingSubNavItems,
  },
  {
    type: "group",
    id: "settings",
    labelKey: "dashboardNav.business.settings",
    icon: "settings",
    defaultHref: "/dashboard/settings?section=general",
    children: settingsSidebarChildren,
  },
] as const;

export function isBusinessNavItemLocked(
  item: Pick<BusinessDashboardNavItem, "featureKey">,
  tier: BusinessSubscriptionTier | undefined | null,
): boolean {
  if (!item.featureKey) return false;
  return !hasFeature(tier, item.featureKey);
}

/** Never show nav lock icons until entitlements are resolved (prevents hydration flash). */
export function showBusinessNavSubscriptionLock(
  entitlementsReady: boolean,
  item: Pick<BusinessDashboardNavItem, "featureKey">,
  tier: BusinessSubscriptionTier | undefined | null,
): boolean {
  if (!entitlementsReady) return false;
  return isBusinessNavItemLocked(item, tier);
}

export type BusinessNavLockKind = "subscription" | "verification";

/** Single lock icon for QR Studio — verification only (subscription gates are per-section). */
export function resolveQrStudioNavLock(
  entitlementsReady: boolean,
  _tier: BusinessSubscriptionTier | undefined | null,
  verificationPending: boolean,
): BusinessNavLockKind | null {
  if (!entitlementsReady) return null;
  if (verificationPending) return "verification";
  return null;
}

/** @deprecated Use full nav list + isBusinessNavItemLocked — items are no longer hidden. */
export function filterBusinessDashboardNavItems(
  items: readonly BusinessDashboardNavItem[],
  _tier: BusinessSubscriptionTier | undefined | null,
): BusinessDashboardNavItem[] {
  return [...items];
}

const BUSINESS_SETTINGS_LEGACY_PATHS = ["/dashboard/profile", "/dashboard/profile-settings"] as const;

const MODULE_PREFIXES = [
  "/dashboard/tips",
  "/dashboard/team",
  "/dashboard/qr-studio",
  "/dashboard/customers",
  "/dashboard/stripe",
  "/dashboard/billing",
] as const;

function parseNavHref(href: string): { pathname: string; section: string | null } {
  const [pathname, query = ""] = href.split("?");
  const section = new URLSearchParams(query).get("section");
  return { pathname, section };
}

export function isBusinessSidebarChildActive(
  href: string,
  pathname: string,
  search: string,
): boolean {
  const { pathname: targetPath, section: targetSection } = parseNavHref(href);
  if (pathname !== targetPath && !pathname.startsWith(`${targetPath}/`)) {
    return false;
  }
  if (targetSection) {
    const currentSection = new URLSearchParams(search).get("section") ?? "general";
    return currentSection === targetSection;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isBusinessDashboardNavActive(href: string, pathname: string): boolean {
  if (href === BUSINESS_DASHBOARD_HOME_HREF) return pathname === BUSINESS_DASHBOARD_HOME_HREF;
  if (href === "/dashboard/settings") {
    return (
      pathname === href ||
      pathname.startsWith(`${href}/`) ||
      (BUSINESS_SETTINGS_LEGACY_PATHS as readonly string[]).includes(pathname)
    );
  }
  for (const prefix of MODULE_PREFIXES) {
    if (href === prefix) {
      return pathname === prefix || pathname.startsWith(`${prefix}/`);
    }
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isBusinessSidebarGroupActive(
  entry: Extract<BusinessSidebarNavEntry, { type: "group" }>,
  pathname: string,
  search: string,
): boolean {
  return entry.children.some((child) => isBusinessSidebarChildActive(child.href, pathname, search));
}

export function resolveActiveSidebarGroupId(pathname: string, search: string): string | null {
  for (const entry of businessSidebarNavEntries) {
    if (entry.type !== "group") continue;
    if (isBusinessSidebarGroupActive(entry, pathname, search)) return entry.id;
  }
  return null;
}

/** QR Studio default hub — employee QR codes (gallery/downloads pages removed). */
export const QR_STUDIO_GALLERY_HREF = QR_STUDIO_DEFAULT_HREF;
