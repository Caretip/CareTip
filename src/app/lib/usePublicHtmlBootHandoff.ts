import { useLayoutEffect } from "react";
import { useCompleteHtmlBootAfterPublicPaint } from "../context/AppLoadingManager";
import { isAppShellInteractive } from "./appShellLifecycle";

/**
 * Fade HTML `#caretip-html-boot` only after this public destination has committed.
 * Used by customer journey shells so QR → /tip-amount is one boot, not two.
 */
export function usePublicHtmlBootHandoff(ready: boolean): void {
  const completeHtmlBootAfterPublicPaint = useCompleteHtmlBootAfterPublicPaint();
  const softNav = isAppShellInteractive();

  useLayoutEffect(() => {
    if (!ready || softNav) return;
    return completeHtmlBootAfterPublicPaint();
  }, [ready, softNav, completeHtmlBootAfterPublicPaint]);
}
