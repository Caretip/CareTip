import type { Router, Href } from "expo-router";
import type { AuthUser } from "@/types/auth";
import { getDashboardRouteForRole, type DashboardRoute } from "@/utils/routing";

/**
 * Single source of truth for post-authentication landing routes.
 * Login, Google Sign-In, MFA, verify-email, onboarding, and session restore
 * must all use getPostAuthHref / navigateAfterAuth — never push Notifications here.
 */

export type PostAuthAction =
  | { kind: "dashboard"; route: DashboardRoute }
  | { kind: "verify-email" }
  | { kind: "onboarding" };

/** Mirrors web `getPostAuthRedirect` for mobile routing decisions. */
export function resolvePostAuthAction(user: AuthUser): PostAuthAction {
  if (user.emailVerified === false) {
    return { kind: "verify-email" };
  }
  if (user.role === "MANAGER" && user.hasCompletedOnboarding === false) {
    return { kind: "onboarding" };
  }
  return { kind: "dashboard", route: getDashboardRouteForRole(user.role) };
}

export function getPostAuthHref(user: AuthUser): Href {
  const action = resolvePostAuthAction(user);
  if (action.kind === "verify-email") return "/(auth)/verify-email";
  if (action.kind === "onboarding") return "/(auth)/onboarding";
  return action.route;
}

export async function navigateAfterAuth(router: Router, user: AuthUser): Promise<void> {
  router.replace(getPostAuthHref(user));
}
