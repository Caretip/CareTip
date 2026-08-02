import { useEffect } from "react";
import { useRouter } from "expo-router";
import { registerSessionExpiredHandler } from "@/utils/sessionExpiry";
import { sessionManager } from "@/services/auth/sessionManager";
import {
  beginAuthLogoutTransition,
  endAuthLogoutTransition,
} from "@/lib/authLogoutTransition";

export function SessionExpiryBridge() {
  const router = useRouter();

  useEffect(() => {
    registerSessionExpiredHandler(() => {
      beginAuthLogoutTransition();
      void sessionManager.signOut().then(() => {
        router.replace("/(auth)/login");
      }).finally(() => {
        endAuthLogoutTransition();
      });
    });
    return () => registerSessionExpiredHandler(null);
  }, [router]);

  return null;
}
