import { useLayoutEffect } from "react";
import { useLocation, useNavigation } from "react-router";
import { useSyncExternalStore } from "react";
import {
  getAuthLogoutTargetPath,
  isAuthLogoutTransitionActive,
  isLogoutHandoffDestinationReady,
  signalLogoutAuthPageReady,
  subscribeAuthLogoutTransition,
} from "../lib/authLogoutTransition";

/**
 * Release the logout branded overlay once the login form chrome is ready to paint.
 * Call only when this surface is not showing AuthBootstrapShell / invite gates.
 */
export function useSignalLogoutAuthPageReady(loginChromeReady: boolean): void {
  useLayoutEffect(() => {
    if (!loginChromeReady) return;
    signalLogoutAuthPageReady();
  }, [loginChromeReady]);
}

/**
 * Always-mounted cover: end overlay when the signed-out login route has committed.
 * Does not wait on AuthPage first-paint (employee shell teardown must not stall this).
 */
export function useSignalLogoutDestinationReady(): void {
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const active = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );
  const target = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    getAuthLogoutTargetPath,
    () => null,
  );

  useLayoutEffect(() => {
    if (!active) return;
    if (navigation.state === "loading") return;
    if (!isLogoutHandoffDestinationReady(pathname, target)) return;
    signalLogoutAuthPageReady();
  }, [active, navigation.state, pathname, target]);
}
