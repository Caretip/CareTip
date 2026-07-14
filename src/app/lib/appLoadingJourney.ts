import {
  APP_LOADING_PRIORITY,
  GLOBAL_OVERLAY_PRIORITIES,
  type AppLoadingPriority,
} from "./appLoadingPriority";
import { isAppShellInteractive } from "./appShellLifecycle";
import { isPublicAuthenticationPath } from "./authSession";
import { isPublicMarketingPath } from "./publicRoutes";

/** Higher tier owns the loading story until its registration ends. */
export const LOADER_JOURNEY_TIER = {
  ROUTINE: 100,
  TRANSITION: 200,
  CRITICAL: 300,
} as const;

export type LoaderJourneyTier =
  (typeof LOADER_JOURNEY_TIER)[keyof typeof LOADER_JOURNEY_TIER];

type OverlayRegistration = {
  key: string;
  priority: AppLoadingPriority;
  message?: string;
};

const BOOTSTRAP_KEY = "app-boot";

/** Same-priority overlay winner — higher wins (within a journey tier). */
const OVERLAY_KEY_PRECEDENCE: Record<string, number> = {
  "auth-logout-transition": 40,
  "auth-post-login-transition": 30,
  "payment-stripe-redirect": 36,
  "auth-login-submit": 28,
  "auth-signup-submit": 28,
  "payment-page-checkout": 26,
  "billing-plan-checkout": 26,
  "billing-trial-checkout": 26,
  "activate-caretip": 26,
  "onboarding-submit": 24,
  "app-auth-bootstrap": 20,
  "app-boot": 10,
};

const CRITICAL_KEYS = new Set([
  "auth-logout-transition",
  "auth-post-login-transition",
  "auth-login-submit",
  "auth-signup-submit",
  "billing-plan-checkout",
  "billing-trial-checkout",
  "onboarding-submit",
  "activate-caretip",
  "payment-stripe-redirect",
  "payment-page-checkout",
]);

const CRITICAL_PREFIXES = [
  "success-page-verification",
  "tip-completion-loading",
  "rating-page-verification",
] as const;

const TRANSITION_KEYS = new Set([
  BOOTSTRAP_KEY,
  "app-auth-bootstrap",
  "auth-invite-gate",
  "onboarding-init",
]);

const TRANSITION_PREFIXES = [
  "caretip-page-loader:",
  "staff-landing",
  "staff-public-path-entry",
  "employee-qr-entry",
  "table-qr-loading",
  "location-qr-loading",
  "qr-landing",
  "tip-amount-journey",
  "platform-admin-route-guard",
  "business-staff-directory",
  "select-employee",
] as const;

function normalizePath(pathname: string): string {
  return pathname.split("?")[0]?.split("#")[0] ?? "/";
}

function overlayKeyPrecedence(key: string): number {
  if (OVERLAY_KEY_PRECEDENCE[key] != null) return OVERLAY_KEY_PRECEDENCE[key]!;
  if (key.startsWith("protected-route-guard")) return 15;
  if (key.startsWith("role-protected-route-guard")) return 15;
  return 0;
}

/** Paint/chunk latches — hold commits only; never own the user-facing loading story. */
export function isTechnicalOverlayRegistration(key: string): boolean {
  return key.endsWith("-paint") || key.endsWith("-chunk");
}

export function resolveLoaderJourneyTier(key: string): LoaderJourneyTier {
  if (CRITICAL_KEYS.has(key)) return LOADER_JOURNEY_TIER.CRITICAL;
  if (CRITICAL_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return LOADER_JOURNEY_TIER.CRITICAL;
  }
  if (key.includes("checkout") || key.includes("payment")) {
    return LOADER_JOURNEY_TIER.CRITICAL;
  }

  if (TRANSITION_KEYS.has(key)) return LOADER_JOURNEY_TIER.TRANSITION;
  if (TRANSITION_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return LOADER_JOURNEY_TIER.TRANSITION;
  }

  return LOADER_JOURNEY_TIER.ROUTINE;
}

function compareRegistrations(a: OverlayRegistration, b: OverlayRegistration): number {
  const tierDiff = resolveLoaderJourneyTier(b.key) - resolveLoaderJourneyTier(a.key);
  if (tierDiff !== 0) return tierDiff;
  if (b.priority !== a.priority) return b.priority - a.priority;
  return overlayKeyPrecedence(b.key) - overlayKeyPrecedence(a.key);
}

function eligibleOverlayRegistrations(
  registrations: Map<string, OverlayRegistration>,
): OverlayRegistration[] {
  const all = [...registrations.values()].filter((reg) =>
    GLOBAL_OVERLAY_PRIORITIES.has(reg.priority),
  );
  const hasNonBootstrap = all.length > 1 || !all.some((reg) => reg.key === BOOTSTRAP_KEY);

  const eligible = all.filter((reg) => {
    if (reg.key === BOOTSTRAP_KEY && hasNonBootstrap) return false;
    if (isTechnicalOverlayRegistration(reg.key)) return false;
    return true;
  });

  if (eligible.length === 0) return [];

  const maxTier = Math.max(...eligible.map((reg) => resolveLoaderJourneyTier(reg.key)));
  if (maxTier > LOADER_JOURNEY_TIER.ROUTINE) {
    return eligible.filter(
      (reg) => resolveLoaderJourneyTier(reg.key) > LOADER_JOURNEY_TIER.ROUTINE,
    );
  }

  return eligible;
}

/** Winner for overlay visibility — highest journey tier, then manager priority. */
export function pickOverlayWinner(
  registrations: Map<string, OverlayRegistration>,
): OverlayRegistration | null {
  const eligible = eligibleOverlayRegistrations(registrations);
  if (eligible.length === 0) return null;

  let best: OverlayRegistration | null = null;
  for (const reg of eligible) {
    if (!best || compareRegistrations(reg, best) > 0) {
      best = reg;
    }
  }
  return best;
}

/** Message owner — highest journey tier keeps the story until that action completes. */
export function pickOverlayMessage(
  registrations: Map<string, OverlayRegistration>,
): string | undefined {
  const eligible = eligibleOverlayRegistrations(registrations);
  if (eligible.length === 0) return undefined;

  let messageOwner: OverlayRegistration | null = null;
  for (const reg of eligible) {
    if (!messageOwner || compareRegistrations(reg, messageOwner) > 0) {
      messageOwner = reg;
    }
  }
  return messageOwner?.message;
}

export function isAuthenticatedInAppShellPath(pathname: string): boolean {
  const p = normalizePath(pathname);
  if (isPublicAuthenticationPath(p)) return false;

  return (
    p.startsWith("/dashboard") ||
    p === "/business-dashboard" ||
    p.startsWith("/employee/dashboard") ||
    p === "/employee-dashboard" ||
    p.startsWith("/platform-admin")
  );
}

export function isCustomerJourneyPath(pathname: string): boolean {
  const p = normalizePath(pathname);

  if (
    p === "/payment" ||
    p === "/success" ||
    p === "/rating" ||
    p === "/tip-complete" ||
    p === "/tip-amount" ||
    p === "/select-employee"
  ) {
    return true;
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
    return true;
  }

  const segments = p.split("/").filter(Boolean);
  if (segments.length === 2 && isPublicMarketingPath(p)) {
    return true;
  }

  return false;
}

/**
 * Branded route navigation only for meaningful cold/marketing entry — never in-app dashboard hops.
 * After the app shell is interactive, SPA soft navigations never register.
 */
export function shouldRegisterBrandedRouteNavigation(pathname: string): boolean {
  if (isAppShellInteractive()) return false;
  const p = normalizePath(pathname);
  if (isAuthenticatedInAppShellPath(p)) return false;
  if (isCustomerJourneyPath(p)) return false;
  if (isPublicAuthenticationPath(p)) return false;
  if (p.startsWith("/onboarding")) return true;
  if (isPublicMarketingPath(p)) return true;

  return false;
}

export function shouldRegisterBrandedRouteGuard(gate: {
  guardBlocking: boolean;
  authBlocking: boolean;
  user: unknown;
  pathname: string;
}): boolean {
  if (!gate.guardBlocking) return false;
  /* Soft SPA: keep shell mounted — never reopen branded overlay for routine guard waits. */
  if (isAppShellInteractive()) return false;
  if (gate.user && !gate.authBlocking && isAuthenticatedInAppShellPath(gate.pathname)) {
    return false;
  }
  return true;
}
