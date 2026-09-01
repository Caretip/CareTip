import { useDashboardShellAria } from "@/app/hooks/useDashboardShellAria";
import { cn } from "@/lib/utils";

function ShimmerBar({ className }: { className?: string }) {
  return (
    <span className={cn("dashboard-hero-metric-skeleton__bar block rounded-md", className)} aria-hidden />
  );
}

/** Overview recent-orders placeholder — intro and Business QR render without waiting. */
export function QrStudioOverviewSkeleton({ className }: { className?: string }) {
  const aria = useDashboardShellAria();
  return (
    <div
      className={cn("divide-y divide-border/80 border-y border-border/80", className)}
      role="status"
      aria-busy="true"
      aria-label={aria.loading}
    >
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="space-y-3 py-4">
          <div className="flex justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <ShimmerBar className="h-3.5 w-[42%] max-w-[11rem]" />
              <ShimmerBar className="h-2.5 w-[58%] max-w-[14rem]" />
              <ShimmerBar className="h-2.5 w-36" />
            </div>
            <ShimmerBar className="h-3.5 w-14 shrink-0" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <ShimmerBar className="h-6 w-24 rounded-full" />
            <ShimmerBar className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** My Orders list — mirrors PhysicalQrOrderCard rhythm. */
export function QrStudioOrderListSkeleton({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  const aria = useDashboardShellAria();
  return (
    <div
      className={cn("divide-y divide-border/80 border-y border-border/80", className)}
      role="status"
      aria-busy="true"
      aria-label={aria.loading}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-3 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <ShimmerBar className="h-3.5 w-[48%] max-w-[12rem]" />
              <ShimmerBar className="h-2.5 w-[62%] max-w-[16rem]" />
              <ShimmerBar className="h-2.5 w-28" />
            </div>
            <ShimmerBar className="h-3.5 w-14 shrink-0" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <ShimmerBar className="h-6 w-28 rounded-full" />
            <ShimmerBar className="h-3.5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Order detail sections — preserves card/grid layout. */
export function QrStudioOrderDetailSkeleton({ className }: { className?: string }) {
  const aria = useDashboardShellAria();
  return (
    <div className={cn("space-y-6", className)} role="status" aria-busy="true" aria-label={aria.loading}>
      <div className="space-y-2">
        <ShimmerBar className="h-3 w-24" />
        <ShimmerBar className="h-6 w-[55%] max-w-[16rem]" />
        <ShimmerBar className="h-3 w-36" />
      </div>
      <div className="grid gap-3 rounded-lg border border-border/70 p-4 sm:grid-cols-2 sm:p-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <ShimmerBar className="h-2.5 w-20" />
            <ShimmerBar className="h-3.5 w-[70%] max-w-[10rem]" />
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-lg border border-border/70 p-4 sm:p-5">
        <ShimmerBar className="h-4 w-32" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <ShimmerBar className="mt-0.5 h-5 w-5 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <ShimmerBar className="h-3.5 w-28" />
              <ShimmerBar className="h-2.5 w-40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Print marketplace select step — product tiles + QR checklist. */
export function PrintQrStudioSkeleton({ className }: { className?: string }) {
  const aria = useDashboardShellAria();
  return (
    <div
      className={cn(
        "grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label={aria.loading}
    >
      <div className="space-y-8 max-lg:space-y-5">
        <div className="space-y-3">
          <ShimmerBar className="h-3.5 w-36" />
          <ShimmerBar className="h-2.5 w-52" />
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border p-2.5">
                <ShimmerBar className="aspect-[148/210] w-full rounded-md" />
                <ShimmerBar className="h-3.5 w-28" />
                <ShimmerBar className="h-2.5 w-16" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <ShimmerBar className="h-3.5 w-40" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border/60 py-3">
              <ShimmerBar className="h-5 w-5 shrink-0 rounded" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <ShimmerBar className="h-3.5 w-[50%] max-w-[12rem]" />
                <ShimmerBar className="h-2.5 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-lg border border-border p-4">
        <ShimmerBar className="h-3.5 w-24" />
        <ShimmerBar className="h-2.5 w-full" />
        <ShimmerBar className="h-2.5 w-[80%]" />
        <ShimmerBar className="mt-2 h-10 w-full rounded-md" />
      </div>
    </div>
  );
}

/** Platform admin order detail placeholder. */
export function PlatformPhysicalQrOrderSkeleton({ className }: { className?: string }) {
  const aria = useDashboardShellAria();
  return (
    <div className={cn("space-y-4", className)} role="status" aria-busy="true" aria-label={aria.loading}>
      <ShimmerBar className="h-3 w-28" />
      <ShimmerBar className="h-7 w-[50%] max-w-[18rem]" />
      <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <ShimmerBar className="h-2.5 w-24" />
            <ShimmerBar className="h-3.5 w-[65%] max-w-[12rem]" />
          </div>
        ))}
      </div>
      <ShimmerBar className="h-10 w-40 rounded-md" />
    </div>
  );
}
