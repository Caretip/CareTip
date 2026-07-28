import type { Socket } from "socket.io-client";
import type { BusinessActivityFeedItem } from "@/types/activity";
import { REALTIME_EVENTS, type RealtimeEventEnvelope } from "@/lib/realtime/realtimeContracts";

type ActivityRaw = RealtimeEventEnvelope<BusinessActivityFeedItem> | BusinessActivityFeedItem;

function parseActivityPayload(raw: ActivityRaw): {
  item: BusinessActivityFeedItem;
  eventId?: string;
  businessId?: string | null;
} | null {
  if ("payload" in raw && raw.payload && typeof raw.payload === "object" && "id" in raw.payload) {
    return {
      item: raw.payload as BusinessActivityFeedItem,
      eventId: raw.eventId,
      businessId: raw.businessId,
    };
  }
  if ("id" in raw && "type" in raw && "occurredAt" in raw) {
    return { item: raw as BusinessActivityFeedItem };
  }
  return null;
}

/** Subscribe to Activity Center live events only (`activity.created`). */
export function subscribeActivityCreated(
  socket: Socket,
  handler: (
    item: BusinessActivityFeedItem,
    meta?: { eventId?: string; businessId?: string | null },
  ) => void,
): () => void {
  const onEvent = (raw: ActivityRaw) => {
    const parsed = parseActivityPayload(raw);
    if (!parsed) return;
    handler(parsed.item, { eventId: parsed.eventId, businessId: parsed.businessId });
  };

  socket.on(REALTIME_EVENTS.ACTIVITY_CREATED, onEvent);
  return () => {
    socket.off(REALTIME_EVENTS.ACTIVITY_CREATED, onEvent);
  };
}
