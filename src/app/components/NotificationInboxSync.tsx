import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fetchMyUnreadNotificationCount } from "../lib/api";
import { isProtectedApiReady } from "../lib/authRestore";
import { isApiConnectivityError } from "../lib/errorMessages";
import { logClientError } from "../lib/clientLog";
import { localizeInboxNotification } from "../lib/localizeInboxNotification";
import {
  attachNotificationInboxSocket,
  requestNotificationInboxSync,
  subscribeNotificationInboxPatches,
} from "../lib/realtime/notificationInboxRealtime";
import { trackNotificationRefetch } from "../lib/realtime/realtimeMetrics";
import { useAuth } from "../hooks/useAuth";
import { useDeferSocketConnect, useSocketInstance, useSocketStatus } from "../hooks/useSocket";
import { useRealtimeFallback } from "../hooks/useRealtimeFallback";
import { useDashboardTabRefocus } from "../hooks/useDashboardTabRefocus";
import { useSocketCatchUp } from "../lib/realtime/useRealtimeReconnect";

const NOTIFICATION_ROLES = new Set(["employee", "business", "platform_admin"]);

/**
 * Headless singleton for inbox notification realtime:
 * one socket listener, reconnect/tab catch-up, and foreground toasts.
 * Isolated from layout — socket status updates do not re-render shell chrome.
 */
export function NotificationInboxSync() {
  const { t, i18n } = useTranslation();
  const { user, authStatus, authReady } = useAuth();
  const role = user?.role;
  const enabled =
    authReady &&
    authStatus === "authenticated" &&
    Boolean(user) &&
    Boolean(role && NOTIFICATION_ROLES.has(role)) &&
    isProtectedApiReady();

  const socketReady = useDeferSocketConnect(enabled);
  const { socket } = useSocketInstance(socketReady);
  const { connected } = useSocketStatus();

  const catchUp = useCallback(async () => {
    if (!enabled) return;
    try {
      trackNotificationRefetch();
      const { unreadCount } = await fetchMyUnreadNotificationCount();
      requestNotificationInboxSync(unreadCount);
    } catch (err) {
      if (!isApiConnectivityError(err)) {
        logClientError("NotificationInboxSync.catchUp", err);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!socket || !enabled) return;
    return attachNotificationInboxSocket(socket);
  }, [socket, enabled]);

  useSocketCatchUp(() => {
    void catchUp();
  }, enabled);

  useDashboardTabRefocus(() => {
    void catchUp();
  }, enabled);

  useRealtimeFallback(connected, catchUp, 30_000);

  useEffect(() => {
    if (!enabled) return;
    return subscribeNotificationInboxPatches((patch) => {
      if (patch.type !== "created") return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const localized = localizeInboxNotification(patch.notification, t, i18n.language);
      if (localized.type === "tip_received") {
        toast.success(localized.message, { id: `inbox-${localized.id}` });
        return;
      }
      toast(localized.title, {
        id: `inbox-${localized.id}`,
        description: localized.message,
      });
    });
  }, [enabled, t, i18n.language]);

  return null;
}
