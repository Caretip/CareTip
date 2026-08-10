/**
 * Brief window during intentional logout — disarms idle session guard.
 * Session teardown flips auth status before clearing caches so dashboards
 * do not empty/skeleton under a still-authenticated shell (no logout overlay).
 */

let active = false;
const listeners = new Set<() => void>();

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
