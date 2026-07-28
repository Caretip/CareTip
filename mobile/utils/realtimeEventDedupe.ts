/** Idempotent realtime event processing — mirrors web `realtimeEventDedupe`. */

const seenEventIds = new Set<string>();
const MAX_SEEN = 500;

function pruneSeen(set: Set<string>): void {
  if (set.size <= MAX_SEEN) return;
  const drop = [...set].slice(0, set.size - MAX_SEEN + 50);
  for (const id of drop) set.delete(id);
}

export function shouldProcessRealtimeEvent(eventId: string | undefined | null): boolean {
  if (!eventId?.trim()) return true;
  if (seenEventIds.has(eventId)) return false;
  seenEventIds.add(eventId);
  pruneSeen(seenEventIds);
  return true;
}
