import { lazy, Suspense, useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

const AnimatedShaderBackground = lazy(() => import("./animated-shader-background"));

/** Static stand-in when WebGL is deferred or reduced-motion is preferred. */
function ShaderFallback() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-b from-[#0b1020] via-[#12182a] to-[#0b1020]"
      aria-hidden
    />
  );
}

/**
 * Defers Three.js until after first paint (idle). Skips WebGL when the user
 * prefers reduced motion so Blog / Careers / Mobile App stay light.
 */
export default function DeferredShaderBackground() {
  const reduceMotion = usePrefersReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (reduceMotion) return;

    let cancelled = false;
    const enable = () => {
      if (!cancelled) setReady(true);
    };

    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(enable, { timeout: 1800 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }

    const timer = window.setTimeout(enable, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reduceMotion]);

  if (reduceMotion || !ready) {
    return <ShaderFallback />;
  }

  return (
    <Suspense fallback={<ShaderFallback />}>
      <AnimatedShaderBackground />
    </Suspense>
  );
}
