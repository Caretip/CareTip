/**
 * Navigation flash / redirect sequence logging (Vite DEV builds only).
 */
export type NavFlashEvent =
  | "route_entered"
  | "guard_started"
  | "guard_resolved"
  | "data_load_started"
  | "data_load_settled"
  | "redirect_scheduled"
  | "redirect_executed"
  | "final_route_rendered"
  | "error_surface_blocked";

const PREFIX = "[CareTip:nav]";
const MAX_SEQ = 80;

type NavFlashEntry = {
  t: number;
  event: NavFlashEvent;
  path: string;
  detail?: Record<string, unknown>;
};

const sequence: NavFlashEntry[] = [];

function isEnabled(): boolean {
  try {
    const dev =
      typeof import.meta !== "undefined" &&
      import.meta.env &&
      (import.meta.env as { DEV?: boolean }).DEV === true;
    // Production builds must not ship opt-in navigation debug logging.
    return dev;
  } catch {
    return false;
  }
}

export function navFlashLog(
  event: NavFlashEvent,
  detail?: Record<string, unknown> & { path?: string },
): void {
  const path =
    detail?.path ??
    (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "");
  const { path: _omit, ...rest } = detail ?? {};
  const entry: NavFlashEntry = {
    t: typeof performance !== "undefined" ? Math.round(performance.now()) : Date.now(),
    event,
    path,
    detail: Object.keys(rest).length > 0 ? rest : undefined,
  };
  sequence.push(entry);
  if (sequence.length > MAX_SEQ) sequence.shift();
  if (!isEnabled()) return;
  if (entry.detail) {
    console.log(PREFIX, event, path, entry.detail);
  } else {
    console.log(PREFIX, event, path);
  }
}

/** DevTools: `window.__caretipNavFlashSequence` */
export function getNavFlashSequence(): readonly NavFlashEntry[] {
  return sequence;
}

export function clearNavFlashSequence(): void {
  sequence.length = 0;
}

if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as { __caretipNavFlashSequence?: () => readonly NavFlashEntry[] }).__caretipNavFlashSequence =
    getNavFlashSequence;
}
