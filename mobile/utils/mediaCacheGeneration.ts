/**
 * Process-wide media cache generation — bumped after logo/avatar uploads so
 * RemoteAvatar / BusinessLogo can bust RN image cache without logout.
 */

type Listener = (generation: number) => void;

let generation = 0;
const listeners = new Set<Listener>();

export function getMediaCacheGeneration(): number {
  return generation;
}

export function bumpMediaCacheGeneration(): number {
  generation += 1;
  for (const listener of listeners) listener(generation);
  return generation;
}

export function subscribeMediaCacheGeneration(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
