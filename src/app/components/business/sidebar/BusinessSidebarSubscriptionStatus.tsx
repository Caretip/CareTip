import { useAuth } from "@/app/hooks/useAuth";
import { cn } from "@/lib/utils";

/** Business name strip under the logo — subscription plan label intentionally omitted. */
export function BusinessSidebarSubscriptionStatus({ className }: { className?: string }) {
  const { user } = useAuth();
  const businessName = user?.businessName?.trim();
  if (!businessName) return null;

  return (
    <div
      className={cn(
        "business-sidebar-venue-name border-b border-sidebar-border px-4 lg:px-5",
        className,
      )}
    >
      <p className="business-sidebar-venue-name__label truncate text-sm font-semibold text-sidebar-foreground">
        {businessName}
      </p>
    </div>
  );
}
