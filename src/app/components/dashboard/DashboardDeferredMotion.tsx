import { useEffect, useState, type ReactNode } from "react";

/**
 * Defers mounting expensive Motion trees until after KPIs are usable.
 * Renders `fallback` (static) until `ready`, then swaps to `children`.
 */
export function useDeferDashboardMotion(ready: boolean): boolean {
  const [allowMotion, setAllowMotion] = useState(false);

  useEffect(() => {
    if (!ready) {
      setAllowMotion(false);
      return;
    }
    let cancelled = false;
    const arm = () => {
      if (!cancelled) setAllowMotion(true);
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = window.requestIdleCallback(arm, { timeout: 400 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }
    const t = globalThis.setTimeout(arm, 0);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(t);
    };
  }, [ready]);

  return allowMotion;
}

type DashboardDeferredMotionProps = {
  ready: boolean;
  fallback: ReactNode;
  children: ReactNode;
};

/** Renders static fallback until after first usable / metrics ready, then Motion children. */
export function DashboardDeferredMotion({ ready, fallback, children }: DashboardDeferredMotionProps) {
  const allow = useDeferDashboardMotion(ready);
  return <>{allow ? children : fallback}</>;
}
