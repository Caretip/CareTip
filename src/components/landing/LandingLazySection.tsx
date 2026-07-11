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
import { isNearViewport, PUBLIC_DEFER_ROOT_MARGIN } from "@/lib/publicRouteDefer";

type LandingLazySectionProps<P extends object> = {
  /** Dynamic import for a below-the-fold landing section. */
  load: () => Promise<{ default: ComponentType<P> }>;
  props?: P;
  /** Reserve vertical space before the section mounts to limit layout shift. */
  minHeight?: string;
  rootMargin?: string;
  className?: string;
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

/**
 * Mount a landing section only when it nears the viewport.
 * Combines IntersectionObserver gating with React.lazy code-splitting.
 */
export function LandingLazySection<P extends object>({
  load,
  props,
  minHeight,
  rootMargin = PUBLIC_DEFER_ROOT_MARGIN,
  className,
}: LandingLazySectionProps<P>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [resolved, setResolved] = useState(false);
  const LazyComponent = getLazySection(load);

  const handleMounted = useCallback(() => {
    setResolved(true);
  }, []);

  useEffect(() => {
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
  }, [rootMargin]);

  const reserveHeight = Boolean(minHeight && !resolved);
  const heightStyle = reserveHeight ? { minHeight } : undefined;

  return (
    <div
      ref={hostRef}
      data-landing-lazy-host=""
      className={className}
      style={heightStyle}
      aria-hidden={!visible || !resolved ? true : undefined}
    >
      {visible ? (
        <Suspense fallback={null}>
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
