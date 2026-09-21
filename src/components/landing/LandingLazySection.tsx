import {
  createElement,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import {
  isNearViewport,
  LANDING_NEAR_VIEWPORT_ROOT_MARGIN,
  PUBLIC_DEFER_ROOT_MARGIN,
} from "@/lib/publicRouteDefer";

type LandingLazySectionProps<P extends object> = {
  /** Dynamic import for a below-the-fold landing section. */
  load: () => Promise<{ default: ComponentType<P> }>;
  props?: P;
  /** Reserve vertical space before the section mounts to limit layout shift. */
  minHeight?: string;
  rootMargin?: string;
  className?: string;
  /** Mount immediately — use for product visuals that must not wait for scroll (e.g. dashboard mockup). */
  eager?: boolean;
  /** Start fetching the section chunk as soon as the landing page mounts. */
  prefetch?: boolean;
};

const lazySectionCache = new Map<
  () => Promise<{ default: ComponentType<object> }>,
  LazyExoticComponent<ComponentType<object>>
>();

function getLazySection<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyExoticComponent<ComponentType<P>> {
  const cached = lazySectionCache.get(load as () => Promise<{ default: ComponentType<object> }>);
  if (cached) return cached as LazyExoticComponent<ComponentType<P>>;

  const LazyComponent = lazy(load) as LazyExoticComponent<ComponentType<P>>;
  lazySectionCache.set(
    load as () => Promise<{ default: ComponentType<object> }>,
    LazyComponent as LazyExoticComponent<ComponentType<object>>,
  );
  return LazyComponent;
}

/** Signals when a lazy section has committed to the DOM (Suspense resolved). */
function LazySectionMountLatch({
  onMounted,
  children,
}: {
  onMounted: () => void;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    onMounted();
  }, [onMounted]);

  return children;
}

function LandingLazySectionFallback({ minHeight }: { minHeight?: string }) {
  return (
    <div
      className="caretip-landing-lazy-section-fallback"
      style={minHeight ? { minHeight } : undefined}
      aria-hidden
    />
  );
}

/**
 * Mount a landing section when it nears the viewport.
 * Combines IntersectionObserver gating with React.lazy code-splitting.
 */
export function LandingLazySection<P extends object>({
  load,
  props,
  minHeight,
  rootMargin = PUBLIC_DEFER_ROOT_MARGIN,
  className,
  eager = false,
  prefetch = true,
}: LandingLazySectionProps<P>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  const [resolved, setResolved] = useState(false);
  const LazyComponent = getLazySection(load);

  const handleMounted = useCallback(() => {
    setResolved(true);
  }, []);

  useEffect(() => {
    if (prefetch) {
      void load();
    }
  }, [load, prefetch]);

  useEffect(() => {
    if (eager) {
      setVisible(true);
      return;
    }

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

  const reserveHeight = Boolean(minHeight && !resolved);
  const heightStyle = reserveHeight ? { minHeight } : undefined;

  return (
    <div
      ref={hostRef}
      data-landing-lazy-host=""
      data-landing-lazy-resolved={resolved ? "" : undefined}
      className={className}
      style={heightStyle}
      aria-busy={visible && !resolved ? true : undefined}
    >
      {visible ? (
        <Suspense fallback={<LandingLazySectionFallback minHeight={minHeight} />}>
          <LazySectionMountLatch onMounted={handleMounted}>
            {createElement(
              LazyComponent as unknown as ComponentType<P>,
              (props ?? {}) as P & Record<string, unknown>,
            )}
          </LazySectionMountLatch>
        </Suspense>
      ) : null}
    </div>
  );
}

export { LANDING_NEAR_VIEWPORT_ROOT_MARGIN };
