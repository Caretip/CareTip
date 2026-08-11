import { useCallback, useMemo } from "react";
import { IdleActivityCapture } from "@/components/idle/IdleActivityCapture";
import { IdleWarningModal } from "@/components/idle/IdleWarningModal";
import { useAuth } from "@/hooks/useAuth";
import { useAuthLogoutTransitionActive } from "@/hooks/useAuthLogoutTransition";
import { useIdleSessionGuard } from "@/hooks/useIdleSessionGuard";
import { isIdleSessionTimeoutEnabled } from "@/lib/idleSession/idleSessionConfig";

type IdleSessionBridgeProps = {
  children: React.ReactNode;
};

/**
 * Root idle session controller — no-op unless feature flag + authenticated gate.
 * Mirrors web `IdleSessionController.tsx`.
 */
export function IdleSessionBridge({ children }: IdleSessionBridgeProps) {
  const { user, status, isHydrated, signOut } = useAuth();
  const logoutTransitionActive = useAuthLogoutTransitionActive();
  const flagEnabled = isIdleSessionTimeoutEnabled();

  const active = useMemo(() => {
    if (!flagEnabled) return false;
    if (status !== "authenticated") return false;
    if (!isHydrated) return false;
    if (!user) return false;
    if (logoutTransitionActive) return false;
    return true;
  }, [flagEnabled, status, isHydrated, user, logoutTransitionActive]);

  const logout = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const { warning, staySignedIn, logOutNow } = useIdleSessionGuard(active, logout);

  if (!flagEnabled) {
    return <>{children}</>;
  }

  return (
    <IdleActivityCapture enabled={active}>
      {children}
      <IdleWarningModal
        open={warning.open}
        phase={warning.phase}
        secondsRemaining={warning.secondsRemaining}
        onStaySignedIn={staySignedIn}
        onLogOut={logOutNow}
      />
    </IdleActivityCapture>
  );
}
