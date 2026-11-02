import type { BusinessKycStatus } from "./authSession";
import type { OnboardingVerificationStatus } from "./api";

/** Minimal shape for post-auth routing (login, refresh, OAuth). */
export type PostAuthRedirectUser = {
  isVerified: boolean;
  role: "business" | "employee" | "platform_admin" | "admin" | "user";
  hasCompletedOnboarding: boolean;
  /** Legacy KYC-derived status for go-live hints — not a dashboard gate. */
  status?: BusinessKycStatus;
  onboardingVerificationStatus?: OnboardingVerificationStatus;
};

/**
 * Canonical post-authentication destination.
 * Order: email verify → onboarding wizard → role home.
 * Platform onboarding approval does not block dashboard access (QR/go-live only).
 * KYC is financial/compliance only and does not block dashboard access.
 */
export function getPostAuthRedirect(u: PostAuthRedirectUser): string {
  if (!u.isVerified) return "/verify-email";

  if (u.role === "business") {
    if (!u.hasCompletedOnboarding) return "/onboarding";
    return "/dashboard";
  }

  if (u.role === "employee") return "/employee/dashboard";
  if (u.role === "platform_admin" || u.role === "admin") return "/platform-admin/dashboard";
  return "/dashboard";
}

/**
 * Employee deep links (e.g. tip email → /employee/tip-history) survive sign-in.
 * Only same-app `/employee/...` paths are honoured — never another host or role shell.
 */
export function resolvePostAuthTarget(u: PostAuthRedirectUser, requestedPath: unknown): string {
  const home = getPostAuthRedirect(u);
  if (u.role !== "employee" || home !== "/employee/dashboard") return home;
  if (typeof requestedPath !== "string") return home;
  const path = requestedPath.trim();
  if (!/^\/employee\/[A-Za-z0-9/_-]*$/.test(path) || path.includes("//")) return home;
  if (path === "/employee/login" || path.startsWith("/employee/login/")) return home;
  return path;
}
