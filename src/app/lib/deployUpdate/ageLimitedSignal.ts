/**
 * Treats an external "busy" signal as active for at most `maxMs` per activation, so a signal that is
 * never cleared (e.g. a Stripe hand-off cancelled before `pagehide`) cannot pin a tab to an old release.
 * The underlying signal is only read, never changed.
 */
export function createAgeLimitedSignal(source: {
  isActive(): boolean;
  subscribe(listener: () => void): () => void;
  now(): number;
  maxMs: number;
}): { isActive(): boolean; dispose(): void } {
  let activeSince: number | null = source.isActive() ? source.now() : null;

  const sync = () => {
    if (!source.isActive()) activeSince = null;
    else if (activeSince === null) activeSince = source.now();
  };
  const unsubscribe = source.subscribe(sync);

  return {
    isActive() {
      sync();
      return activeSince !== null && source.now() - activeSince < source.maxMs;
    },
    dispose: unsubscribe,
  };
}
