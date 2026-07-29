import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { router } from "expo-router";
import { registerPushToken } from "@/services/api/settingsService";
import { useAuth } from "@/hooks/useAuth";
import { config } from "@/constants/config";
import { setRegisteredPushToken } from "@/utils/pushTokenRegistry";
import { useUserStore } from "@/store/userStore";
import { getNotificationsRouteForRole } from "@/utils/routing";

/**
 * Remote push tokens are unavailable in Expo Go since SDK 53.
 * Skip the module entirely there so Metro does not surface a fatal ERROR overlay.
 * Push registration runs only in development / production builds.
 *
 * Post-auth landing is owned by `postAuthNavigation` / `getPostAuthHref` — never inbox.
 * Inbox navigation happens only when the user explicitly taps a notification while the app
 * is running (response listener). We do not call getLastNotificationResponseAsync after
 * login or session restore — Android persists stale responses and caused dashboard → inbox redirects.
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

export function PushNotificationBridge() {
  const { isAuthenticated } = useAuth();
  const registeredForSession = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || isExpoGo) {
      registeredForSession.current = false;
      return;
    }

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
        const role = useUserStore.getState().user?.role;
        const inboxRoute = getNotificationsRouteForRole(role);
        router.push(inboxRoute);
      });

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

    return () => {
      cancelled = true;
      registeredForSession.current = false;
      receiveSub?.remove();
      responseSub?.remove();
    };
  }, [isAuthenticated]);

  return null;
}
