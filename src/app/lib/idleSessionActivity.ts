/**
 * Trusted activity listeners for idle timeout.
 * Checkpoint 2: deliberate pointer/key/touch only — scroll/move/wheel excluded.
 */

export const IDLE_TRUSTED_ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

export type IdleTrustedActivityEvent = (typeof IDLE_TRUSTED_ACTIVITY_EVENTS)[number];

export type IdleActivityBinding = {
  /** Detach all listeners. */
  detach: () => void;
};

export type BindIdleActivityOptions = {
  target?: Window | Document | HTMLElement;
  /** Called on each trusted event (caller applies throttle via store). */
  onActivity: (event: Event) => void;
};

/**
 * Attach passive listeners for trusted activity only.
 * Does **not** listen to scroll, wheel, mousemove, focus, or visibility.
 */
export function bindIdleActivityListeners(options: BindIdleActivityOptions): IdleActivityBinding {
  const target = options.target ?? (typeof window !== "undefined" ? window : null);
  if (!target) {
    return { detach: () => undefined };
  }

  const handler = (event: Event) => {
    options.onActivity(event);
  };

  for (const type of IDLE_TRUSTED_ACTIVITY_EVENTS) {
    target.addEventListener(type, handler, { passive: true });
  }

  return {
    detach() {
      for (const type of IDLE_TRUSTED_ACTIVITY_EVENTS) {
        target.removeEventListener(type, handler);
      }
    },
  };
}

/** Pure helper for tests — true only for trusted event type names. */
export function isTrustedIdleActivityEventType(type: string): boolean {
  return (IDLE_TRUSTED_ACTIVITY_EVENTS as readonly string[]).includes(type);
}
