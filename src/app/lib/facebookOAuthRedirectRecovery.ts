/**
 * Mobile-only notice when a Facebook redirect start is still on the CareTip
 * login/signup page. Does not retry OAuth or change the start request.
 */

export const FACEBOOK_OAUTH_RECOVERY_DELAY_MS = 7_000;

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
 * A hidden page or pagehide cancels the notice so a later return cannot show a stale message.
 */
export function watchFacebookOAuthRedirectRecovery(options: {
  isRecoveryClient: boolean;
  delayMs?: number;
  onRecover: () => void;
  onLeave: () => void;
  env?: RecoveryEnv;
}): FacebookOAuthRecoveryWatch {
  if (!options.isRecoveryClient) {
    return { dispose() {} };
  }

  const env = options.env ?? defaultEnv();
  let disposed = false;
  let left = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    env.clearTimeout(timer);
    timer = undefined;
  };

  const leave = () => {
    if (disposed) return;
    left = true;
    clearTimer();
    options.onLeave();
  };

  const onVisibility: RecoveryListener = () => {
    if (disposed) return;
    if (env.document.visibilityState === "hidden") {
      leave();
      return;
    }
    if (left && env.document.visibilityState === "visible") {
      options.onLeave();
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

  timer = env.setTimeout(() => {
    timer = undefined;
    if (disposed || left) return;
    if (env.document.visibilityState === "hidden") {
      leave();
      return;
    }
    options.onRecover();
  }, options.delayMs ?? FACEBOOK_OAUTH_RECOVERY_DELAY_MS);

  return {
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
export function focusCurrentAuthEmailField(doc: Pick<Document, "getElementById" | "querySelectorAll"> = document): void {
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
