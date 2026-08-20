import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { AuthStatus } from "../lib/authSession";
import type { User } from "./useAuth";
import {
  clearFcmClientRegistrationCache,
  hasNotificationPermissionGranted,
  isPushRegistrationRateLimited,
  isWebPushSupported,
  registerFcmDeviceToken,
  shouldDisplayUserFacingPush,
  subscribeForegroundPushMessages,
  unregisterFcmDeviceToken,
  wasPushRegistrationRateLimited,
} from "../lib/fcmPush";
import { getMyAccountSettings, getEmployeeProfile, hasClientAccessToken } from "../lib/api";
import { logClientError } from "../lib/clientLog";
import { isApiConnectivityError } from "../lib/errorMessages";

function managerWantsPush(prefs: {
  tipReceivedNotifications: boolean;
  systemAlerts: boolean;
  notifyNewLogin: boolean;
}): boolean {
  return (
    prefs.tipReceivedNotifications || prefs.systemAlerts || prefs.notifyNewLogin
  );
}

function platformAdminWantsPush(prefs: {
  systemAlerts: boolean;
  notifyNewLogin: boolean;
}): boolean {
  return prefs.systemAlerts || prefs.notifyNewLogin;
}

const INITIAL_SYNC_DELAY_MS = 2_500;
const RETRY_SYNC_DELAY_MS = 15_000;
const VISIBILITY_REFRESH_MIN_MS = 5 * 60_000;

/** App-wide guard so Strict Mode / layout remounts do not schedule duplicate syncs. */
const globalPushSync = {
  userId: null as string | null,
  running: false,
};

/**
 * Syncs FCM registration with stored notification preferences (no UI).
 * Waits until session bootstrap completes; never prompts for permission (settings only).
 */
export function useFcmPushSync(
  user: User | null,
  authStatus: AuthStatus,
  apiReady: boolean,
): void {
  const syncedRef = useRef(false);
  const lastVisibilityRefreshRef = useRef(0);
  const prefsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (authStatus !== "authenticated" || !user || !apiReady) {
      syncedRef.current = false;
      prefsAbortRef.current?.abort();
      prefsAbortRef.current = null;
      if (authStatus === "unauthenticated") {
        clearFcmClientRegistrationCache();
        globalPushSync.userId = null;
        globalPushSync.running = false;
      }
      return;
    }
    if (!hasClientAccessToken()) return;
    if (!isWebPushSupported()) return;

    const role = user.role;
    if (role !== "employee" && role !== "business" && role !== "platform_admin") return;

    const userId = user.id;
    if (syncedRef.current) return undefined;
    if (globalPushSync.running && globalPushSync.userId === userId) return undefined;

    let cancelled = false;
    const abort = new AbortController();
    prefsAbortRef.current = abort;
    globalPushSync.userId = userId;
    globalPushSync.running = true;

    const markSynced = () => {
      syncedRef.current = true;
      globalPushSync.running = false;
    };

    const run = async (): Promise<boolean> => {
      if (isPushRegistrationRateLimited()) {
        return true;
      }
      try {
        let wantsPush = false;
        if (role === "employee") {
          const profile = await getEmployeeProfile();
          if (abort.signal.aborted || cancelled) return false;
          wantsPush = profile.pushNotifications !== false;
        } else if (role === "platform_admin") {
          const settings = await getMyAccountSettings();
          if (abort.signal.aborted || cancelled) return false;
          wantsPush = platformAdminWantsPush(settings);
        } else {
          const settings = await getMyAccountSettings();
          if (abort.signal.aborted || cancelled) return false;
          wantsPush = managerWantsPush(settings);
        }

        if (!wantsPush) {
          await unregisterFcmDeviceToken();
          return true;
        }

        if (!hasNotificationPermissionGranted()) {
          return true;
        }

        const ok = await registerFcmDeviceToken({ requestPermission: false, dedupe: true });
        if (wasPushRegistrationRateLimited()) return true;
        return ok;
      } catch (err) {
        if (!isApiConnectivityError(err)) {
          logClientError("useFcmPushSync", err);
        }
        return false;
      }
    };

    const schedule = async () => {
      await new Promise((r) => window.setTimeout(r, INITIAL_SYNC_DELAY_MS));
      if (cancelled || abort.signal.aborted || syncedRef.current) {
        globalPushSync.running = false;
        return;
      }
      const ok = await run();
      if (cancelled || abort.signal.aborted) {
        globalPushSync.running = false;
        return;
      }
      if (ok) {
        markSynced();
        return;
      }
      if (isPushRegistrationRateLimited()) {
        markSynced();
        return;
      }
      await new Promise((r) => window.setTimeout(r, RETRY_SYNC_DELAY_MS));
      if (cancelled || abort.signal.aborted || syncedRef.current) {
        globalPushSync.running = false;
        return;
      }
      if (isPushRegistrationRateLimited()) {
        markSynced();
        return;
      }
      const retryOk = await run();
      if (!cancelled && !abort.signal.aborted && (retryOk || wasPushRegistrationRateLimited())) {
        markSynced();
      } else {
        globalPushSync.running = false;
      }
    };

    void schedule();

    return () => {
      cancelled = true;
      abort.abort();
      if (globalPushSync.userId === userId) {
        globalPushSync.running = false;
      }
    };
  }, [authStatus, apiReady, user?.id, user?.role]);

  useEffect(() => {
    if (authStatus !== "authenticated") return undefined;
    return subscribeForegroundPushMessages((title, body, data) => {
      if (!shouldDisplayUserFacingPush(data)) return;
      const notificationId = data?.notificationId?.trim();
      // Same Sonner id as NotificationInboxSync — socket + FCM = one toast
      const toastId = notificationId ? `inbox-${notificationId}` : undefined;
      toast(title, { description: body || undefined, id: toastId });
    });
  }, [authStatus]);

  /** Re-register FCM token when returning to the tab (throttled; permission already granted). */
  useEffect(() => {
    if (authStatus !== "authenticated" || !user || !apiReady) return undefined;
    if (!hasClientAccessToken()) return undefined;
    if (!isWebPushSupported() || !hasNotificationPermissionGranted()) return undefined;
    if (
      user.role !== "employee" &&
      user.role !== "business" &&
      user.role !== "platform_admin"
    ) {
      return undefined;
    }

    const refreshToken = () => {
      if (document.visibilityState !== "visible") return;
      if (isPushRegistrationRateLimited()) return;
      const now = Date.now();
      if (now - lastVisibilityRefreshRef.current < VISIBILITY_REFRESH_MIN_MS) return;
      lastVisibilityRefreshRef.current = now;
      void registerFcmDeviceToken({ requestPermission: false, dedupe: true }).then((ok) => {
        if (ok || wasPushRegistrationRateLimited()) syncedRef.current = true;
      });
    };

    document.addEventListener("visibilitychange", refreshToken);
    return () => document.removeEventListener("visibilitychange", refreshToken);
  }, [authStatus, apiReady, user?.id, user?.role]);
}
