import {
  createElement,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type LazyExoticComponent,
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
  const LazyComponent = getLazySection(load);

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

  return (
    <div
      ref={hostRef}
      className={className}
      style={minHeight && !visible ? { minHeight } : undefined}
      aria-hidden={!visible ? true : undefined}
    >
      {visible ? (
        <Suspense fallback={null}>
          {createElement(
            LazyComponent as unknown as ComponentType<P>,
            (props ?? {}) as P & Record<string, unknown>,
          )}
        </Suspense>
      ) : null}
    </div>
  );
}
