import { cn } from "@/lib/utils";

type AuthLikePageBackgroundProps = {
  /**
   * Kept for API compatibility. Public shells always use the static canvas —
   * motion/react is intentionally not imported here so marketing pages do not
   * pay for animation runtime.
   */
  animated?: boolean;
};

/** Soft canvas + warm orange blurs — light ivory; charcoal gradient in dark mode. */
export function AuthLikePageBackground({ animated: _animated = true }: AuthLikePageBackgroundProps) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 isolate overflow-hidden"
      aria-hidden
    >
      <div
        className="absolute inset-0 bg-gradient-to-b from-[hsl(33_90%_97%)] via-white to-[hsl(33_40%_98%)] dark:hidden"
        aria-hidden
      />
      <div
        className="absolute inset-0 hidden bg-gradient-to-b from-background via-[hsl(220_14%_11%)] to-background dark:block"
        aria-hidden
      />
      <div
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.02]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: "200px 200px",
        }}
        aria-hidden
      />
      <div
        className="absolute top-0 left-1/2 h-[45vh] w-[100vh] -translate-x-1/2 rounded-b-[50%] bg-[hsl(33_82%_55%_/_0.12)] blur-[90px] dark:bg-primary/10"
        aria-hidden
      />
      <div
        className={cn(
          "absolute top-0 left-1/2 h-[40vh] w-[85vh] -translate-x-1/2 rounded-b-full",
          "bg-[hsl(33_90%_60%_/_0.08)] blur-[70px] opacity-45 dark:bg-primary/8 dark:opacity-30",
        )}
        aria-hidden
      />
      <div
        className={cn(
          "absolute bottom-0 left-1/2 h-[55vh] w-[75vh] -translate-x-1/2 rounded-t-full",
          "bg-[hsl(33_70%_85%_/_0.35)] blur-[70px] opacity-50 dark:bg-primary/5 dark:opacity-25",
        )}
        aria-hidden
      />
    </div>
  );
}
