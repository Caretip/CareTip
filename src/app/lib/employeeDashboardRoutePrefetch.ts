/**
 * Prefetch lazy `/employee/*` route modules — mirrors `routes.tsx` employee dashboard lazy imports.
 */

type RouteImporter = () => Promise<unknown>;

/** Longest-prefix wins — sorted by descending prefix length. */
const EMPLOYEE_DASHBOARD_ROUTE_SPECS: readonly { prefix: string; loaders: readonly RouteImporter[] }[] = [
  { prefix: "/employee/payments/connect", loaders: [() => import("../pages/employee/EmployeePaymentsConnectPage")] },
  { prefix: "/employee/payments/history", loaders: [() => import("../pages/employee/EmployeePayoutHistoryPage")] },
  { prefix: "/employee/tip-history", loaders: [() => import("../pages/employee/EmployeeTipHistoryPage")] },
  { prefix: "/employee/analytics", loaders: [() => import("../pages/employee/EmployeeAnalyticsPage")] },
  { prefix: "/employee/inbox", loaders: [() => import("../pages/shared/NotificationInboxPage")] },
  { prefix: "/employee/assignment", loaders: [() => import("../pages/employee/EmployeeAssignmentPage")] },
  { prefix: "/employee/tip-goals", loaders: [() => import("../pages/employee/EmployeeTipGoalsPage")] },
  { prefix: "/employee/payouts", loaders: [() => import("../pages/employee/EmployeePayoutsPage")] },
  { prefix: "/employee/settings", loaders: [() => import("../pages/employee/EmployeeSettingsPage")] },
  { prefix: "/employee/payments", loaders: [() => import("../pages/employee/EmployeePaymentsConnectPage")] },
  { prefix: "/employee/dashboard", loaders: [() => import("../pages/employee/EmployeeDashboard")] },
];

const employeePrefetched = new Set<string>();
const employeeInflight = new Map<string, Promise<void>>();

export function normalizeEmployeeDashboardPath(path: string): string {
  const withoutHash = path.split("#")[0] ?? path;
  return withoutHash.split("?")[0] ?? withoutHash;
}

function resolveEmployeeDashboardSpec(pathname: string): (typeof EMPLOYEE_DASHBOARD_ROUTE_SPECS)[number] | null {
  if (!pathname.startsWith("/employee")) return null;
  for (const spec of EMPLOYEE_DASHBOARD_ROUTE_SPECS) {
    if (pathname === spec.prefix || pathname.startsWith(`${spec.prefix}/`)) {
      return spec;
    }
  }
  return null;
}

export function prefetchEmployeeDashboardRoute(path: string): Promise<void> {
  const pathname = normalizeEmployeeDashboardPath(path);
  if (!pathname.startsWith("/employee") || pathname === "/employee/login") {
    return Promise.resolve();
  }
  if (employeePrefetched.has(pathname)) return Promise.resolve();

  const existing = employeeInflight.get(pathname);
  if (existing) return existing;

  const spec = resolveEmployeeDashboardSpec(pathname);
  if (!spec) return Promise.resolve();

  const promise = Promise.all(spec.loaders.map((loader) => loader()))
    .then(() => {
      employeePrefetched.add(pathname);
    })
    .catch(() => {
      /* Best-effort prefetch. */
    })
    .finally(() => {
      employeeInflight.delete(pathname);
    });

  employeeInflight.set(pathname, promise);
  return promise;
}

export function employeeSidebarPrefetchPaths(): string[] {
  return [
    "/employee/tip-history",
    "/employee/analytics",
    "/employee/inbox",
    "/employee/payments/connect",
    "/employee/assignment",
    "/employee/settings",
  ];
}

export function prefetchEmployeeSidebarRoutesIdle(): void {
  for (const href of employeeSidebarPrefetchPaths()) {
    void prefetchEmployeeDashboardRoute(href);
  }
}
