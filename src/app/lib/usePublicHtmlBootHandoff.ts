import { useLayoutEffect } from "react";
import { useCompleteHtmlBootAfterPublicPaint } from "../context/AppLoadingManager";
import { isAppShellInteractive } from "./appShellLifecycle";
import { isHtmlBootElementPresent } from "./htmlMarketingBootBridge";

/**
 * Fade HTML `#caretip-html-boot` after this public destination has committed.
 * If the boot node is still in the DOM, dismiss it even after the shell is interactive —
 * QR → /tip-amount used to restore the boot in an effect cleanup and leave it covering the tip page.
 */
export function usePublicHtmlBootHandoff(ready: boolean): void {
  const completeHtmlBootAfterPublicPaint = useCompleteHtmlBootAfterPublicPaint();
  const softNav = isAppShellInteractive();

  useLayoutEffect(() => {
    if (!ready) return;
    if (softNav && !isHtmlBootElementPresent()) return;
    return completeHtmlBootAfterPublicPaint();
  }, [ready, softNav, completeHtmlBootAfterPublicPaint]);
}
