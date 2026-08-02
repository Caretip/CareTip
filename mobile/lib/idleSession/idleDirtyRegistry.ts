/**
 * Ref-counted registry of unsaved (“dirty”) authenticated form work.
 * Ported from web `idleDirtyRegistry.ts`.
 */

type Listener = () => void;

const reasons = new Set<string>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

export function registerIdleDirty(reason: string): void {
  const key = reason.trim();
  if (!key) return;
  const before = reasons.size;
  reasons.add(key);
  if (reasons.size !== before) emit();
}

export function unregisterIdleDirty(reason: string): void {
  const key = reason.trim();
  if (!key) return;
  if (!reasons.delete(key)) return;
  emit();
}

export function isIdleDirty(): boolean {
  return reasons.size > 0;
}

export function subscribeIdleDirty(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
