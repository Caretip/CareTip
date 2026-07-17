import { CareTipBrandedLoaderMark } from "@/app/components/CareTipPageLoader";
import { cn } from "@/lib/utils";

/**
 * Brief icon-only hold during auth handoff — never status copy.
 * Prefer dashboard shell + skeletons once the destination paints.
 */
export function AuthBootstrapShell({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "app-branded-loader flex min-h-[100dvh] w-full flex-col items-center justify-center bg-background px-6",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label="CareTip"
    >
      <CareTipBrandedLoaderMark />
    </div>
  );
}
