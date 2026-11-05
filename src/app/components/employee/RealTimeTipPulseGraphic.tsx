import { motion } from "motion/react";
import { QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCENT = "#eb992c";

const PARTICLE_COUNT = 14;

function PulseParticles() {
  return (
    <>
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const left = ((i * 37 + 11) % 92) + 4;
        const top = ((i * 23 + 19) % 88) + 6;
        const size = 3 + (i % 4);
        return (
          <motion.span
            key={i}
            className="pointer-events-none absolute rounded-full"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: size,
              height: size,
              backgroundColor: ACCENT,
              boxShadow: `0 0 ${6 + (i % 3) * 2}px ${ACCENT}66`,
            }}
            initial={{ opacity: 0.35, y: 0 }}
            animate={{
              y: [0, -18, -6, -22, 0],
              opacity: [0.35, 0.95, 0.55, 0.85, 0.35],
            }}
            transition={{
              duration: 3.2 + (i % 5) * 0.35,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.12,
            }}
          />
        );
      })}
    </>
  );
}

export type RealTimeTipPulseGraphicProps = {
  className?: string;
  /** Caps height in standalone layout (ignored when `embedded`). */
  maxHeight?: string;
  /**
   * Fills parent (square `rounded-3xl` frame). Centers and scales stage like `object-cover` for vector content.
   * Omit built-in footer label — caller places caption outside.
   */
  embedded?: boolean;
};

/** Spinning QR with floating orange particles for the employee dashboard hero only. */
export function RealTimeTipPulseGraphic({
  className,
  maxHeight = "min(320px, min(46svh, 92vw))",
  embedded = false,
}: RealTimeTipPulseGraphicProps) {
  const qrRotate = (
    <motion.div
      className={cn(
        "relative z-10 flex h-full w-full flex-col items-center justify-center",
        embedded ? "pb-3 pt-3" : "pb-7 sm:pb-8",
      )}
      animate={{ rotate: 360 }}
      transition={{ duration: 56, repeat: Infinity, ease: "linear" }}
      aria-hidden
    >
      <QrCode
        className={cn(
          "drop-shadow-[0_0_28px_rgba(235,153,44,0.45)]",
          embedded
            ? "h-[min(9rem,42%)] w-[min(9rem,42%)] min-h-[6.5rem] min-w-[6.5rem] sm:h-[38%] sm:w-[38%] sm:min-h-[7rem] sm:min-w-[7rem]"
            : "h-[clamp(3.75rem,46%,7rem)] w-[clamp(3.75rem,46%,7rem)] sm:h-[clamp(4.25rem,44%,8rem)] sm:w-[clamp(4.25rem,44%,8rem)] lg:h-36 lg:w-36",
        )}
        stroke={ACCENT}
        strokeWidth={1.15}
        fill="none"
      />
    </motion.div>
  );

  if (embedded) {
    return (
      <div
        className={cn(
          "relative isolate h-full min-h-0 w-full min-w-0 touch-manipulation rounded-[inherit] bg-black",
          className,
        )}
      >
        {/* Cover-style zoom so the QR stays centered and cropped cleanly at the rounded frame */}
        <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
          <div className="absolute left-1/2 top-1/2 aspect-square h-[118%] w-[118%] min-h-[108%] min-w-[108%] -translate-x-1/2 -translate-y-1/2">
            <div className="absolute inset-0 overflow-hidden rounded-[inherit] bg-gradient-to-br from-neutral-950 via-neutral-900 to-black">
              <PulseParticles />
              {qrRotate}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative isolate w-full max-w-full touch-manipulation rounded-xl", className)}>
      <div
        className="relative mx-auto aspect-square w-[min(280px,calc(100%-1rem),90vw)] max-w-full shrink-0 sm:w-[300px] lg:w-[min(340px,42vw)]"
        style={{ maxHeight, maxWidth: maxHeight }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-lg bg-gradient-to-br from-neutral-950 via-neutral-900 to-black">
          <PulseParticles />
          {qrRotate}
        </div>
      </div>
      <p className="pointer-events-none mt-2 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-[#eb992c]/90 sm:mt-2.5 sm:text-[11px]">
        Real-time tip pulse
      </p>
    </div>
  );
}
