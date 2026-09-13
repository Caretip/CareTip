import { CareTipBrandedLoaderMark } from "@/app/components/CareTipPageLoader";
import { cn } from "@/lib/utils";

/**
 * Auth / onboarding hold — shared CareTip mark with one primary sentence.
 * Do not stack a second loading sentence here.
 */
export function AuthBootstrapShell({
  className,
  tagline,
  calm = false,
}: {
  className?: string;
  /** Overrides the default “Getting things ready…” sentence. */
  tagline?: string;
  /** Logout/handoff: logo + sentence, no moving bar (avoids visual jitter). */
  calm?: boolean;
}) {
  return (
    <div
      className={cn(
        "app-branded-loader flex min-h-[100dvh] w-full flex-col items-center justify-center bg-background px-6",
        calm && "app-branded-loader--calm",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <CareTipBrandedLoaderMark compact={false} tagline={tagline} calm={calm} />
    </div>
  );
}
