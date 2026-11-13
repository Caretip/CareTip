/**
 * HTML first-paint CareTip boot (see index.html).
 * Owns the visual during cold start until fade-out — React must not mount a second loader on top.
 * The boot screen has exactly one loading sentence (`#caretip-html-boot-tagline`).
 */

import { isCustomerJourneyPath } from "./appLoadingJourney";
import { isLandingHeroCommitted } from "./landingHeroReadyDom";
import { markLandingColdLoad } from "./landingColdLoadMarks";
import { normalizePublicPathname } from "./publicRoutes";
import { isPublicAuthenticationPath } from "./authSession";

/**
 * Upper bound for holding the boot screen while a destination's chunk loads. Past it the boot is
 * released whatever the page has drawn, so a slow or broken chunk can never leave the cover up.
 */
export const HTML_BOOT_RETAIN_CAP_MS = 10_000;

/**
 * Auth forms and recovery steps. Each is a lazy chunk whose root is `.caretip-auth-page`
 * (AuthPage, AuthRecoveryLayout, JoinPage) or, while auth state settles, the branded
 * `.app-branded-loader` (AuthBootstrapShell).
 */
export function isAuthFormShellPath(p: string): boolean {
  if (isPublicAuthenticationPath(p)) return true;
  if (p === "/verify-email" || p === "/activate") return true;
  if (p === "/join" || p.startsWith("/join/")) return true;
  if (p.startsWith("/account/recovery") || p.startsWith("/account/email-change")) return true;
  return false;
}

const AUTH_FORM_COMMITTED_SELECTOR = ".caretip-auth-page, .app-branded-loader, [data-caretip-route-ready]";

/** Authenticated app shells that hand off HTML boot to {@link PROTECTED_APP_SHELL_READY_ATTR}. */
export const PROTECTED_APP_SHELL_READY_ATTR = "data-caretip-dashboard-ready";

function normalizePathname(pathname: string): string {
  return normalizePublicPathname(pathname);
}

const BOOT_ID = "caretip-html-boot";
const ACTIVE_CLASS = "caretip-html-boot-active";
const EXITING_CLASS = "caretip-html-boot--exiting";
const TAGLINE_ID = "caretip-html-boot-tagline";

/** Lazy public marketing shells that use PublicPageShell (route-ready handoff). */
const LAZY_PUBLIC_MARKETING_SHELL_EXACT = new Set([
  "/pricing",
  "/features",
  "/faq",
  "/contact",
  "/privacy",
  "/terms",
  "/avv",
  "/dpa",
  "/plv",
  "/cookies",
  "/imprint",
  "/help",
  "/blog",
  "/careers",
  "/mobile-app",
]);

function isLazyPublicMarketingShellPath(pathname: string): boolean {
  if (LAZY_PUBLIC_MARKETING_SHELL_EXACT.has(pathname)) return true;
  return pathname.startsWith("/industries/");
}

function readPathname(): string {
  if (typeof window === "undefined") return "/";
  return normalizePathname(window.location.pathname);
}

/**
 * Business / employee / platform dashboard shells — Stripe return and cold app boot.
 * Excludes onboarding/subscription routes that use different first-paint surfaces.
 */
export function isProtectedAppShellHandoffPath(pathname?: string): boolean {
  const p = normalizePathname(pathname ?? readPathname());
  if (p === "/dashboard" || p.startsWith("/dashboard/")) return true;
  if (p === "/employee" || p.startsWith("/employee/")) return true;
  if (p === "/employee-dashboard" || p.startsWith("/employee-dashboard/")) return true;
  if (p === "/platform-admin" || p.startsWith("/platform-admin/")) return true;
  if (p === "/business-dashboard" || p.startsWith("/business-dashboard/")) return true;
  return false;
}

export function isProtectedAppShellCommitted(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(`[${PROTECTED_APP_SHELL_READY_ATTR}]`) != null;
}

/** Keep first-paint boot until the public destination has real DOM (not an empty Outlet). */
export function shouldRetainHtmlBootUntilLandingCommit(): boolean {
  if (typeof document === "undefined") return false;
  const p = readPathname();
  if (isProtectedAppShellHandoffPath(p)) {
    return !isProtectedAppShellCommitted();
  }
  // Public destinations never hold the boot past the cap: a page that does not set its ready
  // marker (or a chunk that never arrives) must not leave the visitor on a loader indefinitely.
  if (performance.now() >= HTML_BOOT_RETAIN_CAP_MS) return false;
  if (p === "/") {
    return !isLandingHeroCommitted();
  }
  const committed = document.querySelector(
    "[data-caretip-route-ready], [data-caretip-public-committed], .caretip-landing",
  );
  // Auth forms first: they must hand off to their own page, never wait for a tip-page marker.
  // Without this branch the boot left on React's first DOM write and the cream background showed
  // alone until the form chunk arrived (1.3 s on a 4G phone at /login).
  if (isAuthFormShellPath(p)) {
    return document.querySelector(AUTH_FORM_COMMITTED_SELECTOR) == null;
  }
  if (isCustomerJourneyPath(p)) {
    return document.querySelector("[data-caretip-route-ready]") == null;
  }
  // Google redirect return: hold through the hop to the auth page, which shows the Google progress
  // state from its first paint; only the error screen commits here. Otherwise the boot left on
  // React's first DOM write and a blank frame showed before any loader mounted.
  if (p === "/auth/google/complete") {
    return document.querySelector("[data-caretip-route-ready]") == null;
  }
  // Stripe subscription return pages (protected, outside the dashboard shell): hold until the
  // page commits, or the boot left on the first DOM write and a bare background showed first.
  if (p.startsWith("/subscription/")) {
    return document.querySelector("[data-caretip-route-ready]") == null;
  }
  // Lazy PublicPageShell marketing — same cream-gap class as former lazy `/`.
  if (isLazyPublicMarketingShellPath(p)) {
    return committed == null;
  }
  return false;
}

export function isHtmlBootBridgeActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(ACTIVE_CLASS);
}

/** True while the first-paint boot node is still in the document (including fade-out). */
export function isHtmlBootElementPresent(): boolean {
  if (typeof document === "undefined") return false;
  return document.getElementById(BOOT_ID) != null;
}

/**
 * React must not mount a second CareTip loading screen while the HTML boot node exists.
 * Ownership is the DOM node, not only the `caretip-html-boot-active` class.
 */
export function shouldMountReactBootOverlay(
  overlayPresented: boolean,
  htmlBootElementPresent: boolean = isHtmlBootElementPresent(),
): boolean {
  return overlayPresented && !htmlBootElementPresent;
}

/** Replace the single visible boot sentence in place. Never add a second line. */
export function setHtmlBootBridgeTagline(message: string | undefined): void {
  if (typeof document === "undefined" || !message?.trim()) return;
  const el = document.getElementById(TAGLINE_ID);
  if (!el) return;
  const next = message.trim();
  if (el.textContent === next) return;
  el.textContent = next;
  const boot = document.getElementById(BOOT_ID);
  if (boot) boot.setAttribute("aria-label", `CareTip: ${next}`);
}

/** @deprecated Alias — HTML boot has one tagline, not a message + subline. */
export function setHtmlBootBridgeMessage(message: string | undefined): void {
  setHtmlBootBridgeTagline(message);
}

/** @deprecated Second boot sentences are not allowed. Kept as a no-op. */
export function setHtmlBootBridgeSub(_message?: string): void {
  /* no-op */
}

/** Start the same fade-out motion used by AppBrandedLoadingScreen. */
export function beginHtmlBootBridgeExit(): void {
  if (typeof document === "undefined") return;
  const boot = document.getElementById(BOOT_ID);
  if (!boot) return;
  if (boot.classList.contains(EXITING_CLASS) && boot.getAttribute("aria-busy") === "false") {
    return;
  }
  markLandingColdLoad("boot-exit-start");
  boot.classList.add(EXITING_CLASS);
  boot.setAttribute("aria-busy", "false");
}

export function dismissHtmlMarketingBootBridge(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove(ACTIVE_CLASS);
  document.getElementById(BOOT_ID)?.remove();
  markLandingColdLoad("boot-removed");
}
