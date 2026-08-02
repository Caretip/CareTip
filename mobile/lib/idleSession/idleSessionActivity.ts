/**
 * Trusted activity for idle timeout — touch + keydown equivalents.
 * Mirrors web `idleSessionActivity.ts` (pointerdown / keydown / touchstart).
 * Scroll, wheel, and focus are intentionally excluded.
 */

export type IdleActivityBinding = {
  detach: () => void;
};

export type BindIdleActivityOptions = {
  onActivity: () => void;
};

let globalHandler: (() => void) | null = null;

/** Report trusted activity from TextInput keydown equivalent. */
export function notifyIdleTrustedActivity(): void {
  globalHandler?.();
}

/**
 * Register the idle activity handler. Mobile touch capture calls this via
 * `notifyIdleTrustedActivity` and GestureDetector in IdleActivityCapture.
 */
export function bindIdleActivityListeners(options: BindIdleActivityOptions): IdleActivityBinding {
  globalHandler = options.onActivity;
  return {
    detach() {
      if (globalHandler === options.onActivity) {
        globalHandler = null;
      }
    },
  };
}
