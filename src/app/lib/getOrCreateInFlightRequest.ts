/**
 * Share one in-flight promise per key (request coalescing).
 * Clears the entry on settle so later calls can retry after failure.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function getOrCreateInFlightRequest<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = factory().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/** Test / logout hooks — drop shared in-flight state for a key or entire map. */
export function clearInFlightRequest(key?: string): void {
  if (key) inFlight.delete(key);
  else inFlight.clear();
}
