/**
 * HTML first-paint CareTip boot (see index.html).
 * Owns the visual during cold start until fade-out — React must not mount a second loader on top.
 * The boot screen has exactly one loading sentence (`#caretip-html-boot-tagline`).
 */

import { isCustomerJourneyPath } from "./appLoadingJourney";

/** Authenticated app shells that hand off HTML boot to {@link PROTECTED_APP_SHELL_READY_ATTR}. */
export const PROTECTED_APP_SHELL_READY_ATTR = "data-caretip-dashboard-ready";

function normalizePathname(pathname: string): string {
  return pathname.split("?")[0]?.split("#")[0] ?? "/";
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
  "/how-it-works",
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
  const committed = document.querySelector(
    "[data-caretip-route-ready], [data-caretip-public-committed], .caretip-landing",
  );
  if (p === "/") {
    return committed == null;
  }
  if (isCustomerJourneyPath(p)) {
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
  boot.classList.add(EXITING_CLASS);
  boot.setAttribute("aria-busy", "false");
}

export function dismissHtmlMarketingBootBridge(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove(ACTIVE_CLASS);
  document.getElementById(BOOT_ID)?.remove();
}
