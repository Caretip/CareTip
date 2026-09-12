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

/** Auth CSS + AuthPage — kept for prefetch / remaining lazy auth cousins. Critical /login is eager. */
export function authPageLazy(): Promise<LazyRouteResult> {
  if (!authPageLazyPromise) {
    authPageLazyPromise = loadRouteModuleWithRetry(() =>
      Promise.all([import("@/styles/bundles/auth.css"), import("../components/AuthPage")]),
    ).then(([, mod]) => ({
      Component: mod.AuthPage as ComponentType<object>,
    }));
  }
  return authPageLazyPromise;
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
    ).then(([, mod]) => ({
      Component: mod.PlatformAdminLoginPage as ComponentType<object>,
    }));
  }
  return platformAdminLoginLazyPromise;
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
