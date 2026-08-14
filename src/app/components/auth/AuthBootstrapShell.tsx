import { CareTipBrandedLoaderMark } from "@/app/components/CareTipPageLoader";
import { cn } from "@/lib/utils";

/**
 * Auth / onboarding hold — shared CareTip mark with one primary sentence.
 * Do not stack a second loading sentence here.
 */
export function AuthBootstrapShell({
  className,
  tagline,
}: {
  className?: string;
  /** Overrides the default “Getting things ready…” sentence. */
  tagline?: string;
}) {
  return (
    <div
      className={cn(
        "app-branded-loader flex min-h-[100dvh] w-full flex-col items-center justify-center bg-background px-6",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <CareTipBrandedLoaderMark compact={false} tagline={tagline} />
    </div>
  );
}
