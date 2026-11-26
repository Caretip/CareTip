/**
 * Keeps the CareTip branded overlay visible while the browser hands off to Stripe.
 * Component registrations clear on unmount before navigation completes — this hold
 * survives until `pagehide`.
 */

let active = false;
let holdMessage: string | undefined;
/**
 * "overlay": the global CareTip loading screen covers the page until the browser leaves.
 * "inline": the page stays visible (the clicked button shows the progress) — used by checkout and
 * billing-portal buttons, where a full-screen near-white overlay read as a blank page.
 * Both block deploy-update reloads while the browser hands off.
 */
export type ExternalStripeHoldPresentation = "overlay" | "inline";
let presentation: ExternalStripeHoldPresentation = "overlay";
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeExternalStripeNavigationHold(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function isExternalStripeNavigationHoldActive(): boolean {
  return active;
}

/** True only for a hold that asked for the global overlay (see ExternalStripeHoldPresentation). */
export function isExternalStripeNavigationHoldOverlayActive(): boolean {
  return active && presentation === "overlay";
}

/** Explicit checkout-stage copy while the browser hands off — never infer from stale journey refs. */
export function getExternalStripeNavigationHoldMessage(): string | undefined {
  return holdMessage;
}

export function beginExternalStripeNavigationHold(
  message?: string,
  options?: { presentation?: ExternalStripeHoldPresentation },
): void {
  const nextMessage = message?.trim() || undefined;
  const nextPresentation = options?.presentation ?? "overlay";
  if (active) {
    if (nextMessage || nextPresentation !== presentation) {
      if (nextMessage) holdMessage = nextMessage;
      presentation = nextPresentation;
      emit();
    }
    return;
  }
  active = true;
  holdMessage = nextMessage;
  presentation = nextPresentation;
  emit();
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", endExternalStripeNavigationHold, { once: true });
  }
}

export function endExternalStripeNavigationHold(): void {
  if (!active) return;
  active = false;
  holdMessage = undefined;
  presentation = "overlay";
  emit();
}

/** Test-only reset. */
export function resetExternalStripeNavigationHoldForTests(): void {
  active = false;
  holdMessage = undefined;
  presentation = "overlay";
  listeners.clear();
}
