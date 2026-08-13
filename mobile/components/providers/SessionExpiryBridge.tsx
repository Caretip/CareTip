import { useEffect } from "react";
import { registerSessionExpiredHandler } from "@/utils/sessionExpiry";
import { sessionManager } from "@/services/auth/sessionManager";
import { isAuthLogoutTransitionActive } from "@/lib/authLogoutTransition";
import { useI18n } from "@/hooks/useI18n";
import { showErrorToast } from "@/store/toastStore";

export function SessionExpiryBridge() {
  const { t } = useI18n();

  useEffect(() => {
    registerSessionExpiredHandler(() => {
      if (isAuthLogoutTransitionActive()) return;
      showErrorToast(t("errors.unauthorized"));
      void sessionManager.signOut();
    });
    return () => registerSessionExpiredHandler(null);
  }, [t]);

  return null;
}
