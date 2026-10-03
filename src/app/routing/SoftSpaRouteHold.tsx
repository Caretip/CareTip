import { cn } from "@/lib/utils";

/**
 * In-app SPA navigations while a lazy route chunk resolves.
 * Preserves continuity — no second full branded boot screen after cold start.
 */
export function SoftSpaRouteHold({
  className,
  testId = "soft-spa-route-hold",
}: {
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn("fixed inset-0 z-[9990] bg-background", className)}
      data-testid={testId}
      aria-hidden
    />
  );
}
