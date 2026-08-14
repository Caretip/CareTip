import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  getAuthSignInHandoffTargetPath,
  isAuthSignInHandoffCoverVisible,
  subscribeAuthSignInHandoff,
} from "../../lib/authSignInHandoff";
import { AuthBootstrapShell } from "./AuthBootstrapShell";
import { markPostLoginTrace } from "../../lib/postLoginRuntimeTrace";

/**
 * Post–Sign In cover while AuthPage unmounts and the destination mounts.
 * One branded sentence only — onboarding uses workspace-setup copy.
 */
export function SignInHandoffCover() {
  const { t } = useTranslation();
  const visible = useSyncExternalStore(
    subscribeAuthSignInHandoff,
    isAuthSignInHandoffCoverVisible,
    () => false,
  );
  const targetPath = useSyncExternalStore(
    subscribeAuthSignInHandoff,
    getAuthSignInHandoffTargetPath,
    () => null,
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    markPostLoginTrace(visible ? "CareTip_loader_shown" : "CareTip_loader_dismissed", {
      coverVisible: visible,
      hasSidebarDom: Boolean(document.querySelector(".caretip-dashboard-shell, [data-sidebar], aside")),
      hasHeaderDom: Boolean(document.querySelector("header, [data-dashboard-header]")),
      pathname: window.location.pathname,
    });
  }, [visible]);

  if (!visible) return null;

  const onboarding =
    (targetPath ?? window.location.pathname).split("?")[0]?.startsWith("/onboarding") === true;
  const tagline = onboarding ? t("common.creatingWorkspace") : t("common.gettingReady");

  return (
    <div className="fixed inset-0 z-[10000]" data-testid="sign-in-handoff-cover">
      <AuthBootstrapShell className="h-full min-h-[100dvh]" tagline={tagline} />
    </div>
  );
}
