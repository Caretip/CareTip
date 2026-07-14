import type { ComponentType } from "react";

type NamedModule = Record<string, ComponentType<unknown>>;
type LazyRouteResult = { Component: ComponentType<unknown> };

/** React Router `lazy` route loader — avoids `React.lazy` + vite preload on the entry graph. */
export function routeLazy<M extends NamedModule>(
  factory: () => Promise<M>,
  exportName: keyof M & string,
) {
  return async (): Promise<LazyRouteResult> => ({
    Component: (await factory())[exportName] as ComponentType<unknown>,
  });
}

export function routeLazyDefault(factory: () => Promise<{ default: ComponentType<unknown> }>) {
  return async (): Promise<LazyRouteResult> => {
    const mod = await factory();
    return { Component: mod.default };
  };
}

/** Dashboard shells — lazy so `/` never pulls DashboardHeader → vendor-motion. */
export const businessLayoutLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await Promise.all([
    import("@/styles/bundles/dashboard.css"),
    import("../layouts/BusinessLayout"),
  ]);
  return { Component: mod.BusinessLayout as ComponentType<unknown> };
};

export const employeeLayoutLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await Promise.all([
    import("@/styles/bundles/dashboard.css"),
    import("../layouts/EmployeeLayout"),
  ]);
  return { Component: mod.EmployeeLayout as ComponentType<unknown> };
};

/** Shared with {@link prefetchAuthLoginRoute} so logout can warm the same promise RR awaits. */
let authPageLazyPromise: Promise<LazyRouteResult> | null = null;
let platformAdminLoginLazyPromise: Promise<LazyRouteResult> | null = null;

/** Auth flows — lazy JS + auth CSS off the landing critical path. */
export function authPageLazy(): Promise<LazyRouteResult> {
  if (!authPageLazyPromise) {
    authPageLazyPromise = Promise.all([
      import("@/styles/bundles/auth.css"),
      import("../components/AuthPage"),
    ]).then(([, mod]) => ({
      Component: mod.AuthPage as ComponentType<unknown>,
    }));
  }
  return authPageLazyPromise;
}
export const joinPageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await Promise.all([
    import("@/styles/bundles/auth.css"),
    import("../pages/JoinPage"),
  ]);
  return { Component: mod.JoinPage as ComponentType<unknown> };
};
export const forgotPasswordPageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await Promise.all([
    import("@/styles/bundles/auth.css"),
    import("../pages/ForgotPasswordPage"),
  ]);
  return { Component: mod.ForgotPasswordPage as ComponentType<unknown> };
};
export const resetPasswordPageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await Promise.all([
    import("@/styles/bundles/auth.css"),
    import("../pages/ResetPasswordPage"),
  ]);
  return { Component: mod.ResetPasswordPage as ComponentType<unknown> };
};
export const activateEmployeePageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await Promise.all([
    import("@/styles/bundles/auth.css"),
    import("../pages/ActivateEmployeePage"),
  ]);
  return { Component: mod.ActivateEmployeePage as ComponentType<unknown> };
};
export const verifyEmailPageLazy = routeLazy(() => import("../pages/VerifyEmailPage"), "VerifyEmailPage");
export const checkEmailPageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await Promise.all([
    import("@/styles/bundles/auth.css"),
    import("../pages/CheckEmailPage"),
  ]);
  return { Component: mod.CheckEmailPage as ComponentType<unknown> };
};
export function platformAdminLoginPageLazy(): Promise<LazyRouteResult> {
  if (!platformAdminLoginLazyPromise) {
    platformAdminLoginLazyPromise = Promise.all([
      import("@/styles/bundles/auth.css"),
      import("../pages/platform/PlatformAdminLoginPage"),
    ]).then(([, mod]) => ({
      Component: mod.PlatformAdminLoginPage as ComponentType<unknown>,
    }));
  }
  return platformAdminLoginLazyPromise;
}

/**
 * Warm the same lazy auth module (+ CSS) React Router will load on logout navigate.
 * Safe to call repeatedly — promises are shared with the route lazy loaders.
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
