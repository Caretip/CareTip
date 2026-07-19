/**
 * Soft-nav auth handoffs (login → app, logout → login).
 * Marks the shell interactive and drops any residual cold-boot CareTip overlay so
 * post-auth navigation never reopens the global branded loader.
 */

import { markAppShellInteractive } from "./appShellLifecycle";
import { dismissHtmlMarketingBootBridge } from "./htmlMarketingBootBridge";
import { isAuthSignInHandoffActive } from "./authSignInHandoff";

type ColdBootDismissHandler = () => void;

let coldBootDismissHandler: ColdBootDismissHandler | null = null;

/** AppLoadingManager registers here so handoffs can clear boot overlay without React context. */
export function registerAuthSoftNavColdBootDismiss(handler: ColdBootDismissHandler): () => void {
  coldBootDismissHandler = handler;
  return () => {
    if (coldBootDismissHandler === handler) {
      coldBootDismissHandler = null;
    }
  };
}

/**
 * Call at the start of intentional login/logout navigation.
 * After this, soft-nav suppression blocks branded route/boot overlay re-entry.
 */
export function prepareAuthSoftNavHandoff(): void {
  markAppShellInteractive();
  dismissHtmlMarketingBootBridge();
  coldBootDismissHandler?.();
}

/** True when AppLoadingManager must ignore a registration during Sign In → Dashboard. */
export function shouldBlockOverlayDuringSignInHandoff(_key: string): boolean {
  return isAuthSignInHandoffActive();
}
