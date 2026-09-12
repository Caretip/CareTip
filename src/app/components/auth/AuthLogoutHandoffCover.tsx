import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../../lib/authLogoutTransition";
import { AuthBootstrapShell } from "./AuthBootstrapShell";

/**
 * Logout visual owner: authenticated tree may unmount before login chrome commits.
 * React Router `lazy` does not suspend Outlet — without this cover the viewport is empty.
 */
export function AuthLogoutHandoffCover() {
  const { t } = useTranslation();
  const visible = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[10000]" data-testid="auth-logout-handoff-cover">
      <AuthBootstrapShell className="h-full min-h-[100dvh]" tagline={t("common.signingOut")} />
    </div>
  );
}
