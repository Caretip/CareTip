import type { TFunction } from "i18next";
import { isPublicAuthenticationPath } from "./authSession";
import { isPublicMarketingPath } from "./publicRoutes";

/** `/{businessSlug}/{employeeSlug}` public team directory paths. */
function isPublicBusinessSlugPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return false;
  return isPublicMarketingPath(pathname);
}

/** Action-aware loader contexts — map to `common.loading.*` i18n keys. */
export type AppLoadingContext =
  | "startup"
  | "landing"
  | "signingIn"
  | "signingOut"
  | "sessionCheck"
  | "dashboard"
  | "analytics"
  | "qrTools"
  | "tipPage"
  | "findingRecipient"
  | "checkout"
  | "stripeRedirect"
  | "stripeReturn"
  | "finishing"
  | "receipt"
  | "saving"
  | "language"
  | "workspace";

const CONTEXT_I18N_KEY: Record<AppLoadingContext, string> = {
  startup: "common.loading.starting",
  landing: "common.loading.landing",
  signingIn: "common.loading.signingIn",
  signingOut: "common.signingOut",
  sessionCheck: "common.loading.sessionCheck",
  dashboard: "common.loading.dashboard",
  analytics: "common.loading.analytics",
  qrTools: "common.loading.qrTools",
  tipPage: "common.loading.tipPage",
  findingRecipient: "common.loading.findingRecipient",
  checkout: "common.loading.checkout",
  stripeRedirect: "common.loading.stripeRedirect",
  stripeReturn: "common.loading.stripeReturn",
  finishing: "common.loading.finishing",
  receipt: "common.loading.receipt",
  saving: "common.savingChanges",
  language: "common.loading.language",
  workspace: "common.gettingReady",
};

export function resolveAppLoadingContextMessage(
  context: AppLoadingContext,
  t: TFunction,
): string {
  return t(CONTEXT_I18N_KEY[context]);
}

function normalizePath(pathname: string): string {
  return pathname.split("?")[0]?.split("#")[0] ?? "/";
}

/**
 * Customer deep-link cold boot — journey-specific copy (never generic marketing landing).
 * Keep in sync with public/boot-locale.js resolveBootTagline.
 */
export function resolveCustomerJourneyBootContext(pathname: string): AppLoadingContext | null {
  const p = normalizePath(pathname);

  if (p === "/payment") return "checkout";
  if (p === "/success" || p === "/rating") return "stripeReturn";
  if (p === "/tip-complete") return "finishing";

  if (
    p === "/tip-amount" ||
    p === "/select-employee" ||
    p.startsWith("/staff/") ||
    p.startsWith("/qr/employee/") ||
    p.startsWith("/qr/location/") ||
    p.startsWith("/qr/table/") ||
    p.startsWith("/qr-landing/") ||
    p.startsWith("/table/") ||
    p.startsWith("/qr/business/")
  ) {
    return "tipPage";
  }

  const slugSegments = p.split("/").filter(Boolean);
  if (slugSegments.length === 2 && isPublicBusinessSlugPath(p)) {
    return "tipPage";
  }

  return null;
}

/**
 * Path-aware message for route transitions, guards, and cold boot.
 * Used by global registrars — one branded overlay, contextual copy.
 */
export function resolveRouteLoadingMessage(pathname: string, t: TFunction): string {
  const p = normalizePath(pathname);

  if (p === "/") {
    return resolveAppLoadingContextMessage("landing", t);
  }

  if (
    p === "/pricing" ||
    p === "/features" ||
    p === "/faq" ||
    p === "/contact" ||
    p === "/how-it-works" ||
    p === "/mobile-app" ||
    p === "/blog" ||
    p === "/careers" ||
    p === "/help" ||
    p === "/get-started" ||
    p === "/join"
  ) {
    return resolveAppLoadingContextMessage("landing", t);
  }

  if (isPublicAuthenticationPath(p)) {
    return resolveAppLoadingContextMessage("sessionCheck", t);
  }

  if (
    p === "/dashboard" ||
    p.startsWith("/dashboard/") ||
    p === "/business-dashboard" ||
    p === "/employee/dashboard" ||
    p.startsWith("/employee/dashboard/") ||
    p === "/employee-dashboard" ||
    p.startsWith("/platform-admin/dashboard") ||
    p.startsWith("/platform-admin/")
  ) {
    return resolveAppLoadingContextMessage("dashboard", t);
  }

  if (p.includes("/analytics") || p.includes("/insights")) {
    return resolveAppLoadingContextMessage("analytics", t);
  }

  if (p.includes("/qr") && (p.includes("management") || p.endsWith("/qr"))) {
    return resolveAppLoadingContextMessage("qrTools", t);
  }

  if (
    p.startsWith("/staff/") ||
    p.startsWith("/qr/employee/") ||
    p.startsWith("/qr/location/") ||
    p.startsWith("/qr/table/") ||
    p.startsWith("/qr-landing/") ||
    p.startsWith("/table/") ||
    p.startsWith("/qr/business/")
  ) {
    return resolveAppLoadingContextMessage("tipPage", t);
  }

  if (p === "/select-employee") {
    return resolveAppLoadingContextMessage("findingRecipient", t);
  }

  const slugSegments = p.split("/").filter(Boolean);
  if (slugSegments.length === 2 && isPublicBusinessSlugPath(p)) {
    return resolveAppLoadingContextMessage("findingRecipient", t);
  }

  if (p === "/tip-amount") {
    return resolveAppLoadingContextMessage("tipPage", t);
  }

  if (p === "/payment") {
    return resolveAppLoadingContextMessage("checkout", t);
  }

  if (p === "/success" || p === "/rating") {
    return resolveAppLoadingContextMessage("stripeReturn", t);
  }

  if (p === "/tip-complete") {
    return resolveAppLoadingContextMessage("finishing", t);
  }

  if (p.startsWith("/onboarding")) {
    return t("common.creatingWorkspace");
  }

  if (p.includes("/billing")) {
    return t("common.syncingAccountStatus");
  }

  if (p.includes("/settings")) {
    return resolveAppLoadingContextMessage("workspace", t);
  }

  if (isPublicMarketingPath(p)) {
    return resolveAppLoadingContextMessage("landing", t);
  }

  return resolveAppLoadingContextMessage("workspace", t);
}

/** Initial app-boot copy before React registrars mount (i18n is ready in main.tsx). */
export function resolveInitialBootLoadingMessage(pathname: string, t: TFunction): string {
  const p = normalizePath(pathname);
  const customerContext = resolveCustomerJourneyBootContext(p);
  if (customerContext) {
    return resolveAppLoadingContextMessage(customerContext, t);
  }
  if (typeof window !== "undefined") {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      return resolveAppLoadingContextMessage("startup", t);
    }
  }
  if (isPublicMarketingPath(p)) {
    return resolveAppLoadingContextMessage("landing", t);
  }
  if (isPublicAuthenticationPath(p)) {
    return resolveAppLoadingContextMessage("sessionCheck", t);
  }
  if (p.startsWith("/platform-admin")) {
    return resolveAppLoadingContextMessage("sessionCheck", t);
  }
  if (p.startsWith("/onboarding")) {
    return t("common.creatingWorkspace");
  }
  return resolveAppLoadingContextMessage("startup", t);
}
