import { useDashboardShellAria } from "@/app/hooks/useDashboardShellAria";
import { cn } from "@/lib/utils";

function ShimmerBar({ className }: { className?: string }) {
  return (
    <span className={cn("dashboard-hero-metric-skeleton__bar block rounded-md", className)} aria-hidden />
  );
}

/** Transactions / tips activity table — preserves header + row rhythm. */
export function TipsActivityTableSkeleton({
  rows = 8,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <tbody className={className}>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-border/60">
          <td className="px-4 py-3.5">
            <ShimmerBar className="h-4 w-16" />
          </td>
          <td className="px-4 py-3.5">
            <ShimmerBar className="h-4 w-24 max-w-[7rem]" />
          </td>
          <td className="px-4 py-3.5">
            <ShimmerBar className="h-4 w-28 max-w-[9rem]" />
          </td>
          <td className="px-4 py-3.5">
            <ShimmerBar className="h-4 w-32 max-w-[10rem]" />
          </td>
          <td className="px-4 py-3.5">
            <ShimmerBar className="h-6 w-20 rounded-full" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

/** Full notifications inbox list placeholder. */
export function NotificationInboxListSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  const aria = useDashboardShellAria();

  return (
    <div
      className={cn("overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm", className)}
      role="status"
      aria-busy="true"
      aria-label={aria.loading}
    >
      <ul className="divide-y divide-border/70">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex gap-3 px-3.5 py-3.5 sm:gap-4 sm:px-5 sm:py-4">
            <ShimmerBar className="h-10 w-10 shrink-0 rounded-xl sm:h-11 sm:w-11" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <ShimmerBar className="h-3 w-16 rounded-full" />
                <ShimmerBar className="h-3 w-10 shrink-0" />
              </div>
              <ShimmerBar className="h-4 w-[72%] max-w-[14rem]" />
              <ShimmerBar className="h-3 w-[90%] max-w-[18rem]" />
              <ShimmerBar className="mt-1 h-8 w-24 rounded-md" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Notification bell dropdown preview rows. */
export function NotificationPreviewListSkeleton({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y divide-border", className)} role="status" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="px-3 py-2.5">
          <ShimmerBar className="h-3.5 w-[70%] max-w-[12rem]" />
          <ShimmerBar className="mt-1.5 h-2.5 w-[90%] max-w-[16rem]" />
        </li>
      ))}
    </ul>
  );
}

/** Locations page card grid. */
export function LocationCardGridSkeleton({
  cards = 4,
  className,
}: {
  cards?: number;
  className?: string;
}) {
  const aria = useDashboardShellAria();

  return (
    <ul
      className={cn("grid gap-3 sm:grid-cols-2", className)}
      role="status"
      aria-busy="true"
      aria-label={aria.loading}
    >
      {Array.from({ length: cards }).map((_, i) => (
        <li key={i} className="flex gap-3 rounded-lg border border-border bg-card p-4">
          <ShimmerBar className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <ShimmerBar className="h-4 w-[55%] max-w-[9rem]" />
            <ShimmerBar className="h-3 w-[80%] max-w-[12rem]" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Platform admin global transactions table. */
export function GlobalTransactionsTableSkeleton({
  rows = 8,
}: {
  rows?: number;
}) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-border/60">
          <td className="px-4 py-3.5">
            <ShimmerBar className="h-4 w-28" />
          </td>
          <td className="px-4 py-3.5">
            <ShimmerBar className="h-4 w-32" />
          </td>
          <td className="px-4 py-3.5">
            <ShimmerBar className="h-4 w-28" />
          </td>
          <td className="px-4 py-3.5">
            <ShimmerBar className="ml-auto h-4 w-16" />
          </td>
          <td className="px-4 py-3.5">
            <ShimmerBar className="ml-auto h-4 w-14" />
          </td>
          <td className="px-4 py-3.5">
            <ShimmerBar className="ml-auto h-4 w-16" />
          </td>
          <td className="px-4 py-3.5">
            <ShimmerBar className="h-6 w-20 rounded-full" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

/** Tables management page — header + body rows. */
export function TablesListSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  const aria = useDashboardShellAria();

  return (
    <div className={cn("overflow-x-auto", className)} role="status" aria-busy="true" aria-label={aria.loading}>
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            {["w-28", "w-32", "w-36", "w-16"].map((w, i) => (
              <th key={i} className="px-4 py-3">
                <ShimmerBar className={cn("h-3.5", w)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i} className="border-b border-border/60">
              <td className="px-4 py-3.5">
                <ShimmerBar className="h-4 w-24" />
              </td>
              <td className="px-4 py-3.5">
                <ShimmerBar className="h-4 w-28" />
              </td>
              <td className="px-4 py-3.5">
                <ShimmerBar className="h-4 w-32" />
              </td>
              <td className="px-4 py-3.5">
                <ShimmerBar className="h-8 w-16 rounded-md" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Staff roster — desktop table + mobile cards. */
export function StaffRosterTableSkeleton({
  rows = 6,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  const aria = useDashboardShellAria();

  return (
    <div className={className} role="status" aria-busy="true" aria-label={aria.loading}>
      <div className="hidden lg:block overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[72rem]">
          <thead className="bg-muted/50">
            <tr>
              {Array.from({ length: 8 }).map((_, i) => (
                <th key={i} className="px-6 py-4">
                  <ShimmerBar className="h-3.5 w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i} className="border-b border-border/60">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <ShimmerBar className="h-10 w-10 shrink-0 rounded-full" />
                    <div className="space-y-2">
                      <ShimmerBar className="h-4 w-28" />
                      <ShimmerBar className="h-3 w-20" />
                    </div>
                  </div>
                </td>
                {Array.from({ length: 7 }).map((_, j) => (
                  <td key={j} className="px-6 py-4">
                    <ShimmerBar className={cn("h-4 w-16", j === 6 && "ml-auto h-8 w-24")} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-4 lg:hidden" aria-hidden>
        {Array.from({ length: Math.min(rows, 4) }).map((_, i) => (
          <li key={i} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <ShimmerBar className="h-12 w-12 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <ShimmerBar className="h-4 w-[55%]" />
                <ShimmerBar className="h-3 w-[40%]" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Platform admin — generic table body rows. */
export function PlatformAdminTableSkeleton({
  rows = 8,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-border/60">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3.5">
              <ShimmerBar
                className={cn(
                  "h-4",
                  j === 0 ? "w-28" : j === cols - 1 ? "w-36 max-w-[12rem]" : "w-24",
                )}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Employee tip goals — card list placeholder. */
export function EmployeeGoalListSkeleton({
  rows = 4,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y divide-border", className)} role="status" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1 space-y-2">
            <ShimmerBar className="h-4 w-[45%] max-w-[10rem]" />
            <ShimmerBar className="h-3 w-[62%] max-w-[14rem]" />
          </div>
          <ShimmerBar className="h-9 w-20 rounded-lg" />
        </li>
      ))}
    </ul>
  );
}

/** Employee settings — form section placeholders. */
export function EmployeeSettingsFormSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)} role="status" aria-busy="true">
      {[1, 2, 3].map((section) => (
        <section key={section} className="space-y-4 rounded-lg border border-border bg-card p-5 sm:p-6">
          <ShimmerBar className="h-4 w-32" />
          <div className="space-y-3">
            <ShimmerBar className="h-10 w-full rounded-lg" />
            <ShimmerBar className="h-10 w-full rounded-lg" />
            {section === 1 ? <ShimmerBar className="h-24 w-full rounded-lg" /> : null}
          </div>
        </section>
      ))}
    </div>
  );
}
