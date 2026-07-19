import { useEffect, useSyncExternalStore } from "react";
import {
  isAuthSignInHandoffCoverVisible,
  subscribeAuthSignInHandoff,
} from "../../lib/authSignInHandoff";
import { AuthBootstrapShell } from "./AuthBootstrapShell";
import { markPostLoginTrace } from "../../lib/postLoginRuntimeTrace";

/**
 * Post–Sign In cover while AuthPage unmounts and the destination mounts.
 *
 * Why this file exists: handoff visibility is owned by `authSignInHandoff` (navigate
 * timing). The *visual* must be the shared CareTip branded loader — not a one-off
 * "Signing you in…" form. We reuse {@link AuthBootstrapShell} (CareTipBrandedLoaderMark)
 * so auth transitions match cold-start / bootstrap branding.
 */
export function SignInHandoffCover() {
  const visible = useSyncExternalStore(
    subscribeAuthSignInHandoff,
    isAuthSignInHandoffCoverVisible,
    () => false,
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

  return (
    <div className="fixed inset-0 z-[10000]" data-testid="sign-in-handoff-cover">
      <AuthBootstrapShell className="h-full min-h-[100dvh]" />
    </div>
  );
}
