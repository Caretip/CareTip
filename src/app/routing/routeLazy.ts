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

/** Auth flows — lazy JS + auth CSS off the landing critical path. */
export const authPageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await Promise.all([
    import("@/styles/bundles/auth.css"),
    import("../components/AuthPage"),
  ]);
  return { Component: mod.AuthPage as ComponentType<unknown> };
};
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
export const platformAdminLoginPageLazy = async (): Promise<LazyRouteResult> => {
  const [, mod] = await Promise.all([
    import("@/styles/bundles/auth.css"),
    import("../pages/platform/PlatformAdminLoginPage"),
  ]);
  return { Component: mod.PlatformAdminLoginPage as ComponentType<unknown> };
};
export const unauthorizedPageLazy = routeLazy(
  () => import("../pages/UnauthorizedPage"),
  "UnauthorizedPage",
);
