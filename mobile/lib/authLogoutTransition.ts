/**
 * Intentional logout window.
 * Call `begin` synchronously on Sign Out (before any await) so `(app)` can
 * unmount authenticated screens before caches empty or navigation fades.
 */

let active = false;
const listeners = new Set<() => void>();

/** `(app)` Stack must not paint after Sign Out starts, even for one frame. */
export function isAuthenticatedAppShellEligible(isAuthenticated: boolean): boolean {
  return isAuthenticated && !active;
}

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeAuthLogoutTransition(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function isAuthLogoutTransitionActive(): boolean {
  return active;
}

export function beginAuthLogoutTransition(): void {
  if (active) return;
  active = true;
  emit();
}

export function endAuthLogoutTransition(): void {
  if (!active) return;
  active = false;
  emit();
}
