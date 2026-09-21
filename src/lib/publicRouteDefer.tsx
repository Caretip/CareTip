import {
  createElement,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";

/** Default IO expansion — start preparing content before it enters the viewport. */
export const PUBLIC_DEFER_ROOT_MARGIN = "400px 0px";
/** Landing sections immediately below the hero — load before the user sees blank placeholders. */
export const LANDING_NEAR_VIEWPORT_ROOT_MARGIN = "900px 0px";
export const PUBLIC_FOOTER_ROOT_MARGIN = "480px 0px";

function parseLeadingRootMarginPx(rootMargin: string): number {
  const leading = rootMargin.trim().split(/\s+/)[0] ?? "0px";
  const match = leading.match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? Math.abs(Number(match[1])) : 0;
}

/** Best-effort sync check — avoids blank placeholders when content is already near viewport. */
export function isNearViewport(node: HTMLElement, rootMargin = PUBLIC_DEFER_ROOT_MARGIN): boolean {
  const marginPx = parseLeadingRootMarginPx(rootMargin);
  const rect = node.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  return rect.top < vh + marginPx && rect.bottom > -marginPx;
}

type DeferredBelowFoldProps = {
  children: ReactNode;
  fallback?: ReactNode;
  /** Pre-reserve space so layout does not shift when content mounts. */
  minHeight?: string;
  rootMargin?: string;
  className?: string;
  /** Mount immediately — use for first below-fold blocks and CTAs. */
  eager?: boolean;
};

/** Mount children when the placeholder nears the viewport (stays mounted once visible). */
/** @deprecated Do not wrap marketing page sections — mount layout eagerly; lazy-load assets inside sections instead. */
export function DeferredBelowFold({
  children,
  fallback = null,
  minHeight,
  rootMargin = PUBLIC_DEFER_ROOT_MARGIN,
  className,
  eager = false,
}: DeferredBelowFoldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (eager) return;

    const node = hostRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    if (isNearViewport(node, rootMargin)) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin, threshold: 0.01 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, rootMargin]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={minHeight && !visible ? { minHeight } : undefined}
    >
      {visible ? children : fallback}
    </div>
  );
}

/** Run a callback once the main thread is idle (non-blocking follow-up work). */
export function scheduleIdleWork(work: () => void, timeoutMs = 2000): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(work, { timeout: timeoutMs });
    return;
  }
  window.setTimeout(work, 1);
}

type IdleMountProps = {
  children: ReactNode;
  timeoutMs?: number;
};

/** Mount children after idle — keeps hero/headline paint unblocked. */
export function IdleMount({ children, timeoutMs = 1600 }: IdleMountProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    scheduleIdleWork(() => setReady(true), timeoutMs);
  }, [timeoutMs]);

  return ready ? children : null;
}

type ViewportDeferredProps = {
  children: ReactNode;
  rootMargin?: string;
  minHeight?: string;
  className?: string;
  eager?: boolean;
};

/** Mount when the anchor nears the viewport — one-way gate (never unmounts). */
export function ViewportDeferred({
  children,
  rootMargin = PUBLIC_FOOTER_ROOT_MARGIN,
  minHeight,
  className,
  eager = false,
}: ViewportDeferredProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (eager) return;

    const node = hostRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    if (isNearViewport(node, rootMargin)) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin, threshold: 0.01 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, rootMargin]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={minHeight && !visible ? { minHeight } : undefined}
    >
      {visible ? children : null}
    </div>
  );
}

type LazyBelowFoldProps<P extends object> = {
  load: () => Promise<{ default: ComponentType<P> }>;
  props: P;
  minHeight?: string;
  rootMargin?: string;
  className?: string;
};

/** Lazy import + viewport gate for below-the-fold sections. */
export function LazyBelowFold<P extends object>({
  load,
  props,
  minHeight,
  rootMargin,
  className,
}: LazyBelowFoldProps<P>) {
  const LazyComponent = lazy(load) as LazyExoticComponent<ComponentType<P>>;

  return (
    <DeferredBelowFold minHeight={minHeight} rootMargin={rootMargin} className={className}>
      <Suspense fallback={null}>
        {createElement(
          LazyComponent as unknown as ComponentType<P>,
          props as P & Record<string, unknown>,
        )}
      </Suspense>
    </DeferredBelowFold>
  );
}
