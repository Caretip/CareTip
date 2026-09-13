import * as React from "react";
import { useReducedMotion } from "motion/react";
import { useCoarsePointer } from "./mobilePerf";

/** @deprecated Use LandingReveal — kept for non-landing dashboard code if referenced. */
export const landingSectionViewport = { once: true, amount: 0.15, margin: "0px 0px -5% 0px" };

/** @deprecated CSS scroll reveal replaces Framer props. */
export const landingSectionReveal = {} as const;

/** @deprecated CSS scroll reveal replaces Framer props. */
export const landingFadeReveal = {} as const;

/** @deprecated CSS scroll reveal replaces Framer props. */
export function landingFadeRevealWithDelay(_delay = 0) {
  return {} as const;
}

/** Dashboard block entrance — never start invisible (blank gap after the shell paints). */
export const dashboardBlockMotion = {
  initial: false as const,
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
} as const;

/** Respects reduced motion; optional stagger delay for chart blocks. */
export function useDashboardBlockMotion(extraDelay = 0) {
  const reduceMotion = useReducedMotion();
  const coarsePointer = useCoarsePointer();
  return React.useMemo(() => {
    if (reduceMotion) {
      return {
        initial: false as const,
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0 },
      };
    }
    if (coarsePointer) {
      return {
        initial: false as const,
        animate: { opacity: 1, y: 0 },
        transition: {
          duration: 0,
        },
      };
    }
    return {
      ...dashboardBlockMotion,
      transition: {
        ...dashboardBlockMotion.transition,
        ...(extraDelay > 0 ? { delay: extraDelay } : {}),
      },
    };
  }, [extraDelay, reduceMotion, coarsePointer]);
}

/** Pause timers / CSS loops when off-screen. */
export function useInViewActive<T extends HTMLElement = HTMLDivElement>(options?: IntersectionObserverInit) {
  const ref = React.useRef<T | null>(null);
  const [active, setActive] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const ratio = entry?.intersectionRatio ?? 0;
        setActive(entry.isIntersecting && ratio >= 0.08);
      },
      { root: null, rootMargin: "200px 0px", threshold: [0, 0.08, 0.2], ...options },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, active };
}

export function useLargeScreen(minWidth = 1024) {
  const [matches, setMatches] = React.useState(() =>
    typeof window !== "undefined" ? window.matchMedia(`(min-width: ${minWidth}px)`).matches : true,
  );

  React.useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [minWidth]);

  return matches;
}

/** SSR-safe viewport gate — false below `minWidth` (no DOM for desktop-only UI on mobile). */
export function useMinWidthMedia(minWidth = 1024) {
  const query = `(min-width: ${minWidth}px)`;
  return React.useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
