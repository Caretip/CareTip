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
    <div className={cn("physical-qr-order-detail space-y-6", className)} role="status" aria-busy="true" aria-label={aria.loading}>
      <div className="space-y-2">
        <ShimmerBar className="h-3 w-24" />
        <ShimmerBar className="h-6 w-[55%] max-w-[16rem]" />
        <ShimmerBar className="h-3 w-36" />
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_12rem] md:border-t md:border-border/70 md:pt-5">
        <div className="space-y-3">
          <ShimmerBar className="h-2.5 w-24" />
          <ShimmerBar className="h-5 w-40" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex justify-between gap-4 border-t border-border/50 pt-2">
              <ShimmerBar className="h-3.5 w-[55%]" />
              <ShimmerBar className="h-3 w-8" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <ShimmerBar className="h-2.5 w-20" />
          <ShimmerBar className="h-7 w-24" />
          <ShimmerBar className="h-2.5 w-16" />
          <ShimmerBar className="h-3.5 w-28" />
        </div>
      </div>
      <div className="space-y-3 border-t border-border/70 pt-5">
        <ShimmerBar className="h-2.5 w-20" />
        <div className="flex gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="min-w-0 flex-1 space-y-1.5">
              <ShimmerBar className="h-2.5 w-4 rounded-full" />
              <ShimmerBar className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Print marketplace select step — product tiles + QR checklist. */
export function PrintQrStudioSkeleton({ className }: { className?: string }) {
  const aria = useDashboardShellAria();
  return (
    <div
      className={cn("print-qr-studio__workspace", className)}
      role="status"
      aria-busy="true"
      aria-label={aria.loading}
    >
      <section className="min-w-0 space-y-2">
        <ShimmerBar className="h-3.5 w-36" />
        <ShimmerBar className="h-2.5 w-52" />
        <div className="grid gap-2.5 grid-cols-1 min-[420px]:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border p-2">
              <ShimmerBar className="mx-auto aspect-[148/210] w-full max-w-[8.5rem] rounded-md" />
              <ShimmerBar className="h-3.5 w-28" />
              <ShimmerBar className="h-2.5 w-16" />
            </div>
          ))}
        </div>
      </section>
      <section className="min-w-0 space-y-2">
        <ShimmerBar className="h-3.5 w-40" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex min-h-10 items-center gap-2.5 border-b border-border/60 py-2">
            <ShimmerBar className="h-4 w-4 shrink-0 rounded" />
            <ShimmerBar className="h-3.5 w-[50%] max-w-[12rem]" />
          </div>
        ))}
      </section>
      <aside className="print-qr-studio__summary min-w-0 space-y-2">
        <ShimmerBar className="h-3.5 w-28" />
        <ShimmerBar className="h-2.5 w-full" />
        <ShimmerBar className="h-2.5 w-[80%]" />
        <ShimmerBar className="mt-1 h-9 w-full rounded-md" />
      </aside>
    </div>
  );
}

/** Platform admin order detail placeholder. */
export function PlatformPhysicalQrOrderSkeleton({ className }: { className?: string }) {
  const aria = useDashboardShellAria();
  return (
    <div className={cn("pq-fulfillment-workspace space-y-4", className)} role="status" aria-busy="true" aria-label={aria.loading}>
      <ShimmerBar className="h-3 w-28" />
      <ShimmerBar className="h-7 w-[50%] max-w-[18rem]" />
      <div className="grid gap-4 border-b border-border/70 pb-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <ShimmerBar className="h-2.5 w-20" />
            <ShimmerBar className="h-4 w-[70%] max-w-[10rem]" />
          </div>
        ))}
      </div>
      <ShimmerBar className="h-10 w-40 rounded-md" />
      <div className="space-y-2 border-t border-border/70 pt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <ShimmerBar key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
