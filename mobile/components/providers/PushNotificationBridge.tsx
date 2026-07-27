import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { router } from "expo-router";
import { registerPushToken } from "@/services/api/settingsService";
import { useAuth } from "@/hooks/useAuth";
import { config } from "@/constants/config";
import { setRegisteredPushToken } from "@/utils/pushTokenRegistry";
import { useUserStore } from "@/store/userStore";
import { getDashboardRouteForRole } from "@/utils/routing";

/**
 * Remote push tokens are unavailable in Expo Go since SDK 53.
 * Skip the module entirely there so Metro does not surface a fatal ERROR overlay.
 * Push registration runs only in development / production builds.
 *
 * Required before production push works:
 * 1. `eas init` → real projectId in app config
 * 2. `eas credentials` → FCM (Android) + APNs (iOS)
 * 3. EXPO_PUBLIC_EAS_PROJECT_ID or Constants.easConfig.projectId available at runtime
 * See docs/PHASE4_BETA_PACKAGING.md § Push.
 */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function resolveEasProjectId(): string | undefined {
  return (
    config.easProjectId ||
    Constants.easConfig?.projectId ||
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ||
    undefined
  );
}

function openInboxForCurrentUser(): void {
  const role = useUserStore.getState().user?.role;
  if (role === "MANAGER") {
    router.push("/(app)/business/notifications");
    return;
  }
  if (role === "EMPLOYEE") {
    router.push("/(app)/employee/notifications");
    return;
  }
  if (role) {
    router.push(getDashboardRouteForRole(role));
  }
}

export function PushNotificationBridge() {
  const { isAuthenticated } = useAuth();
  const registeredForSession = useRef(false);
  const handledColdStartTap = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || isExpoGo) return;

    let cancelled = false;
    let responseSub: { remove: () => void } | undefined;
    let receiveSub: { remove: () => void } | undefined;

    void (async () => {
      const Notifications = await import("expo-notifications");

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });

      receiveSub = Notifications.addNotificationReceivedListener(() => {
        /* Inbox refreshes on focus / pull-to-refresh. */
      });

      responseSub = Notifications.addNotificationResponseReceivedListener(() => {
        openInboxForCurrentUser();
      });

      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last && !cancelled && !handledColdStartTap.current) {
          handledColdStartTap.current = true;
          openInboxForCurrentUser();
        }
      } catch {
        /* non-fatal */
      }

      const settings = await Notifications.getPermissionsAsync();
      let status = settings.status;
      if (status !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
      }
      if (status !== "granted" || cancelled) return;

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "CareTip",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      const projectId = resolveEasProjectId();
      if (!projectId) {
        if (__DEV__) {
          console.warn(
            "[CareTip][Push] Missing EAS projectId — run `eas init` and set EXPO_PUBLIC_EAS_PROJECT_ID for standalone push.",
          );
        }
        return;
      }

      if (registeredForSession.current) return;

      try {
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (!token || cancelled) return;
        registeredForSession.current = true;
        setRegisteredPushToken(token);
        await registerPushToken(token);
      } catch {
        /* Backend / FCM may be incomplete in beta — non-fatal. */
      }
    })();

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        /* Badge clear / inbox refresh left to NotificationsScreen pull-to-refresh. */
      }
    });

    return () => {
      cancelled = true;
      receiveSub?.remove();
      responseSub?.remove();
      appStateSub.remove();
    };
  }, [isAuthenticated]);

  return null;
}
