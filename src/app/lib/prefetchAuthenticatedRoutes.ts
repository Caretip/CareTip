/**
 * Prefetch lazy authenticated dashboard chunks on hover/focus/idle — faster post-login navigation.
 * Post-auth prepare waits only for shell chunks (layout + CSS), never for dashboard widget data.
 */

import { markPostLoginDashboardWarm } from "./authPostLoginTransition";

type RouteImporter = () => Promise<unknown>;

/** Full destination (layout + page) — used for idle/hover prefetch. */
const AUTHENTICATED_ROUTE_IMPORTERS: Record<string, RouteImporter> = {
  "/dashboard": () =>
    Promise.all([
      import("@/styles/bundles/dashboard.css"),
      import("../layouts/BusinessLayout"),
      import("../pages/business/BusinessDashboard"),
    ]),
  "/employee/dashboard": () =>
    Promise.all([
      import("@/styles/bundles/dashboard.css"),
      import("../layouts/EmployeeLayout"),
      import("../pages/employee/EmployeeDashboard"),
    ]),
  "/platform-admin/dashboard": () =>
    Promise.all([
      import("@/styles/bundles/dashboard.css"),
      import("../layouts/SuperAdminLayout"),
      import("../components/AdminDashboard"),
    ]),
  "/login": () => import("../components/AuthPage"),
  "/signup": () => import("../components/AuthPage"),
  "/employee/login": () => import("../components/AuthPage"),
  "/onboarding": () => import("../pages/BusinessOnboardingPage").catch(() => null),
  "/verify-email": () => import("../pages/VerifyEmailPage").catch(() => null),
};

/**
 * Shell-only importers — enough to paint sidebar/header/nav before widget page chunks.
 * Auth navigation awaits these; page widgets load progressively after shell.
 */
const AUTHENTICATED_SHELL_IMPORTERS: Record<string, RouteImporter> = {
  "/dashboard": () =>
    Promise.all([
      import("@/styles/bundles/dashboard.css"),
      import("../layouts/BusinessLayout"),
    ]),
  "/employee/dashboard": () =>
    Promise.all([
      import("@/styles/bundles/dashboard.css"),
      import("../layouts/EmployeeLayout"),
    ]),
  "/platform-admin/dashboard": () =>
    Promise.all([
      import("@/styles/bundles/dashboard.css"),
      import("../layouts/SuperAdminLayout"),
    ]),
  "/onboarding": () => import("../pages/BusinessOnboardingPage").catch(() => null),
  "/verify-email": () => import("../pages/VerifyEmailPage").catch(() => null),
};

const prefetched = new Set<string>();
const shellPrefetched = new Set<string>();
const inflight = new Map<string, Promise<void>>();
const shellInflight = new Map<string, Promise<void>>();

function normalizePath(path: string): string {
  return path.split("#")[0]?.split("?")[0] ?? path;
}

function resolveShellKey(normalized: string): string | null {
  if (normalized.startsWith("/dashboard")) return "/dashboard";
  if (normalized.startsWith("/employee/dashboard") || normalized === "/employee") {
    return "/employee/dashboard";
  }
  if (normalized.startsWith("/platform-admin")) return "/platform-admin/dashboard";
  if (normalized.startsWith("/onboarding")) return "/onboarding";
  if (normalized.startsWith("/verify-email")) return "/verify-email";
  if (AUTHENTICATED_SHELL_IMPORTERS[normalized]) return normalized;
  return null;
}

export function prefetchAuthenticatedRoute(path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized) return Promise.resolve();
  if (prefetched.has(normalized)) return Promise.resolve();

  const existing = inflight.get(normalized);
  if (existing) return existing;

  const factory = AUTHENTICATED_ROUTE_IMPORTERS[normalized];
  if (!factory) return Promise.resolve();

  const promise = factory()
    .then(() => {
      prefetched.add(normalized);
      shellPrefetched.add(normalized);
    })
    .catch(() => {
      /* Prefetch is best-effort — navigation still proceeds. */
    })
    .finally(() => {
      inflight.delete(normalized);
    });

  inflight.set(normalized, promise);
  return promise;
}

/** Prefetch CSS + layout only — required for shell-first post-auth paint. */
export function prefetchAuthenticatedShell(path: string): Promise<void> {
  const normalized = normalizePath(path);
  const shellKey = resolveShellKey(normalized);
  if (!shellKey) return Promise.resolve();
  if (shellPrefetched.has(shellKey) || prefetched.has(shellKey)) return Promise.resolve();

  const existing = shellInflight.get(shellKey);
  if (existing) return existing;

  const factory = AUTHENTICATED_SHELL_IMPORTERS[shellKey];
  if (!factory) return Promise.resolve();

  const promise = factory()
    .then(() => {
      shellPrefetched.add(shellKey);
    })
    .catch(() => {
      /* Best-effort — navigate still proceeds. */
    })
    .finally(() => {
      shellInflight.delete(shellKey);
    });

  shellInflight.set(shellKey, promise);
  return promise;
}

/** Warm business + employee dashboard shells after auth surfaces idle. */
export function prefetchDashboardRoutes(): void {
  void prefetchAuthenticatedRoute("/dashboard");
  void prefetchAuthenticatedRoute("/employee/dashboard");
}

/**
 * Dashboard-critical: warm period stats in the background after auth navigates.
 * Must never be awaited on the Sign In path.
 */
function warmBusinessDashboardDataInBackground(): void {
  void (async () => {
    try {
      const { fetchBusinessPeriodStats } = await import("./businessAnalytics");
      await fetchBusinessPeriodStats("week", { silent: true });
      markPostLoginDashboardWarm();
    } catch {
      /* Dashboard fetches on mount with skeletons — warm is optional. */
    }
  })();
}

/**
 * Auth-critical prepare only: shell chunks (layout + CSS).
 * Does not await metrics, charts, profile refresh, or page widget chunks.
 * Page chunks + stats warm start in parallel (fire-and-forget) for progressive fill.
 */
export async function preparePostAuthDestination(path: string): Promise<void> {
  const normalized = normalizePath(path);
  const shellKey = resolveShellKey(normalized);
  const t0 = performance.now();
  if (import.meta.env.DEV) {
    void import("./postLoginRuntimeTrace").then(({ markPostLoginTrace }) => {
      markPostLoginTrace("preparePostAuthDestination_start", { path: normalized, shellKey });
    });
  }

  await prefetchAuthenticatedShell(normalized);

  if (import.meta.env.DEV) {
    void import("./postLoginRuntimeTrace").then(({ markPostLoginTrace }) => {
      markPostLoginTrace("preparePostAuthDestination_shell_done", {
        path: normalized,
        shellPrefetchMs: Math.round(performance.now() - t0),
      });
    });
  }

  // Dashboard-critical / background: start page chunk + optional stats warm without blocking navigate.
  if (shellKey === "/dashboard") {
    void prefetchAuthenticatedRoute("/dashboard");
    warmBusinessDashboardDataInBackground();
  } else if (shellKey === "/employee/dashboard") {
    void prefetchAuthenticatedRoute("/employee/dashboard");
  } else if (shellKey === "/platform-admin/dashboard") {
    void prefetchAuthenticatedRoute("/platform-admin/dashboard");
  } else if (shellKey) {
    void prefetchAuthenticatedRoute(shellKey);
  }
}
