import { useAuth } from "@/app/hooks/useAuth";
import { cn } from "@/lib/utils";

/** Business name strip under the logo — subscription plan label intentionally omitted. */
export function BusinessSidebarSubscriptionStatus({ className }: { className?: string }) {
  const { user } = useAuth();
  const businessName = user?.businessName?.trim();
  if (!businessName) return null;

  return (
    <div className={cn("border-b border-sidebar-border px-4 py-3", className)}>
      <p className="truncate text-sm font-semibold text-sidebar-foreground">{businessName}</p>
    </div>
  );
}
