import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { getUserQueryKeys } from "@/services/api/queryKeys";
import { syncAuthUserFromServer } from "@/services/api/invalidateUserQueries";
import { useAuthStore } from "@/store/authStore";
import { logAuthEvent } from "@/utils/authDebug";

/** Minimum gap between foreground sync bursts (avoids resume stampede). */
const FOREGROUND_SYNC_COOLDOWN_MS = 60_000;

/**
 * Foreground session + entitlement sync.
 * After platform approval / plan changes, AuthUser and a small set of entitlement
 * caches refresh — not the entire workspace query tree.
 */
export function AuthSessionSyncBridge() {
  const queryClient = useQueryClient();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const syncingRef = useRef(false);
  const lastSyncAtRef = useRef(0);

  useEffect(() => {
    const syncOnForeground = async () => {
      if (syncingRef.current) return;
      const auth = useAuthStore.getState();
      if (auth.status !== "authenticated" || !auth.accessToken) return;

      const now = Date.now();
      if (now - lastSyncAtRef.current < FOREGROUND_SYNC_COOLDOWN_MS) {
        logAuthEvent("session.foreground.skipped_cooldown", {
          remainingMs: FOREGROUND_SYNC_COOLDOWN_MS - (now - lastSyncAtRef.current),
        });
        return;
      }

      syncingRef.current = true;
      lastSyncAtRef.current = now;
      try {
        const synced = await syncAuthUserFromServer();
        const qk = getUserQueryKeys();
        if (qk) {
          // Entitlement-sensitive keys only — dashboards refetch via staleTime / pull-to-refresh.
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: qk.businessProfile }),
            queryClient.invalidateQueries({ queryKey: qk.accountSettings }),
            queryClient.invalidateQueries({ queryKey: qk.notificationUnread }),
          ]);
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
