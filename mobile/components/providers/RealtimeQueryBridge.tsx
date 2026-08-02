import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "@/components/providers/SocketProvider";
import { queryKeys } from "@/services/api/queryClient";

type RealtimeEnvelope = {
  eventId?: string;
  event?: string;
  payload?: unknown;
};

const DEDUPE_TTL_MS = 60_000;
const DEBOUNCE_MS = 350;

/**
 * Socket → React Query invalidate bridge (web quiet-refetch parity).
 * - Dedupes by envelope.eventId
 * - Debounces stampedes
 * - Targeted invalidation per event family
 * - Foreground resume refresh after background
 */
export function RealtimeQueryBridge() {
  const { socket, connected } = useSocket();
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Set<string>>(new Set());
  const seenIdsRef = useRef<Map<string, number>>(new Map());
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!socket) return;

    const pruneSeen = () => {
      const now = Date.now();
      for (const [id, at] of seenIdsRef.current) {
        if (now - at > DEDUPE_TTL_MS) seenIdsRef.current.delete(id);
      }
    };

    const flush = () => {
      const keys = pendingRef.current;
      pendingRef.current = new Set();
      if (keys.has("stats")) void queryClient.invalidateQueries({ queryKey: queryKeys.businessStats });
      if (keys.has("activity"))
        void queryClient.invalidateQueries({ queryKey: queryKeys.businessActivity });
      if (keys.has("qr")) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.businessQr });
        void queryClient.invalidateQueries({ queryKey: queryKeys.businessQrAnalytics });
      }
      if (keys.has("bizTips"))
        void queryClient.invalidateQueries({ queryKey: queryKeys.businessTips });
      if (keys.has("empTips")) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.employeeTips });
        void queryClient.invalidateQueries({ queryKey: queryKeys.employeeTipList });
      }
      if (keys.has("inbox")) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
        void queryClient.invalidateQueries({ queryKey: queryKeys.notificationUnread });
      }
    };

    const schedule = (targets: string[]) => {
      for (const t of targets) pendingRef.current.add(t);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, DEBOUNCE_MS);
    };

    const handle = (eventName: string, raw?: RealtimeEnvelope) => {
      pruneSeen();
      const eventId = raw && typeof raw === "object" ? raw.eventId : undefined;
      if (typeof eventId === "string" && eventId.length > 0) {
        if (seenIdsRef.current.has(eventId)) return;
        seenIdsRef.current.set(eventId, Date.now());
      }

      if (eventName === "tip.received" || eventName === "tip_received") {
        schedule(["stats", "activity", "bizTips", "empTips", "inbox"]);
        return;
      }
      if (eventName === "qr.scanned") {
        schedule(["qr", "activity"]);
        return;
      }
      if (eventName === "activity.created") {
        schedule(["activity"]);
        return;
      }
      if (
        eventName === "notification.created" ||
        eventName === "notification_created" ||
        eventName === "notification_unread_count"
      ) {
        schedule(["inbox"]);
        return;
      }
      if (eventName === "business_data_updated") {
        schedule(["stats", "activity", "qr", "bizTips", "empTips"]);
        return;
      }
      if (eventName === "verification_updated") {
        schedule(["stats"]);
      }
    };

    const onTip = (payload: RealtimeEnvelope) => handle("tip.received", payload);
    const onTipLegacy = (payload: RealtimeEnvelope) => handle("tip_received", payload);
    const onQr = (payload: RealtimeEnvelope) => handle("qr.scanned", payload);
    const onActivity = (payload: RealtimeEnvelope) => handle("activity.created", payload);
    const onNotif = (payload: RealtimeEnvelope) => handle("notification.created", payload);
    const onNotifLegacy = (payload: RealtimeEnvelope) => handle("notification_created", payload);
    const onUnread = (payload: RealtimeEnvelope) => handle("notification_unread_count", payload);
    const onBiz = (payload: RealtimeEnvelope) => handle("business_data_updated", payload);
    const onVerify = (payload: RealtimeEnvelope) => handle("verification_updated", payload);

    socket.on("tip.received", onTip);
    socket.on("tip_received", onTipLegacy);
    socket.on("qr.scanned", onQr);
    socket.on("activity.created", onActivity);
    socket.on("notification.created", onNotif);
    socket.on("notification_created", onNotifLegacy);
    socket.on("notification_unread_count", onUnread);
    socket.on("business_data_updated", onBiz);
    socket.on("verification_updated", onVerify);

    const onAppState = (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if ((prev === "background" || prev === "inactive") && next === "active") {
        schedule(["stats", "activity", "qr", "bizTips", "empTips", "inbox"]);
        void queryClient.invalidateQueries({ queryKey: queryKeys.businessQrAnalytics });
      }
    };
    const sub = AppState.addEventListener("change", onAppState);

    return () => {
      socket.off("tip.received", onTip);
      socket.off("tip_received", onTipLegacy);
      socket.off("qr.scanned", onQr);
      socket.off("activity.created", onActivity);
      socket.off("notification.created", onNotif);
      socket.off("notification_created", onNotifLegacy);
      socket.off("notification_unread_count", onUnread);
      socket.off("business_data_updated", onBiz);
      socket.off("verification_updated", onVerify);
      sub.remove();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [socket, queryClient]);

  useEffect(() => {
    if (!connected) return;
    // Catch-up after reconnect — same intent as web SOCKET_RECONNECTED_EVENT handlers.
    void queryClient.invalidateQueries({ queryKey: queryKeys.notificationUnread });
    void queryClient.invalidateQueries({ queryKey: queryKeys.businessStats });
    void queryClient.invalidateQueries({ queryKey: queryKeys.employeeTips });
    void queryClient.invalidateQueries({ queryKey: queryKeys.businessQrAnalytics });
  }, [connected, queryClient]);

  return null;
}
