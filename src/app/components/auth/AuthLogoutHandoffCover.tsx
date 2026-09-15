import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../../lib/authLogoutTransition";
import { useSignalLogoutDestinationReady } from "../../lib/useSignalLogoutAuthPageReady";
import { AuthBootstrapShell } from "./AuthBootstrapShell";

/**
 * Logout visual owner: covers the SPA swap until the signed-out login route commits.
 * React Router `lazy` does not suspend Outlet — without this cover the viewport can be empty.
 */
export function AuthLogoutHandoffCover() {
  const { t } = useTranslation();
  useSignalLogoutDestinationReady();
  const visible = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );

  if (!visible) return null;

  return (
    <div
      className="caretip-logout-handoff-cover fixed inset-0 z-[10000] overflow-hidden overscroll-none"
      data-testid="auth-logout-handoff-cover"
    >
      <AuthBootstrapShell
        className="h-full min-h-[100dvh]"
        tagline={t("common.signingOut")}
        calm
      />
    </div>
  );
}
