/**
 * Prefetch lazy `/dashboard/*` route modules (layout + page) on hover, idle, or pointer intent.
 * Mirrors `routes.tsx` business dashboard lazy imports — keeps post-login shell small while
 * warming sidebar destinations before click in production.
 */

type RouteImporter = () => Promise<unknown>;

const tipsLayout = () => import("../pages/business/tips/BusinessTipsLayout");
const teamLayout = () => import("../pages/business/team/BusinessTeamLayout");
const qrStudioLayout = () => import("../pages/business/qr-studio/QrStudioLayout");
const customersLayout = () => import("../pages/business/customers/BusinessCustomersLayout");
const billingLayout = () => import("../pages/business/billing/BusinessBillingLayout");
const stripeLayout = () => import("../pages/business/stripe/BusinessStripeLayout");

/** Longest-prefix wins — keep paths sorted by descending length. */
const BUSINESS_DASHBOARD_ROUTE_SPECS: readonly { prefix: string; loaders: readonly RouteImporter[] }[] =
  [
    { prefix: "/dashboard/tips/tip-distribution", loaders: [tipsLayout, () => import("../pages/business/TipDistributionPage")] },
    { prefix: "/dashboard/tips/live", loaders: [tipsLayout, () => import("../pages/business/tips/BusinessActivityCenterPage")] },
    { prefix: "/dashboard/tips/transactions", loaders: [tipsLayout, () => import("../pages/business/tips/BusinessTipsTransactionsPage")] },
    { prefix: "/dashboard/tips/analytics", loaders: [tipsLayout, () => import("../pages/business/tips/BusinessTipsAnalyticsPage")] },
    { prefix: "/dashboard/team/employees", loaders: [teamLayout, () => import("../pages/business/team/BusinessTeamEmployeesPage")] },
    { prefix: "/dashboard/team/performance", loaders: [teamLayout, () => import("../pages/business/team/BusinessTeamPerformancePage")] },
    { prefix: "/dashboard/qr-studio/business", loaders: [qrStudioLayout, () => import("../pages/business/qr-studio/QrStudioBusinessPage")] },
    { prefix: "/dashboard/qr-studio/employees", loaders: [qrStudioLayout, () => import("../pages/business/qr-studio/QrStudioEmployeesPage")] },
    { prefix: "/dashboard/qr-studio/tables", loaders: [qrStudioLayout, () => import("../pages/business/qr-studio/QrStudioTablesPage")] },
    { prefix: "/dashboard/qr-studio/locations", loaders: [qrStudioLayout, () => import("../pages/business/qr-studio/QrStudioLocationsPage")] },
    { prefix: "/dashboard/qr-studio/print", loaders: [qrStudioLayout, () => import("../pages/business/qr-studio/QrStudioPrintPage")] },
    { prefix: "/dashboard/qr-studio/orders", loaders: [qrStudioLayout, () => import("../pages/business/qr-studio/QrStudioOrdersPage")] },
    { prefix: "/dashboard/customers/feedback", loaders: [customersLayout, () => import("../pages/business/customers/BusinessCustomersFeedbackPage")] },
    { prefix: "/dashboard/billing/subscription", loaders: [billingLayout, () => import("../pages/business/billing/BusinessBillingSubscriptionPage")] },
    { prefix: "/dashboard/billing/invoices", loaders: [billingLayout, () => import("../pages/business/billing/BusinessBillingSubPages")] },
    { prefix: "/dashboard/billing/payment-methods", loaders: [billingLayout, () => import("../pages/business/billing/BusinessBillingSubPages")] },
    { prefix: "/dashboard/billing/history", loaders: [billingLayout, () => import("../pages/business/billing/BusinessBillingSubPages")] },
    { prefix: "/dashboard/stripe/connect", loaders: [stripeLayout, () => import("../pages/business/stripe/BusinessStripePages")] },
    { prefix: "/dashboard/stripe/payouts", loaders: [stripeLayout, () => import("../pages/business/stripe/BusinessStripePages")] },
    { prefix: "/dashboard/settings", loaders: [() => import("../pages/business/BusinessSettingsPage")] },
    { prefix: "/dashboard/locations", loaders: [() => import("../pages/business/LocationsPage")] },
    { prefix: "/dashboard/customers", loaders: [customersLayout, () => import("../pages/business/customers/BusinessCustomersFeedbackPage")] },
    { prefix: "/dashboard/tips", loaders: [tipsLayout, () => import("../pages/business/tips/BusinessTipsTransactionsPage")] },
    { prefix: "/dashboard/team", loaders: [teamLayout, () => import("../pages/business/team/BusinessTeamEmployeesPage")] },
    { prefix: "/dashboard/qr-studio", loaders: [qrStudioLayout, () => import("../pages/business/qr-studio/QrStudioBusinessPage")] },
    { prefix: "/dashboard/billing", loaders: [billingLayout, () => import("../pages/business/billing/BusinessBillingSubscriptionPage")] },
    { prefix: "/dashboard/stripe", loaders: [stripeLayout, () => import("../pages/business/stripe/BusinessStripePages")] },
    {
      prefix: "/dashboard",
      loaders: [
        () => import("../pages/business/BusinessDashboard"),
      ],
    },
  ];

const businessPrefetched = new Set<string>();
const businessInflight = new Map<string, Promise<void>>();

export function normalizeBusinessDashboardPath(path: string): string {
  const withoutHash = path.split("#")[0] ?? path;
  const pathname = withoutHash.split("?")[0] ?? withoutHash;
  return pathname;
}

function resolveBusinessDashboardSpec(pathname: string): (typeof BUSINESS_DASHBOARD_ROUTE_SPECS)[number] | null {
  if (!pathname.startsWith("/dashboard")) return null;
  for (const spec of BUSINESS_DASHBOARD_ROUTE_SPECS) {
    if (pathname === spec.prefix || pathname.startsWith(`${spec.prefix}/`)) {
      return spec;
    }
  }
  return null;
}

/** Warm layout + page chunks for a business dashboard path (best-effort). */
export function prefetchBusinessDashboardRoute(path: string): Promise<void> {
  const pathname = normalizeBusinessDashboardPath(path);
  if (!pathname.startsWith("/dashboard")) return Promise.resolve();
  if (businessPrefetched.has(pathname)) return Promise.resolve();

  const existing = businessInflight.get(pathname);
  if (existing) return existing;

  const spec = resolveBusinessDashboardSpec(pathname);
  if (!spec) return Promise.resolve();

  const promise = Promise.all(spec.loaders.map((loader) => loader()))
    .then(() => {
      businessPrefetched.add(pathname);
    })
    .catch(() => {
      /* Prefetch is best-effort — navigation still proceeds. */
    })
    .finally(() => {
      businessInflight.delete(pathname);
    });

  businessInflight.set(pathname, promise);
  return promise;
}

/** Sidebar hrefs used for idle prefetch after the business shell is interactive. */
export function businessSidebarPrefetchPaths(): string[] {
  return [
    "/dashboard/tips/transactions",
    "/dashboard/tips/analytics",
    "/dashboard/team/employees",
    "/dashboard/team/performance",
    "/dashboard/qr-studio/business",
    "/dashboard/qr-studio/employees",
    "/dashboard/qr-studio/tables",
    "/dashboard/qr-studio/locations",
    "/dashboard/customers/feedback",
    "/dashboard/stripe/payouts",
    "/dashboard/locations",
  ];
}

export function prefetchBusinessSidebarRoutesIdle(): void {
  for (const href of businessSidebarPrefetchPaths()) {
    void prefetchBusinessDashboardRoute(href);
  }
}
