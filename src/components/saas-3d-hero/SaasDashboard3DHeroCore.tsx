import { Suspense, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Canvas } from "@react-three/fiber";
import { useMediaQuery } from "@react-hook/media-query";
import { DashboardScene } from "./DashboardScene";

export type SaasDashboard3DHeroCoreVariant = "full" | "embed";

type SaasDashboard3DHeroCoreProps = {
  variant: SaasDashboard3DHeroCoreVariant;
  className?: string;
  /**
   * When `variant` is `embed`, caps visual height (CSS), e.g. `min(340px, 38vh)`.
   * Width is always 100% of parent; height follows `aspect-[5/3]` up to this cap.
   */
  embedMaxHeight?: string;
};

/**
 * Shared WebGL block: gradient shell, vignette, R3F canvas.
 * Embed variant uses aspect-ratio + max-height so the canvas scales with width without leaving a tall empty band.
 */
export function SaasDashboard3DHeroCore({
  variant,
  className = "",
  embedMaxHeight = "min(340px, min(42svh, 92vw))",
}: SaasDashboard3DHeroCoreProps) {
  /** Dashboard/marketing hero: static scene only (no motion) — avoids WebGL + DOM animation conflicts in production. */
  const reducedMotionScene = true;
  const narrow = useMediaQuery("(max-width: 767px)") === true;

  const dpr: [number, number] = useMemo(() => (narrow ? [1, 1] : [1, 1.5]), [narrow]);
  const reflectorResolution = narrow ? 256 : 512;

  const fullCanvasHeight = narrow ? "min(48svh, 420px)" : "min(54svh, 520px)";

  if (variant === "embed") {
    return (
      <div
        className={cn("relative isolate w-full overflow-hidden rounded-xl", className)}
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 50% -20%, rgba(235,153,44,0.24) 0%, transparent 58%), linear-gradient(180deg, #090909 0%, #050505 48%, #000000 100%)",
        }}
      >
        <div className="caretip-hero-ambient pointer-events-none absolute inset-0 z-[0]" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background:
              "radial-gradient(ellipse 68% 55% at 50% 42%, transparent 25%, rgba(0,0,0,0.55) 100%), radial-gradient(ellipse 90% 70% at 50% 100%, rgba(0,0,0,0.75) 0%, transparent 45%)",
          }}
          aria-hidden
        />

        <div className="relative z-[2] w-full min-w-0 max-w-[min(600px,100%)] lg:max-w-none">
          <div className="relative w-full" style={{ aspectRatio: "5 / 3", maxHeight: embedMaxHeight }}>
            <div
              className="absolute inset-0 overflow-hidden rounded-lg ring-1 ring-white/[0.08]"
              style={{
                boxShadow: "0 0 0 1px rgba(255,255,255,0.04) inset, 0 16px 48px rgba(0,0,0,0.35)",
              }}
            >
              <Canvas
                shadows
                dpr={dpr}
                className="touch-none"
                style={{ width: "100%", height: "100%", display: "block" }}
                camera={{ fov: 35, position: [0, 0.35, 6.15], near: 0.1, far: 45 }}
                gl={{
                  alpha: true,
                  antialias: true,
                  powerPreference: "high-performance",
                  stencil: false,
                  depth: true,
                }}
                onCreated={({ gl }) => {
                  gl.setClearColor(0x000000, 0);
                }}
              >
                <Suspense fallback={null}>
                  <DashboardScene reducedMotion={reducedMotionScene} reflectorResolution={reflectorResolution} />
                </Suspense>
              </Canvas>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("relative isolate overflow-hidden", className)}
      style={{
        background:
          "radial-gradient(ellipse 120% 80% at 50% -20%, rgba(235,153,44,0.24) 0%, transparent 58%), linear-gradient(180deg, #090909 0%, #050505 48%, #000000 100%)",
      }}
    >
      <div className="caretip-hero-ambient pointer-events-none absolute inset-0 z-[0]" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(ellipse 68% 55% at 50% 42%, transparent 25%, rgba(0,0,0,0.55) 100%), radial-gradient(ellipse 90% 70% at 50% 100%, rgba(0,0,0,0.75) 0%, transparent 45%)",
        }}
        aria-hidden
      />

      <div className="relative z-[2] mx-auto w-full max-w-5xl px-0" style={{ height: fullCanvasHeight }}>
        <div
          className="absolute inset-0 overflow-hidden rounded-3xl ring-1 ring-white/[0.08]"
          style={{
            boxShadow: "0 0 0 1px rgba(255,255,255,0.04) inset, 0 40px 120px rgba(0,0,0,0.45)",
          }}
        >
          <Canvas
            shadows
            dpr={dpr}
            style={{ width: "100%", height: "100%", display: "block" }}
            camera={{ fov: 35, position: [0, 0.35, 6.15], near: 0.1, far: 45 }}
            gl={{
              alpha: true,
              antialias: true,
              powerPreference: "high-performance",
              stencil: false,
              depth: true,
            }}
            onCreated={({ gl }) => {
              gl.setClearColor(0x000000, 0);
            }}
          >
            <Suspense fallback={null}>
              <DashboardScene reducedMotion={reducedMotionScene} reflectorResolution={reflectorResolution} />
            </Suspense>
          </Canvas>
        </div>
      </div>
    </div>
  );
}
