import type { Socket } from "socket.io-client";
import type { InboxNotification } from "../api";
import { parseNotificationCreatedPayload } from "./parseNotificationCreatedPayload";
import { REALTIME_EVENTS } from "./realtimeContracts";
import { shouldProcessNotificationRealtime } from "./realtimeEventDedupe";
import {
  trackNotificationSocketEvent,
  trackSocketPatchApplied,
} from "./realtimeMetrics";

export type NotificationInboxPatch =
  | { type: "created"; notification: InboxNotification; unreadCount?: number }
  | { type: "unread_count"; unreadCount: number }
  | { type: "sync_request" }
  /** Client-side optimistic / reconciled mutations — keep bell + inbox in sync. */
  | { type: "read"; id: string; unreadCount: number; readAt: string }
  | { type: "read_all"; unreadCount: number; readAt: string }
  | { type: "deleted"; id: string; unreadCount: number }
  /** Roll back a failed optimistic mark-read / delete. */
  | {
      type: "restore";
      notification: InboxNotification;
      unreadCount: number;
    }
  /** Full list restore after a failed mark-all. */
  | {
      type: "snapshot";
      items: InboxNotification[];
      unreadCount: number;
    };

type PatchListener = (patch: NotificationInboxPatch) => void;

const patchListeners = new Set<PatchListener>();
let attachedSocket: Socket | null = null;
let detachSocket: (() => void) | null = null;

function notifyPatch(patch: NotificationInboxPatch): void {
  trackSocketPatchApplied();
  for (const listener of patchListeners) {
    try {
      listener(patch);
    } catch {
      // Subscriber errors must not break other notification consumers.
    }
  }
}

export function subscribeNotificationInboxPatches(listener: PatchListener): () => void {
  patchListeners.add(listener);
  return () => patchListeners.delete(listener);
}

/** Broadcast unread sync + optional list reload to all notification consumers. */
export function requestNotificationInboxSync(unreadCount: number): void {
  notifyPatch({ type: "unread_count", unreadCount });
  notifyPatch({ type: "sync_request" });
}

/** Publish a local inbox mutation so every `useNotifications` subscriber updates instantly. */
export function publishNotificationInboxPatch(patch: NotificationInboxPatch): void {
  notifyPatch(patch);
}

function logNotificationDelivery(
  phase: "socket_created" | "socket_unread",
  detail: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;
  console.debug(`[notifications] ${phase}`, detail);
}

/** Single socket subscription for inbox notifications — shared across bell + inbox page. */
export function attachNotificationInboxSocket(socket: Socket): () => void {
  if (attachedSocket === socket && detachSocket) return detachSocket;

  if (detachSocket) detachSocket();

  const onCreated = (raw: unknown) => {
    const parsed = parseNotificationCreatedPayload(raw);
    if (!parsed) return;
    if (!shouldProcessNotificationRealtime(parsed.eventId, parsed.notificationId)) return;

    trackNotificationSocketEvent();
    logNotificationDelivery("socket_created", {
      notificationId: parsed.notificationId,
      unreadCount: parsed.unreadCount,
      eventId: parsed.eventId,
    });

    if (parsed.notification) {
      notifyPatch({
        type: "created",
        notification: parsed.notification,
        unreadCount: parsed.unreadCount,
      });
      return;
    }
    if (typeof parsed.unreadCount === "number") {
      notifyPatch({ type: "unread_count", unreadCount: parsed.unreadCount });
    }
  };

  const onUnread = (payload: { unreadCount?: number }) => {
    if (typeof payload.unreadCount !== "number") return;
    trackNotificationSocketEvent();
    logNotificationDelivery("socket_unread", { unreadCount: payload.unreadCount });
    notifyPatch({ type: "unread_count", unreadCount: payload.unreadCount });
  };

  socket.on("notification_created", onCreated);
  socket.on(REALTIME_EVENTS.NOTIFICATION_CREATED, onCreated);
  socket.on("notification_unread_count", onUnread);

  attachedSocket = socket;
  detachSocket = () => {
    socket.off("notification_created", onCreated);
    socket.off(REALTIME_EVENTS.NOTIFICATION_CREATED, onCreated);
    socket.off("notification_unread_count", onUnread);
    if (attachedSocket === socket) {
      attachedSocket = null;
      detachSocket = null;
    }
  };

  return detachSocket;
}

export function detachNotificationInboxSocket(): void {
  detachSocket?.();
}
