/**
 * Keeps the CareTip branded overlay visible while the browser hands off to Stripe.
 * Component registrations clear on unmount before navigation completes — this hold
 * survives until `pagehide`.
 */

let active = false;
let holdMessage: string | undefined;
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

/** Explicit checkout-stage copy while the browser hands off — never infer from stale journey refs. */
export function getExternalStripeNavigationHoldMessage(): string | undefined {
  return holdMessage;
}

export function beginExternalStripeNavigationHold(message?: string): void {
  const nextMessage = message?.trim() || undefined;
  if (active) {
    if (nextMessage) {
      holdMessage = nextMessage;
      emit();
    }
    return;
  }
  active = true;
  holdMessage = nextMessage;
  emit();
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", endExternalStripeNavigationHold, { once: true });
  }
}

export function endExternalStripeNavigationHold(): void {
  if (!active) return;
  active = false;
  holdMessage = undefined;
  emit();
}

/** Test-only reset. */
export function resetExternalStripeNavigationHoldForTests(): void {
  active = false;
  holdMessage = undefined;
  listeners.clear();
}
