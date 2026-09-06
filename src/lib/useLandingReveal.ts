import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { CARETIP_LANDING_RESUME_EVENT } from "./landingMediaResume";

const REVEAL_CLASS = "caretip-landing-scroll-reveal";
const REVEAL_VISIBLE_CLASS = "caretip-landing-scroll-reveal--visible";

/** IntersectionObserver scroll reveal — CSS transitions, no Framer Motion. */
export function useLandingReveal(delayS = 0): {
  ref: RefObject<HTMLElement | null>;
  className: string;
  style: CSSProperties | undefined;
} {
  const ref = useRef<HTMLElement>(null);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const show = () => {
      el.classList.add(REVEAL_VISIBLE_CLASS);
    };

    if (reduceMotion) {
      show();
      return;
    }

    const markVisibleIfInView = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (rect.top < vh * 0.96 && rect.bottom > 0) {
        show();
        return true;
      }
      return false;
    };

    if (markVisibleIfInView()) return;

    let observer: IntersectionObserver | undefined;

    const attachObserver = () => {
      if (el.classList.contains(REVEAL_VISIBLE_CLASS)) return;
      observer?.disconnect();
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            show();
            observer?.disconnect();
          }
        },
        { root: null, rootMargin: "0px 0px 8% 0px", threshold: 0.01 },
      );

      observer.observe(el);
    };

    const raf = requestAnimationFrame(() => {
      if (!markVisibleIfInView()) attachObserver();
    });

    const onResume = () => {
      if (el.classList.contains(REVEAL_VISIBLE_CLASS)) return;
      if (!markVisibleIfInView()) attachObserver();
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener(CARETIP_LANDING_RESUME_EVENT, onResume);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener(CARETIP_LANDING_RESUME_EVENT, onResume);
    };
  }, [reduceMotion]);

  return {
    ref,
    className: REVEAL_CLASS,
    style: delayS > 0 ? ({ ["--reveal-delay" as string]: `${delayS}s` } as CSSProperties) : undefined,
  };
}
