import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "@/components/providers/SocketProvider";
import { getUserQueryKeys } from "@/services/api/queryKeys";
import { syncAuthUserFromServer } from "@/services/api/invalidateUserQueries";
import { REALTIME_EVENTS } from "@/lib/realtime/realtimeContracts";
import { clearBrandedQrImageCaches } from "@/utils/brandedQrImageCache";

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
 * - Targeted invalidation per event family (current user scope only)
 * - AuthUser refresh on verification / billing (nav + entitlements)
 * App resume sync is owned by AuthSessionSyncBridge (avoids duplicate stampedes).
 */
export function RealtimeQueryBridge() {
  const { socket, connected } = useSocket();
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Set<string>>(new Set());
  const seenIdsRef = useRef<Map<string, number>>(new Map());

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
      const qk = getUserQueryKeys();
      if (!qk) return;

      if (keys.has("stats")) void queryClient.invalidateQueries({ queryKey: qk.businessStats });
      if (keys.has("profile"))
        void queryClient.invalidateQueries({ queryKey: qk.businessProfile });
      if (keys.has("activity"))
        void queryClient.invalidateQueries({ queryKey: qk.businessActivity });
      if (keys.has("qr")) {
        void queryClient.invalidateQueries({ queryKey: qk.businessQr });
        void queryClient.invalidateQueries({ queryKey: qk.businessQrAnalytics });
        void queryClient.invalidateQueries({ queryKey: [...qk.root, "brandedQr"] });
      }
      if (keys.has("feedback"))
        void queryClient.invalidateQueries({ queryKey: qk.businessFeedback });
      if (keys.has("employees")) {
        void queryClient.invalidateQueries({
          queryKey: [...qk.root, "business", "employees"],
        });
        void queryClient.invalidateQueries({ queryKey: qk.employeeMe });
      }
      if (keys.has("bizTips"))
        void queryClient.invalidateQueries({ queryKey: qk.businessTips });
      if (keys.has("empTips")) {
        void queryClient.invalidateQueries({ queryKey: qk.employeeTips });
        void queryClient.invalidateQueries({ queryKey: qk.employeeTipList });
      }
      if (keys.has("inbox")) {
        void queryClient.invalidateQueries({ queryKey: qk.notifications });
        void queryClient.invalidateQueries({ queryKey: qk.notificationUnread });
      }
      if (keys.has("settings")) {
        void queryClient.invalidateQueries({ queryKey: qk.accountSettings });
      }
      if (keys.has("authUser")) {
        void syncAuthUserFromServer();
      }
      if (keys.has("brandingDisk")) {
        void clearBrandedQrImageCaches().catch(() => undefined);
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

      if (eventName === REALTIME_EVENTS.TIP_RECEIVED || eventName === "tip_received") {
        schedule(["stats", "activity", "bizTips", "empTips", "inbox"]);
        return;
      }
      if (eventName === REALTIME_EVENTS.QR_SCANNED) {
        schedule(["qr", "activity"]);
        return;
      }
      if (eventName === REALTIME_EVENTS.ACTIVITY_CREATED) {
        schedule(["activity"]);
        return;
      }
      if (
        eventName === REALTIME_EVENTS.NOTIFICATION_CREATED ||
        eventName === "notification_created" ||
        eventName === "notification_unread_count"
      ) {
        schedule(["inbox"]);
        return;
      }
      if (eventName === REALTIME_EVENTS.BUSINESS_DATA_UPDATED) {
        schedule([
          "stats",
          "profile",
          "activity",
          "qr",
          "feedback",
          "employees",
          "bizTips",
          "empTips",
          "brandingDisk",
        ]);
        return;
      }
      if (eventName === REALTIME_EVENTS.VERIFICATION_UPDATED) {
        // Admin approval changes AuthUser-adjacent verification flags + profile.
        schedule(["stats", "profile", "qr", "authUser"]);
        return;
      }
      if (eventName === REALTIME_EVENTS.BILLING_UPDATED) {
        // Plan/entitlement changes — refresh AuthUser + entitlement-bearing queries.
        schedule(["profile", "stats", "feedback", "qr", "settings", "authUser"]);
        return;
      }
      if (eventName === REALTIME_EVENTS.GOAL_UPDATED) {
        schedule(["stats", "empTips", "employees"]);
        return;
      }
      if (eventName === REALTIME_EVENTS.EMPLOYEE_UPDATED) {
        schedule(["employees", "stats", "qr", "empTips"]);
      }
    };

    const onTip = (payload: RealtimeEnvelope) => handle(REALTIME_EVENTS.TIP_RECEIVED, payload);
    const onTipLegacy = (payload: RealtimeEnvelope) => handle("tip_received", payload);
    const onQr = (payload: RealtimeEnvelope) => handle(REALTIME_EVENTS.QR_SCANNED, payload);
    const onActivity = (payload: RealtimeEnvelope) =>
      handle(REALTIME_EVENTS.ACTIVITY_CREATED, payload);
    const onNotif = (payload: RealtimeEnvelope) =>
      handle(REALTIME_EVENTS.NOTIFICATION_CREATED, payload);
    const onNotifLegacy = (payload: RealtimeEnvelope) => handle("notification_created", payload);
    const onUnread = (payload: RealtimeEnvelope) => handle("notification_unread_count", payload);
    const onBiz = (payload: RealtimeEnvelope) =>
      handle(REALTIME_EVENTS.BUSINESS_DATA_UPDATED, payload);
    const onVerify = (payload: RealtimeEnvelope) =>
      handle(REALTIME_EVENTS.VERIFICATION_UPDATED, payload);
    const onBilling = (payload: RealtimeEnvelope) => handle(REALTIME_EVENTS.BILLING_UPDATED, payload);
    const onGoal = (payload: RealtimeEnvelope) => handle(REALTIME_EVENTS.GOAL_UPDATED, payload);
    const onEmployee = (payload: RealtimeEnvelope) =>
      handle(REALTIME_EVENTS.EMPLOYEE_UPDATED, payload);

    socket.on(REALTIME_EVENTS.TIP_RECEIVED, onTip);
    socket.on("tip_received", onTipLegacy);
    socket.on(REALTIME_EVENTS.QR_SCANNED, onQr);
    socket.on(REALTIME_EVENTS.ACTIVITY_CREATED, onActivity);
    socket.on(REALTIME_EVENTS.NOTIFICATION_CREATED, onNotif);
    socket.on("notification_created", onNotifLegacy);
    socket.on("notification_unread_count", onUnread);
    socket.on(REALTIME_EVENTS.BUSINESS_DATA_UPDATED, onBiz);
    socket.on(REALTIME_EVENTS.VERIFICATION_UPDATED, onVerify);
    socket.on(REALTIME_EVENTS.BILLING_UPDATED, onBilling);
    socket.on(REALTIME_EVENTS.GOAL_UPDATED, onGoal);
    socket.on(REALTIME_EVENTS.EMPLOYEE_UPDATED, onEmployee);

    // App resume workspace sync is owned by AuthSessionSyncBridge (AuthUser + full invalidate).
    // Keep only socket event handling here to avoid duplicate resume stampedes.

    return () => {
      socket.off(REALTIME_EVENTS.TIP_RECEIVED, onTip);
      socket.off("tip_received", onTipLegacy);
      socket.off(REALTIME_EVENTS.QR_SCANNED, onQr);
      socket.off(REALTIME_EVENTS.ACTIVITY_CREATED, onActivity);
      socket.off(REALTIME_EVENTS.NOTIFICATION_CREATED, onNotif);
      socket.off("notification_created", onNotifLegacy);
      socket.off("notification_unread_count", onUnread);
      socket.off(REALTIME_EVENTS.BUSINESS_DATA_UPDATED, onBiz);
      socket.off(REALTIME_EVENTS.VERIFICATION_UPDATED, onVerify);
      socket.off(REALTIME_EVENTS.BILLING_UPDATED, onBilling);
      socket.off(REALTIME_EVENTS.GOAL_UPDATED, onGoal);
      socket.off(REALTIME_EVENTS.EMPLOYEE_UPDATED, onEmployee);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [socket, queryClient]);

  useEffect(() => {
    if (!connected) return;
    const qk = getUserQueryKeys();
    if (!qk) return;
    // Catch-up after reconnect — broader than before so approval/plan aren't missed.
    void queryClient.invalidateQueries({ queryKey: qk.notificationUnread });
    void queryClient.invalidateQueries({ queryKey: qk.businessProfile });
    void queryClient.invalidateQueries({ queryKey: qk.businessStats });
    void queryClient.invalidateQueries({ queryKey: qk.employeeTips });
    void queryClient.invalidateQueries({ queryKey: qk.businessQr });
    void queryClient.invalidateQueries({ queryKey: qk.businessQrAnalytics });
    void syncAuthUserFromServer();
  }, [connected, queryClient]);

  return null;
}
