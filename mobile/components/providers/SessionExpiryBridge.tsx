import { useEffect } from "react";
import { registerSessionExpiredHandler } from "@/utils/sessionExpiry";
import { sessionManager } from "@/services/auth/sessionManager";
import { isAuthLogoutTransitionActive } from "@/lib/authLogoutTransition";

export function SessionExpiryBridge() {
  useEffect(() => {
    registerSessionExpiredHandler(() => {
      if (isAuthLogoutTransitionActive()) return;
      void sessionManager.signOut();
    });
    return () => registerSessionExpiredHandler(null);
  }, []);

  return null;
}
