import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { getUserQueryKeys } from "@/services/api/queryKeys";
import {
  invalidateWorkspaceQueries,
  syncAuthUserFromServer,
} from "@/services/api/invalidateUserQueries";
import { useAuthStore } from "@/store/authStore";
import { logAuthEvent } from "@/utils/authDebug";

/**
 * Foreground session + entitlement sync.
 * After platform approval / plan changes, AuthUser and React Query caches
 * must refresh before dashboard screens render from stale state.
 */
export function AuthSessionSyncBridge() {
  const queryClient = useQueryClient();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const syncingRef = useRef(false);

  useEffect(() => {
    const syncOnForeground = async () => {
      if (syncingRef.current) return;
      const auth = useAuthStore.getState();
      if (auth.status !== "authenticated" || !auth.accessToken) return;

      syncingRef.current = true;
      try {
        const synced = await syncAuthUserFromServer();
        const qk = getUserQueryKeys();
        if (qk) {
          await invalidateWorkspaceQueries(queryClient, qk);
        }
        logAuthEvent("session.foreground.synced", { authUserSynced: synced });
      } catch (error) {
        logAuthEvent("session.foreground.sync_failed", {
          message: error instanceof Error ? error.message : "unknown",
        });
      } finally {
        syncingRef.current = false;
      }
    };

    const onAppState = (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if ((prev === "background" || prev === "inactive") && next === "active") {
        void syncOnForeground();
      }
    };

    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, [queryClient]);

  return null;
}
