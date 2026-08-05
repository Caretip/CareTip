import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { registerPushToken } from "@/services/api/settingsService";
import { getUserQueryKeys } from "@/services/api/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { config } from "@/constants/config";
import { setRegisteredPushToken } from "@/utils/pushTokenRegistry";
import { useUserStore } from "@/store/userStore";
import { getNotificationsRouteForRole } from "@/utils/routing";
import { clearOsNotificationBadge } from "@/utils/notificationBadge";

/**
 * Remote push tokens are unavailable in Expo Go since SDK 53.
 *
 * Post-auth landing is owned by `postAuthNavigation` — never inbox.
 * Warm push taps navigate to inbox. Cold-start taps are intentionally skipped
 * (Android stale getLastNotificationResponseAsync caused dashboard→inbox redirects).
 */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type Sub = { remove: () => void };

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
  const queryClient = useQueryClient();
  const registeredForSession = useRef(false);
  const receiveSubRef = useRef<Sub | null>(null);
  const responseSubRef = useRef<Sub | null>(null);

  useEffect(() => {
    if (!isAuthenticated || isExpoGo) {
      registeredForSession.current = false;
      void clearOsNotificationBadge();
      return;
    }

    let cancelled = false;

    const invalidateInbox = () => {
      const qk = getUserQueryKeys();
      if (!qk) return;
      void queryClient.invalidateQueries({ queryKey: qk.notifications });
      void queryClient.invalidateQueries({ queryKey: qk.notificationUnread });
    };

    void (async () => {
      const Notifications = await import("expo-notifications");
      if (cancelled) return;

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          // Prefer in-app bell when foregrounded — avoid duplicate OS banner + badge.
          shouldShowAlert: false,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: false,
          shouldShowList: true,
        }),
      });

      receiveSubRef.current?.remove();
      responseSubRef.current?.remove();

      receiveSubRef.current = Notifications.addNotificationReceivedListener(() => {
        invalidateInbox();
      });

      responseSubRef.current = Notifications.addNotificationResponseReceivedListener(() => {
        invalidateInbox();
        const role = useUserStore.getState().user?.role;
        router.push(getNotificationsRouteForRole(role));
      });

      if (cancelled) {
        receiveSubRef.current?.remove();
        responseSubRef.current?.remove();
        receiveSubRef.current = null;
        responseSubRef.current = null;
        return;
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

      if (registeredForSession.current || cancelled) return;

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
      receiveSubRef.current?.remove();
      responseSubRef.current?.remove();
      receiveSubRef.current = null;
      responseSubRef.current = null;
    };
  }, [isAuthenticated, queryClient]);

  return null;
}
