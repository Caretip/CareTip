/**
 * HTML first-paint CareTip boot (see index.html).
 * Owns the visual during cold start until fade-out — React must not mount a second loader on top.
 * The boot screen has exactly one loading sentence (`#caretip-html-boot-tagline`).
 */

const BOOT_ID = "caretip-html-boot";
const ACTIVE_CLASS = "caretip-html-boot-active";
const EXITING_CLASS = "caretip-html-boot--exiting";
const TAGLINE_ID = "caretip-html-boot-tagline";

export function isHtmlBootBridgeActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(ACTIVE_CLASS);
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
  if (boot) boot.setAttribute("aria-label", `CareTip — ${next}`);
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
  boot.classList.add(EXITING_CLASS);
  boot.setAttribute("aria-busy", "false");
}

export function dismissHtmlMarketingBootBridge(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove(ACTIVE_CLASS);
  document.getElementById(BOOT_ID)?.remove();
}
