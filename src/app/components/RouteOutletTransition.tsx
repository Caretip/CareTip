import { useLayoutEffect, useRef } from "react";
import { motion, useAnimation, useReducedMotion } from "motion/react";
import { Outlet, useLocation } from "react-router";
import { isAuthPostLoginTransitionActive } from "../lib/authPostLoginTransition";

const PAGE_ENTER = {
  duration: 0.26,
  ease: [0.22, 1, 0.36, 1] as const,
};

/**
 * Subtle fade + lift when dashboard child routes change.
 * First paint (including post-login) is fully opaque — never start at opacity 0
 * (that was the blank flash between Login and Dashboard).
 */
export function RouteOutletTransition() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const controls = useAnimation();
  const pathnameRef = useRef(location.pathname);
  const isFirstPaintRef = useRef(true);

  useLayoutEffect(() => {
    if (reduceMotion) return;

    if (isFirstPaintRef.current) {
      isFirstPaintRef.current = false;
      void controls.set({ opacity: 1, y: 0 });
      pathnameRef.current = location.pathname;
      return;
    }

    if (pathnameRef.current === location.pathname) return;
    // Soft-nav from login: keep fully painted (no fade from empty).
    if (isAuthPostLoginTransitionActive()) {
      pathnameRef.current = location.pathname;
      void controls.set({ opacity: 1, y: 0 });
      return;
    }
    pathnameRef.current = location.pathname;

    void controls.set({ opacity: 0, y: 10 });
    void controls.start({ opacity: 1, y: 0, transition: PAGE_ENTER });
  }, [location.pathname, reduceMotion, controls]);

  if (reduceMotion) {
    return <Outlet />;
  }

  return (
    <motion.div
      className="caretip-route-outlet min-h-0 min-w-0"
      initial={false}
      animate={controls}
    >
      <Outlet />
    </motion.div>
  );
}
