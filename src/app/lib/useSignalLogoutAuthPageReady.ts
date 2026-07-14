import { useLayoutEffect } from "react";
import { signalLogoutAuthPageReady } from "../lib/authLogoutTransition";

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
