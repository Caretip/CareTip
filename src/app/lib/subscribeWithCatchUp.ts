/**
 * Subscribes to an external store, then re-reads it once.
 *
 * React renders before effects run, so a store update landing between the two reaches no listener
 * and the component keeps its stale render. `useSyncExternalStore` covers this; hand-written
 * subscriptions must do it themselves. Without it, a session refresh finishing inside that gap left
 * the app on its loading screen until the bootstrap watchdog fired 12 seconds later.
 */
export function subscribeWithCatchUp(
  subscribe: (listener: () => void) => () => void,
  sync: () => void,
  /** Skip the catch-up when nothing changed, for `sync` functions that always re-render. */
  isStale: () => boolean = () => true,
): () => void {
  const unsubscribe = subscribe(sync);
  if (isStale()) sync();
  return unsubscribe;
}
