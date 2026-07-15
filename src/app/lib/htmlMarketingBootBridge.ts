/**
 * HTML first-paint CareTip boot (see index.html).
 * Owns the visual during cold start until fade-out — React must not mount a second loader on top.
 */

const BOOT_ID = "caretip-html-boot";
const ACTIVE_CLASS = "caretip-html-boot-active";
const EXITING_CLASS = "caretip-html-boot--exiting";
const MESSAGE_ID = "caretip-html-boot-message";
const SUB_ID = "caretip-html-boot-sub";

export function isHtmlBootBridgeActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(ACTIVE_CLASS);
}

export function setHtmlBootBridgeMessage(message: string | undefined): void {
  if (typeof document === "undefined" || !message?.trim()) return;
  const el = document.getElementById(MESSAGE_ID);
  if (!el) return;
  const next = message.trim();
  /* Avoid a no-op text rewrite that can still trigger accessibility / visual churn. */
  if (el.textContent === next) return;
  el.textContent = next;
}

/** Keep the HTML boot subline aligned with i18n once React is ready (same language as first paint). */
export function setHtmlBootBridgeSub(message: string | undefined): void {
  if (typeof document === "undefined" || !message?.trim()) return;
  const el = document.getElementById(SUB_ID);
  if (!el) return;
  const next = message.trim();
  if (el.textContent === next) return;
  el.textContent = next;
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
