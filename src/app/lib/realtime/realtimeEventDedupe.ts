/** Sprint 5D — idempotent realtime event processing (duplicate protection). */

const seenEventIds = new Set<string>();
const seenNotificationIds = new Set<string>();
const MAX_SEEN = 500;

function pruneSeen(set: Set<string>): void {
  if (set.size <= MAX_SEEN) return;
  const drop = [...set].slice(0, set.size - MAX_SEEN + 50);
  for (const id of drop) set.delete(id);
}

/**
 * Deduplicate canonical + legacy socket aliases *per consumer*.
 * A global (unscoped) set would let the first dashboard listener swallow
 * `tip.received` so a second listener never patched KPIs / charts.
 */
export function shouldProcessRealtimeEvent(
  eventId: string | undefined | null,
  scope = "default",
): boolean {
  if (!eventId?.trim()) return true;
  const key = `${scope}::${eventId.trim()}`;
  if (seenEventIds.has(key)) return false;
  seenEventIds.add(key);
  pruneSeen(seenEventIds);
  return true;
}

/** Collapse `tip.received` envelope UUID and legacy `tip_received` onto the tip id. */
export function tipRealtimeDedupeId(
  payload: { tip?: { id?: string } } | null | undefined,
  eventId?: string,
): string | undefined {
  const tipId = payload?.tip?.id?.trim();
  if (tipId) return `tip:${tipId}`;
  return eventId?.trim() || undefined;
}

/** Dedupe inbox notifications across legacy + canonical socket events. */
export function shouldProcessNotificationRealtime(
  eventId: string | undefined | null,
  notificationId: string | undefined | null,
): boolean {
  const nid = notificationId?.trim();
  if (nid) {
    if (seenNotificationIds.has(nid)) return false;
    seenNotificationIds.add(nid);
    pruneSeen(seenNotificationIds);
  }
  return shouldProcessRealtimeEvent(eventId ?? nid, "inbox");
}

export function resetRealtimeEventDedupeForTests(): void {
  seenEventIds.clear();
  seenNotificationIds.clear();
}
