/**
 * Mobile redirect stall detection when the user remains on CareTip after starting
 * Facebook OAuth. Does not retry OAuth or change the start request.
 */

import { FACEBOOK_START_CSP_WINDOW_MS } from "@/app/lib/facebookOAuthRedirectWeb";

/** Grace after form submit before treating a visible page as stalled (aligns with CSP window). */
export const FACEBOOK_OAUTH_REDIRECT_GRACE_MS = FACEBOOK_START_CSP_WINDOW_MS;

/** Additional wait while still visible and never navigated away. */
export const FACEBOOK_OAUTH_STALL_AFTER_GRACE_MS = 18_000;

export const FACEBOOK_OAUTH_RECOVERY_DELAY_MS =
  FACEBOOK_OAUTH_REDIRECT_GRACE_MS + FACEBOOK_OAUTH_STALL_AFTER_GRACE_MS;

type RecoveryListener = (event?: { persisted?: boolean }) => void;

type RecoveryEnv = {
  document: {
    visibilityState: string;
    addEventListener: (type: string, listener: RecoveryListener) => void;
    removeEventListener: (type: string, listener: RecoveryListener) => void;
  };
  window: {
    addEventListener: (type: string, listener: RecoveryListener) => void;
    removeEventListener: (type: string, listener: RecoveryListener) => void;
  };
  setTimeout: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};

export type FacebookOAuthRecoveryWatch = {
  dispose: () => void;
  /** Call after redirect form submit so stall timer does not fire during normal navigation startup. */
  armStallTimer: () => void;
};

/** Phone and tablet browsers. Desktop Chrome/Safari/Firefox stay on the existing flow. */
export function isFacebookOAuthRecoveryClient(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod/i.test(userAgent);
}

function defaultEnv(): RecoveryEnv {
  return {
    document,
    window,
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
}

/**
 * Arms a single wait for one redirect attempt.
 * Navigation away (hidden / pagehide) cancels the stall notice — user is progressing.
 */
export function watchFacebookOAuthRedirectRecovery(options: {
  isRecoveryClient: boolean;
  delayMs?: number;
  onStall: () => void;
  onNavigateAway: () => void;
  env?: RecoveryEnv;
}): FacebookOAuthRecoveryWatch {
  if (!options.isRecoveryClient) {
    return { dispose() {}, armStallTimer() {} };
  }

  const env = options.env ?? defaultEnv();
  let disposed = false;
  let navigatedAway = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerArmed = false;

  const clearTimer = () => {
    if (timer === undefined) return;
    env.clearTimeout(timer);
    timer = undefined;
  };

  const leave = () => {
    if (disposed) return;
    navigatedAway = true;
    clearTimer();
    options.onNavigateAway();
  };

  const onVisibility: RecoveryListener = () => {
    if (disposed) return;
    if (env.document.visibilityState === "hidden") {
      leave();
    }
  };

  const onPageHide: RecoveryListener = () => {
    leave();
  };

  const onPageShow: RecoveryListener = (event) => {
    if (!event?.persisted) return;
    leave();
  };

  env.document.addEventListener("visibilitychange", onVisibility);
  env.window.addEventListener("pagehide", onPageHide);
  env.window.addEventListener("pageshow", onPageShow);

  const armStallTimer = () => {
    if (disposed || navigatedAway || timerArmed) return;
    timerArmed = true;
    timer = env.setTimeout(() => {
      if (disposed || navigatedAway) return;
      timer = env.setTimeout(() => {
        timer = undefined;
        if (disposed || navigatedAway) return;
        if (env.document.visibilityState === "hidden") {
          leave();
          return;
        }
        options.onStall();
      }, options.delayMs ?? FACEBOOK_OAUTH_STALL_AFTER_GRACE_MS);
    }, FACEBOOK_OAUTH_REDIRECT_GRACE_MS);
  };

  return {
    armStallTimer,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      env.document.removeEventListener("visibilitychange", onVisibility);
      env.window.removeEventListener("pagehide", onPageHide);
      env.window.removeEventListener("pageshow", onPageShow);
    },
  };
}

/** Focus the email field on the screen the user is actually looking at. */
export function focusCurrentAuthEmailField(
  doc: Pick<Document, "getElementById" | "querySelectorAll"> = document,
): void {
  const nodes = [
    doc.getElementById("mw-auth-email"),
    ...Array.from(doc.querySelectorAll('input[name="email"]')),
    doc.getElementById("auth-email"),
  ];
  const fields = nodes.filter((node): node is HTMLElement => node instanceof HTMLElement);
  const visible = fields.find((field) => {
    const style = getComputedStyle(field);
    return style.display !== "none" && style.visibility !== "hidden" && field.getClientRects().length > 0;
  });
  (visible ?? fields[0])?.focus();
}
