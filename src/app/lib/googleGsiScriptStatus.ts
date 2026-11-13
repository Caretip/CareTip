/**
 * Whether Google's sign-in script (GIS) failed to load in this page session — e.g. blocked by a
 * content blocker or network policy. The provider reports it; the button reads it so it can show
 * an explanation instead of an empty, non-functional box.
 */
let failed = false;
const listeners = new Set<() => void>();

export function markGoogleGsiScriptFailed(): void {
  if (failed) return;
  failed = true;
  for (const listener of listeners) listener();
}

export function hasGoogleGsiScriptFailed(): boolean {
  return failed;
}

export function subscribeGoogleGsiScriptStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
