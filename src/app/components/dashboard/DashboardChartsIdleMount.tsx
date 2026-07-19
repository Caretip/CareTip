import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { markDashboardChartMounted } from "@/app/lib/dashboardRuntimeProfiler";
import { isDashboardChartSlotNearViewport } from "@/app/lib/dashboardAnalyticsLifecycle";
import { scheduleIdleWork } from "@/lib/publicRouteDefer";

type DashboardChartsIdleMountProps = {
  children: ReactNode;
  fallback: ReactNode;
  /** Delay before chart chunk import — KPI/goals/top performers stay on the critical path. */
  timeoutMs?: number;
  /** When true, also wait until the slot is near the viewport (Sprint 8.1). */
  whenVisible?: boolean;
  rootMargin?: string;
  /** Fires once when idle + visibility gates pass — use to start deferred data fetches. */
  onReady?: () => void;
  /**
   * Bumps when chart data becomes ready — re-checks viewport so charts mount after async fetch
   * even if the observer attached before layout settled.
   */
  mountSignal?: number | string;
  /** Safety net: mount charts even if IntersectionObserver never fires (default 2.5s). */
  maxWaitMs?: number;
};

/** Mount chart children after idle so Recharts is not on the dashboard shell parse path. */
export function DashboardChartsIdleMount({
  children,
  fallback,
  timeoutMs = 120,
  whenVisible = false,
  rootMargin = "120px",
  onReady,
  mountSignal,
  maxWaitMs = 2500,
}: DashboardChartsIdleMountProps) {
  const [idleReady, setIdleReady] = useState(!whenVisible);
  const [visible, setVisible] = useState(!whenVisible);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const markVisible = useCallback(() => {
    setVisible(true);
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  useEffect(() => {
    if (whenVisible) {
      setIdleReady(true);
      return;
    }
    scheduleIdleWork(() => setIdleReady(true), timeoutMs);
  }, [timeoutMs, whenVisible]);

  const bindSlotRef = useCallback(
    (node: HTMLDivElement | null) => {
      slotRef.current = node;
      observerRef.current?.disconnect();
      observerRef.current = null;

      if (!whenVisible || !node) return;

      if (isDashboardChartSlotNearViewport(node, rootMargin)) {
        markVisible();
        return;
      }

      if (typeof IntersectionObserver === "undefined") {
        markVisible();
        return;
      }

      const obs = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            markVisible();
          }
        },
        { rootMargin },
      );
      observerRef.current = obs;
      obs.observe(node);
    },
    [markVisible, rootMargin, whenVisible],
  );

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!whenVisible || visible) return;
    if (isDashboardChartSlotNearViewport(slotRef.current, rootMargin)) {
      markVisible();
    }
  }, [markVisible, mountSignal, rootMargin, visible, whenVisible]);

  useEffect(() => {
    if (!whenVisible || visible || maxWaitMs <= 0) return;
    const timer = window.setTimeout(() => markVisible(), maxWaitMs);
    return () => window.clearTimeout(timer);
  }, [markVisible, maxWaitMs, visible, whenVisible]);

  const ready = idleReady && visible;
  const onReadyFiredRef = useRef(false);

  useEffect(() => {
    if (!ready || !onReady || onReadyFiredRef.current) return;
    onReadyFiredRef.current = true;
    onReady();
  }, [ready, onReady]);

  useEffect(() => {
    if (!ready) return;
    markDashboardChartMounted({ whenVisible, timeoutMs });
  }, [ready, whenVisible, timeoutMs]);

  if (!ready) {
    return (
      <div
        ref={bindSlotRef}
        className="caretip-chart-slot-hold min-h-[14rem] w-full"
        aria-hidden={whenVisible ? true : undefined}
      >
        {fallback}
      </div>
    );
  }

  return (
    <div ref={bindSlotRef} className="caretip-chart-slot-hold min-h-[14rem] w-full">
      <Suspense fallback={fallback}>{children}</Suspense>
    </div>
  );
}
