import { useRef } from "react";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
  useGlobalAppLoadingActive,
} from "./globalAppLoading";
import { isAppShellInteractive } from "./appShellLifecycle";
import { isAuthPostLoginTransitionActive } from "./authPostLoginTransition";
import { isAuthSignInHandoffActive } from "./authSignInHandoff";

/**
 * While a global CareTip overlay is already covering the screen (cold boot / refresh),
 * keep it up until critical first-paint data is ready — avoids overlay → skeleton → content.
 * Soft navigations and Sign In handoffs must never latch/extend the branded overlay.
 */
export function useExtendGlobalLoaderUntilReady(
  key: string,
  blocking: boolean,
  message?: string,
): boolean {
  const overlayVisible = useGlobalAppLoadingActive();
  const latchedRef = useRef(false);
  const softNav =
    isAppShellInteractive() ||
    isAuthPostLoginTransitionActive() ||
    isAuthSignInHandoffActive();

  if (softNav) {
    latchedRef.current = false;
  } else if (blocking && overlayVisible) {
    latchedRef.current = true;
  }
  if (!blocking) {
    latchedRef.current = false;
  }

  const hold = !softNav && blocking && (overlayVisible || latchedRef.current);
  useAppLoadingRegistration(key, APP_LOADING_PRIORITY.ROUTE_GUARD, hold, message);
  return softNav ? false : hold || overlayVisible;
}
