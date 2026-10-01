/**
 * Prefetch lazy `/platform-admin/*` route modules (mirrors routes.tsx).
 */

type RouteImporter = () => Promise<unknown>;

const SPECS: readonly { prefix: string; loaders: readonly RouteImporter[] }[] = [
  { prefix: "/platform-admin/businesses/all", loaders: [() => import("../pages/platform/PlatformAllBusinessesPage")] },
  { prefix: "/platform-admin/businesses/onboarding-verification", loaders: [() => import("../pages/platform/BusinessVerificationPage")] },
  { prefix: "/platform-admin/businesses/kyc-verification", loaders: [() => import("../pages/platform/BusinessVerificationPage")] },
  { prefix: "/platform-admin/businesses/subscriptions", loaders: [() => import("../pages/platform/PlatformBusinessSubscriptionsPage")] },
  { prefix: "/platform-admin/businesses/analytics", loaders: [() => import("../pages/platform/PlatformBusinessAnalyticsPage")] },
  { prefix: "/platform-admin/branding-orders", loaders: [() => import("../pages/platform/PlatformPhysicalQrOrdersPage")] },
  { prefix: "/platform-admin/revenue/transactions", loaders: [() => import("../pages/platform/GlobalTransactionsPage")] },
  { prefix: "/platform-admin/revenue/failed-billing", loaders: [() => import("../pages/platform/revenue/PlatformFailedBillingPage")] },
  { prefix: "/platform-admin/revenue/failed-payments", loaders: [() => import("../pages/platform/revenue/PlatformFailedPaymentsPage")] },
  { prefix: "/platform-admin/revenue/successful-subscriptions", loaders: [() => import("../pages/platform/revenue/PlatformSuccessfulSubscriptionsPage")] },
  { prefix: "/platform-admin/revenue/failed-subscriptions", loaders: [() => import("../pages/platform/revenue/PlatformFailedSubscriptionsPage")] },
  { prefix: "/platform-admin/revenue/refunds", loaders: [() => import("../pages/platform/revenue/PlatformRefundsPage")] },
  { prefix: "/platform-admin/revenue/connect-payouts", loaders: [() => import("../pages/platform/revenue/PlatformConnectPayoutsPage")] },
  { prefix: "/platform-admin/users/management", loaders: [() => import("../pages/platform/PlatformUserManagementPage")] },
  { prefix: "/platform-admin/users/staff", loaders: [() => import("../pages/platform/users/PlatformStaffAccountsPage")] },
  { prefix: "/platform-admin/users/admins", loaders: [() => import("../pages/platform/users/PlatformAdminsPage")] },
  { prefix: "/platform-admin/communication/inbox", loaders: [() => import("../pages/shared/NotificationInboxPage")] },
  { prefix: "/platform-admin/communication/notifications", loaders: [() => import("../pages/platform/communication/PlatformCommunicationNotificationsPage")] },
  { prefix: "/platform-admin/communication/broadcasts", loaders: [() => import("../pages/platform/PlatformAnnouncementsPage")] },
  { prefix: "/platform-admin/reports/audit-logs", loaders: [() => import("../pages/platform/AuditLogsPage")] },
  { prefix: "/platform-admin/reports/security", loaders: [() => import("../pages/platform/reports/PlatformSecurityReportsPage")] },
  { prefix: "/platform-admin/reports/usage", loaders: [() => import("../pages/platform/reports/PlatformUsageReportsPage")] },
  { prefix: "/platform-admin/reports/commercial", loaders: [() => import("../pages/platform/reports/PlatformCommercialIntelligencePage")] },
  { prefix: "/platform-admin/system/health", loaders: [() => import("../pages/platform/PlatformSystemHealthPage")] },
  { prefix: "/platform-admin/system/settings", loaders: [() => import("../pages/platform/PlatformSettingsPage")] },
  { prefix: "/platform-admin/system/legal-hold", loaders: [() => import("../pages/platform/PlatformLegalHoldPage")] },
  { prefix: "/platform-admin/dashboard", loaders: [() => import("../components/AdminDashboard")] },
  { prefix: "/platform-admin/businesses", loaders: [() => import("../pages/platform/BusinessVerificationPage")] },
  { prefix: "/platform-admin/revenue", loaders: [() => import("../pages/platform/GlobalTransactionsPage")] },
];

const prefetched = new Set<string>();
const inflight = new Map<string, Promise<void>>();

function normalize(path: string): string {
  return (path.split("#")[0]?.split("?")[0] ?? path).trim();
}

function resolveSpec(pathname: string) {
  for (const spec of SPECS) {
    if (pathname === spec.prefix || pathname.startsWith(`${spec.prefix}/`)) return spec;
  }
  return null;
}

export function prefetchPlatformAdminRoute(path: string): Promise<void> {
  const pathname = normalize(path);
  if (!pathname.startsWith("/platform-admin")) return Promise.resolve();
  if (pathname === "/platform-admin/login") return Promise.resolve();
  if (prefetched.has(pathname)) return Promise.resolve();

  const existing = inflight.get(pathname);
  if (existing) return existing;

  const spec = resolveSpec(pathname);
  if (!spec) return Promise.resolve();

  const promise = Promise.all(spec.loaders.map((l) => l()))
    .then(() => {
      prefetched.add(pathname);
    })
    .catch(() => {
      /* Best-effort prefetch. */
    })
    .finally(() => {
      inflight.delete(pathname);
    });

  inflight.set(pathname, promise);
  return promise;
}

export function platformAdminSidebarPrefetchPaths(): string[] {
  return [
    "/platform-admin/businesses/onboarding-verification",
    "/platform-admin/businesses/all",
    "/platform-admin/branding-orders",
    "/platform-admin/revenue/transactions",
    "/platform-admin/reports/audit-logs",
    "/platform-admin/users/management",
  ];
}

export function prefetchPlatformAdminSidebarRoutesIdle(): void {
  for (const href of platformAdminSidebarPrefetchPaths()) {
    void prefetchPlatformAdminRoute(href);
  }
}
