import type { ComponentType } from "react";
import { loadRouteModuleWithRetry } from "../lib/chunkLoadRecovery";

/**
 * Route modules export page components. `memo` pages are `ExoticComponent<object>`;
 * `object` props keep eslint happy without `any` while remaining assignable from memo.
 */
type NamedModule = Record<string, ComponentType<object>>;
type LazyRouteResult = { Component: ComponentType<object> };

/** React Router `lazy` route loader — avoids `React.lazy` + vite preload on the entry graph. */
export function routeLazy<M extends NamedModule>(
  factory: () => Promise<M>,
  exportName: keyof M & string,
) {
  return async (): Promise<LazyRouteResult> => ({
    Component: (await loadRouteModuleWithRetry(factory))[exportName] as ComponentType<object>,
  });
}

export function routeLazyDefault(factory: () => Promise<{ default: ComponentType<object> }>) {
  return async (): Promise<LazyRouteResult> => {
    const mod = await loadRouteModuleWithRetry(factory);
    return { Component: mod.default };
  };
}

/** Dashboard shells — lazy so `/` never pulls DashboardHeader → vendor-motion. */
export const businessLayoutLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await loadRouteModuleWithRetry(() =>
    Promise.all([import("@/styles/bundles/dashboard.css"), import("../layouts/BusinessLayout")]),
  );
  return { Component: mod.BusinessLayout as ComponentType<object> };
};

export const employeeLayoutLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await loadRouteModuleWithRetry(() =>
    Promise.all([import("@/styles/bundles/dashboard.css"), import("../layouts/EmployeeLayout")]),
  );
  return { Component: mod.EmployeeLayout as ComponentType<object> };
};

/** Shared with {@link prefetchAuthLoginRoute} so logout can warm the same promise RR awaits. */
let authPageLazyPromise: Promise<LazyRouteResult> | null = null;
let platformAdminLoginLazyPromise: Promise<LazyRouteResult> | null = null;
/** Set once the module has loaded, so routes can render it synchronously (no Suspense fallback). */
let loadedAuthPage: ComponentType<object> | null = null;
let loadedPlatformAdminLogin: ComponentType<object> | null = null;

/** Auth CSS + AuthPage — kept for prefetch / remaining lazy auth cousins. Critical /login is eager. */
export function authPageLazy(): Promise<LazyRouteResult> {
  if (!authPageLazyPromise) {
    authPageLazyPromise = loadRouteModuleWithRetry(() =>
      Promise.all([import("@/styles/bundles/auth.css"), import("../components/AuthPage")]),
    ).then(([, mod]) => {
      loadedAuthPage = mod.AuthPage as ComponentType<object>;
      return { Component: loadedAuthPage };
    });
    // A failed fetch must not poison every later attempt (offline blip, deploy swap).
    authPageLazyPromise.catch(() => {
      authPageLazyPromise = null;
    });
  }
  return authPageLazyPromise;
}

/** AuthPage component when its code is already loaded; otherwise null. */
export function getLoadedAuthPage(): ComponentType<object> | null {
  return loadedAuthPage;
}
export const joinPageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await loadRouteModuleWithRetry(() =>
    Promise.all([import("@/styles/bundles/auth.css"), import("../pages/JoinPage")]),
  );
  return { Component: mod.JoinPage as ComponentType<object> };
};
export const forgotPasswordPageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await loadRouteModuleWithRetry(() =>
    Promise.all([import("@/styles/bundles/auth.css"), import("../pages/ForgotPasswordPage")]),
  );
  return { Component: mod.ForgotPasswordPage as ComponentType<object> };
};
export const accountRecoveryPageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await loadRouteModuleWithRetry(() =>
    Promise.all([import("@/styles/bundles/auth.css"), import("../pages/AccountRecoveryPage")]),
  );
  return { Component: mod.AccountRecoveryPage as ComponentType<object> };
};
export const emailChangePageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await loadRouteModuleWithRetry(() =>
    Promise.all([import("@/styles/bundles/auth.css"), import("../pages/EmailChangePage")]),
  );
  return { Component: mod.EmailChangePage as ComponentType<object> };
};

export const resetPasswordPageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await loadRouteModuleWithRetry(() =>
    Promise.all([import("@/styles/bundles/auth.css"), import("../pages/ResetPasswordPage")]),
  );
  return { Component: mod.ResetPasswordPage as ComponentType<object> };
};
export const activateEmployeePageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await loadRouteModuleWithRetry(() =>
    Promise.all([import("@/styles/bundles/auth.css"), import("../pages/ActivateEmployeePage")]),
  );
  return { Component: mod.ActivateEmployeePage as ComponentType<object> };
};
export const verifyEmailPageLazy = routeLazy(() => import("../pages/VerifyEmailPage"), "VerifyEmailPage");
export const checkEmailPageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await loadRouteModuleWithRetry(() =>
    Promise.all([import("@/styles/bundles/auth.css"), import("../pages/CheckEmailPage")]),
  );
  return { Component: mod.CheckEmailPage as ComponentType<object> };
};
export function platformAdminLoginPageLazy(): Promise<LazyRouteResult> {
  if (!platformAdminLoginLazyPromise) {
    platformAdminLoginLazyPromise = loadRouteModuleWithRetry(() =>
      Promise.all([
        import("@/styles/bundles/auth.css"),
        import("../pages/platform/PlatformAdminLoginPage"),
      ]),
    ).then(([, mod]) => {
      loadedPlatformAdminLogin = mod.PlatformAdminLoginPage as ComponentType<object>;
      return { Component: loadedPlatformAdminLogin };
    });
    platformAdminLoginLazyPromise.catch(() => {
      platformAdminLoginLazyPromise = null;
    });
  }
  return platformAdminLoginLazyPromise;
}

/** PlatformAdminLoginPage component when its code is already loaded; otherwise null. */
export function getLoadedPlatformAdminLogin(): ComponentType<object> | null {
  return loadedPlatformAdminLogin;
}

/** Signed-out entry routes rendered by the AuthPage / PlatformAdminLoginPage wrappers in routes.tsx. */
const AUTH_PAGE_ROUTES = new Set(["/auth", "/login", "/employee/login", "/join/signup", "/signup"]);

function normalizeRoutePath(path: string): string {
  const p = path.split("?")[0]?.split("#")[0] ?? path;
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

/**
 * For signed-out entry routes: null when the page code is loaded (navigate now), otherwise a promise
 * that settles when it is (navigate then — the current page stays on screen meanwhile, the same way
 * React Router waits for a route's `lazy` code). Settles (never rejects) so callers always navigate.
 * Returns null for every other path.
 */
/** True for the signed-out entry routes whose page code is split behind a full-screen fallback. */
export function isAuthEntryRoutePath(path: string): boolean {
  const p = normalizeRoutePath(path);
  return p === "/platform-admin/login" || AUTH_PAGE_ROUTES.has(p);
}

export function ensureAuthEntryRouteCode(path: string): Promise<void> | null {
  const p = normalizeRoutePath(path);
  if (p === "/platform-admin/login") {
    if (loadedPlatformAdminLogin) return null;
    return platformAdminLoginPageLazy().then(
      () => undefined,
      () => undefined,
    );
  }
  if (!AUTH_PAGE_ROUTES.has(p)) return null;
  if (loadedAuthPage) return null;
  return authPageLazy().then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Warm remaining lazy auth cousins. `/login` is eager — this is a no-op once AuthPage is in the graph.
 */
export function prefetchAuthLoginRoute(loginPath: string): void {
  const path = loginPath.split("?")[0]?.split("#")[0] ?? loginPath;
  if (path === "/platform-admin/login") {
    void platformAdminLoginPageLazy();
    return;
  }
  void authPageLazy();
}
export const unauthorizedPageLazy = routeLazy(
  () => import("../pages/UnauthorizedPage"),
  "UnauthorizedPage",
);
