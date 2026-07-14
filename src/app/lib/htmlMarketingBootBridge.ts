/**
 * HTML first-paint CareTip boot (see index.html).
 * Owns the visual during cold start until fade-out — React must not mount a second loader on top.
 */

const BOOT_ID = "caretip-html-boot";
const ACTIVE_CLASS = "caretip-html-boot-active";
const EXITING_CLASS = "caretip-html-boot--exiting";
const MESSAGE_ID = "caretip-html-boot-message";

export function isHtmlBootBridgeActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(ACTIVE_CLASS);
}

export function setHtmlBootBridgeMessage(message: string | undefined): void {
  if (typeof document === "undefined" || !message?.trim()) return;
  const el = document.getElementById(MESSAGE_ID);
  if (el) el.textContent = message.trim();
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
